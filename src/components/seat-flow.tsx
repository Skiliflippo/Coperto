"use client";
// Flusso "Quanti siete?" — il cuore della velocità in sala.
// Tap 1: quanti siete · Tap 2: tavolo suggerito → seduti. Fine.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Clock, ArrowRight, Link2, Scissors } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { availableTargets, computeTableStatuses, durationFor, periodFor } from "@/lib/estimates";
import { findJoinProposals } from "@/lib/join";
import { todayISO, nowMin } from "@/lib/time";
import { toast } from "@/components/toast";
import { Sheet } from "@/components/ui";

// Griglia coperti 1–8 + 9+
export function PartyGrid({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [big, setBig] = useState(false);
  if (big) {
    return (
      <div className="flex items-center justify-center gap-3">
        <button onClick={() => onChange(Math.max(9, value - 1))} className="grid h-16 w-16 place-items-center rounded-2xl bg-raised text-3xl font-bold active:scale-95">−</button>
        <div className="w-24 text-center font-display text-5xl font-bold tabular-nums">{value}</div>
        <button onClick={() => onChange(Math.min(80, value + 10))} className="grid h-16 w-16 place-items-center rounded-2xl bg-raised text-lg font-bold active:scale-95">+10</button>
        <button onClick={() => onChange(Math.min(80, value + 1))} className="grid h-16 w-16 place-items-center rounded-2xl bg-raised text-3xl font-bold active:scale-95">+</button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-5 gap-2">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
        <button key={n} onClick={() => onChange(n)}
          className={`grid h-16 place-items-center rounded-2xl text-2xl font-bold transition-all active:scale-95 ${value === n ? "bg-brand text-on-brand shadow-md" : "bg-raised"}`}>
          {n}
        </button>
      ))}
      <button onClick={() => { setBig(true); onChange(9); }}
        className={`col-span-2 grid h-16 place-items-center rounded-2xl text-2xl font-bold transition-all active:scale-95 ${value >= 9 ? "bg-brand text-on-brand" : "bg-raised"}`}>
        9+
      </button>
    </div>
  );
}

export function useSeat() {
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const boot = useBootstrap();
  const qc = useQueryClient();
  return async (v: { tableIds: string[]; tableLabel: string; partySize: number; name?: string; reservationId?: string; note?: string }) => {
    const settings = boot.data!.settings;
    const period = periodFor(nowMin(), boot.data!.periods);
    const dur = durationFor(v.partySize, period?.name ?? null, settings);
    const expectedEndAt = new Date(Date.now() + dur * 60000).toISOString();
    try {
      await api("/api/seatings", {
        method: "POST",
        body: { restaurantId: rid, ...v, expectedEndAt, createdBy: me },
      });
      await qc.invalidateQueries({ queryKey: ["day", rid] });
      toast({ title: v.name ? `${v.name} sedut${v.partySize > 1 ? "i" : "o"} al tavolo ${v.tableLabel}` : `Tavolo ${v.tableLabel} occupato`, tone: "ok" });
      return true;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.payload?.conflict) {
        toast({ title: `Tavolo appena occupato da ${err.payload.occupiedBy}`, msg: "Ho aggiornato la sala: scegli un altro tavolo.", tone: "err" });
        await qc.invalidateQueries({ queryKey: ["day", rid] });
      } else {
        toast({ title: err.message, tone: "err" });
      }
      return false;
    }
  };
}

