"use client";
// Flusso "Quanti siete?" — il cuore della velocità in sala.
// Tap 1: quanti siete · Tap 2: tavolo suggerito → seduti. Fine.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Clock, ArrowRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { activeSeatingByTable, durationFor, liveState, periodFor, walkInSuggestions } from "@/lib/estimates";
import { toMin, todayISO, nowMin } from "@/lib/time";
import { toast } from "@/components/toast";
import { Btn, Sheet } from "@/components/ui";

// Griglia coperti 1–8 + 9+
export function PartyGrid({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [big, setBig] = useState(false);
  if (big) {
    return (
      <div className="flex items-center justify-center gap-3">
        <button onClick={() => onChange(Math.max(9, value - 1))} className="grid h-16 w-16 place-items-center rounded-2xl bg-raised text-3xl font-bold active:scale-95">−</button>
        <div className="w-24 text-center font-display text-5xl font-bold tabular-nums">{value}</div>
        <button onClick={() => onChange(Math.min(30, value + 1))} className="grid h-16 w-16 place-items-center rounded-2xl bg-raised text-3xl font-bold active:scale-95">+</button>
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
  return async (v: { tableIds: string[]; tableLabel: string; partySize: number; name?: string; reservationId?: string; waitlistId?: string; note?: string }) => {
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

// Elenco tavoli liberi suggeriti per capienza, con avviso se prenotati a breve
export function SuggestedTables({ party, onPick, excludeIds = [], compact }: {
  party: number;
  onPick: (v: { tableIds: string[]; tableLabel: string }) => void;
  excludeIds?: string[]; compact?: boolean;
}) {
  const boot = useBootstrap();
  const day = useDay(todayISO());
  const now = useNow();
  if (!boot.data || !day.data) return <div className="skeleton h-24 rounded-2xl" />;
  const { tables, combos } = boot.data;
  const usableTables = tables.filter((t) => !excludeIds.includes(t.id));
  const { free, nextMin } = walkInSuggestions(party, usableTables, combos.filter((c) => !c.tableIds.some((id) => excludeIds.includes(id))), day.data.seatings, now);
  const byTable = activeSeatingByTable(day.data.seatings);
  const upcoming = day.data.reservations.filter((r) => r.status === "confermata");

  if (!free.length) {
    return (
      <div className="rounded-2xl border border-soon/50 bg-soon/10 p-4 text-center">
        <p className="font-bold text-soon">Nessun tavolo libero per {party}</p>
        {nextMin != null && <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-muted"><Clock className="h-4 w-4" /> Prossima liberazione prevista: ~{nextMin} min</p>}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {free.slice(0, compact ? 3 : 6).map((c) => {
        const isT = c.kind === "table";
        const ids = isT ? [c.table.id] : c.combo.tableIds;
        const label = isT ? c.table.label : c.combo.label;
        const cap = isT ? c.table.capacity : c.combo.capacity;
        const room = boot.data.rooms.find((r) => r.id === (isT ? c.table.roomId : c.combo.roomId));
        // prenotato a breve su questo tavolo?
        const soonRes = upcoming.find((r) =>
          (ids.includes(r.assignedTableId ?? "") || (r.assignedComboId && !isT && r.assignedComboId === (c as any).combo?.id)) &&
          toMin(r.time) - nowMin() < 45 && toMin(r.time) >= nowMin() - 15);
        void byTable;
        return (
          <button key={ids.join("+")} onClick={() => onPick({ tableIds: ids, tableLabel: label })}
            className="flex min-h-[64px] items-center gap-3 rounded-2xl border-2 border-ok/40 bg-ok/10 px-4 text-left active:scale-[0.98]">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ok font-display text-lg font-bold text-white">{label}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{cap} posti · {room?.name}</span>
              {soonRes
                ? <span className="block text-[13px] font-semibold text-soon">Prenotato {soonRes.guestName} alle {soonRes.time}</span>
                : <span className="block text-[13px] text-muted">{c.waste === 0 ? "Perfetto, nessuno spreco" : c.waste <= 2 ? "Buon incastro" : `Avanzi ${c.waste} posti`}</span>}
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-ok" />
          </button>
        );
      })}
    </div>
  );
}

// Sheet completo walk-in: quanti siete → tavolo → seduti
export function WalkInSheet({ open, onClose, defaultName = "", waitlistId }: { open: boolean; onClose: () => void; defaultName?: string; waitlistId?: string }) {
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
          const ok = await seat({ ...t, partySize: party, name: defaultName || "Walk-in", waitlistId });
          setBusy(false);
          if (ok) { setParty(2); onClose(); }
        }} />
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">Capienza diversa al tavolo? La correggi dopo con un tap.</p>
    </Sheet>
  );
}