// Tavoli assegnabili ADESSO. I tavoli prenotati non compaiono: se la prenotazione
// viene cancellata o segnata no-show, il tavolo torna automaticamente disponibile.
// Se il gruppo non entra da nessuna parte, propone di accostare due tavoli vicini.
export function SuggestedTables({ party, onPick, excludeIds = [], compact, forReservationId }: {
  party: number;
  onPick: (v: { tableIds: string[]; tableLabel: string }) => void;
  excludeIds?: string[]; compact?: boolean; forReservationId?: string;
}) {
  const boot = useBootstrap();
  const day = useDay(todayISO());
  const now = useNow();
  const qc = useQueryClient();
  const rid = useSession((st) => st.staff?.restaurantId);
  const me = useSession((st) => st.staff?.name) ?? "";
  const [splitting, setSplitting] = useState<string | null>(null);
  if (!boot.data || !day.data) return <div className="skeleton h-24 rounded-2xl" />;
  const { tables, combos, rooms, settings } = boot.data;
  const statuses = computeTableStatuses({
    tables, combos, seatings: day.data.seatings, reservations: day.data.reservations,
    settings, nowMs: now, nowMinOfDay: nowMin(),
  });
  const { free, nextFreeMin, nextFreeLabel } = availableTargets({
    party, tables, combos, statuses, forReservationId, excludeIds,
  });
  const held = tables.filter((t) => statuses.get(t.id)?.state === "prenotato" && t.capacity >= party).length;

  // TAVOLI DA STACCARE: un tavolone libero che in realtà sono più tavoli accostati.
  // Si propone quando sederci il gruppo sprecherebbe un tavolo intero: o perché
  // non resta altro, o perché il posto migliore avanza troppi coperti.
  // Resta una scelta: il tavolo intero compare comunque nell'elenco qui sopra.
  const stdSeats = settings.standardTableSeats ?? 4;
  const bestWaste = free.length ? free[0].waste : Infinity;
  const wouldWasteATable = bestWaste >= stdSeats;   // sprecheremmo almeno un tavolo
  const splittable = wouldWasteATable
    ? tables
        .filter((t) => !excludeIds.includes(t.id))
        .filter((t) => t.splitInto >= 2 && statuses.get(t.id)?.state === "libero")
        // il gruppo deve stare comodo in una sola parte: le altre restano libere
        .filter((t) => stdSeats >= party)
        .map((t) => ({ table: t, partSeats: stdSeats, freed: t.splitInto - 1 }))
        .sort((a, b) => b.freed - a.freed || a.table.capacity - b.table.capacity)
        .slice(0, 2)
    : [];

  // Accorpamenti: solo se attivi in impostazioni e solo quando servono davvero
  const joins = settings.allowTableJoin && !free.length
    ? findJoinProposals({
        party, tables: tables.filter((t) => !excludeIds.includes(t.id)), statuses,
        maxGapCm: settings.joinMaxGapCm ?? 150,
      })
    : [];

  if (!free.length && !joins.length && !splittable.length) {
    return (
      <div className="rounded-2xl border border-soon/50 bg-soon/10 p-4 text-center">
        <p className="font-bold text-soon">Nessun tavolo disponibile per {party}</p>
        {nextFreeMin != null && (
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-muted">
            <Clock className="h-4 w-4" /> Il tavolo {nextFreeLabel} si libera tra ~{nextFreeMin} min
          </p>
        )}
        {held > 0 && <p className="mt-1 text-[13px] font-semibold text-muted">{held} tavoli adatti sono tenuti per prenotazioni in arrivo</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {free.slice(0, compact ? 3 : 6).map((c) => {
        const isT = c.kind === "table";
        const ids = isT ? [c.table.id] : c.combo.tableIds;
        const label = isT ? c.table.label : c.combo.label;
        const cap = isT ? Math.max(c.table.capacity, c.table.maxCapacity) : c.combo.capacity;
        const room = rooms.find((r) => r.id === (isT ? c.table.roomId : c.combo.roomId));
        const mine = isT && statuses.get(c.table.id)?.state === "prenotato";
        return (
          <button key={ids.join("+")} onClick={() => onPick({ tableIds: ids, tableLabel: label })}
            className="flex min-h-[64px] items-center gap-3 rounded-2xl border-2 border-ok/40 bg-ok/10 px-4 text-left active:scale-[0.98]">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ok font-display text-lg font-bold text-white">{label}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{cap} posti · {room?.name}</span>
              <span className="block text-[13px] text-muted">
                {mine ? "Il tavolo tenuto per questa prenotazione"
                  : c.extraChairs > 0 ? `Aggiungendo ${c.extraChairs} sedi${c.extraChairs === 1 ? "a" : "e"}`
                  : c.waste === 0 ? "Perfetto, nessuno spreco"
                  : c.waste <= 2 ? "Buon incastro" : `Avanzi ${c.waste} posti`}
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-ok" />
          </button>
        );
      })}

      {splittable.map(({ table, partSeats }) => (
        <button key={`split-${table.id}`} disabled={splitting === table.id}
          onClick={async () => {
            setSplitting(table.id);
            try {
              const res = await api<{ parts: { id: string; label: string; capacity: number }[] }>(
                `/api/tables/${table.id}/split`, { method: "POST", body: { restaurantId: rid, staffName: me } },
              );
              await qc.invalidateQueries({ queryKey: ["bootstrap"] });
              const part = res.parts.find((p) => p.capacity >= party) ?? res.parts[0];
              onPick({ tableIds: [part.id], tableLabel: part.label });
            } catch (e: any) {
              toast({ title: e?.message ?? "Non è stato possibile staccare il tavolo", tone: "err" });
            }
            setSplitting(null);
          }}
          className="flex min-h-[64px] items-center gap-3 rounded-2xl border-2 border-busy/40 bg-busy/10 px-4 text-left active:scale-[0.98] disabled:opacity-50">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-busy text-white">
            <Scissors className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Stacca il tavolo {table.label}</span>
            <span className="block text-[13px] text-muted">
              Diventa {table.splitInto} tavoli da {partSeats} posti: ne usi uno, restano liberi gli altri {table.splitInto - 1}
            </span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-busy" />
        </button>
      ))}

      {joins.length > 0 && (
        <>
          <p className="mt-1 flex items-center gap-1.5 px-1 text-[13px] font-bold text-soon">
            <Link2 className="h-4 w-4" /> In {party} non entrate in un tavolo solo · si possono accostare:
          </p>
          {joins.map((j) => (
            <button key={j.label} onClick={() => onPick({ tableIds: j.tableIds, tableLabel: j.label })}
              className="flex min-h-[64px] items-center gap-3 rounded-2xl border-2 border-soon/50 bg-soon/10 px-4 text-left active:scale-[0.98]">
              <span className="grid h-11 shrink-0 place-items-center rounded-xl bg-soon px-2.5 font-display text-base font-bold text-ink">{j.label}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{j.seats} posti uniti</span>
                <span className="block text-[13px] text-muted">{j.reason}</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-soon" />
            </button>
          ))}
        </>
      )}

      {held > 0 && <p className="px-1 text-[12px] font-medium text-muted">{held} tavoli nascosti perché prenotati a breve</p>}
    </div>
  );
}

// Sheet completo walk-in: quanti siete → tavolo → seduti
export function WalkInSheet({ open, onClose, defaultName = "" }: { open: boolean; onClose: () => void; defaultName?: string }) {
  const [party, setParty] = useState(2);
  const seat = useSeat();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Users className="h-5 w-5 text-brand" /> Quanti siete?</span>}>
      <PartyGrid value={party} onChange={setParty} />
      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-muted">Tavoli liberi adatti · i migliori incastri prima</p>
        <SuggestedTables party={party} onPick={async (t) => {
          if (busy) return;
          setBusy(true);
          const ok = await seat({ ...t, partySize: party, name: defaultName || "Walk-in" });
          setBusy(false);
          if (ok) { setParty(2); onClose(); }
        }} />
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">Capienza diversa al tavolo? La correggi dopo con un tap.</p>
    </Sheet>
  );
}
