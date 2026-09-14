"use client";
// PRENOTAZIONE AL TELEFONO — obiettivo: finita in ≤20 secondi, ≥90% tap.
// Ordine dei campi = ordine in cui arrivano dalla telefonata.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Check, TriangleAlert, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useBootstrap } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { nowMin, toHHMM, toMin, todayISO, relDay } from "@/lib/time";
import { durationFor, freeTargetsAt, periodFor } from "@/lib/estimates";
import { Btn, Field, Input, Sheet } from "@/components/ui";
import { PartyGrid } from "@/components/seat-flow";
import { toast } from "@/components/toast";
import type { DayData, Reservation } from "@/lib/types";

const NOTE_CHIPS = ["Tavolo tranquillo", "Seggiolone", "Compleanno", "Senza glutine", "Intolleranze", "Dehors se libero"];

export function ReservationFormSheet({ open, onClose, defaultDate, edit }: {
  open: boolean; onClose: () => void; defaultDate?: string;
  edit?: Reservation | null;      // se presente si modifica invece di creare
}) {
  const boot = useBootstrap();
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const qc = useQueryClient();
  const startDate = edit?.date ?? defaultDate;
  const [day, setDay] = useState<"oggi" | "domani" | "altro">(
    startDate && startDate !== todayISO() ? (startDate === todayISO(1) ? "domani" : "altro") : "oggi");
  const [altDate, setAltDate] = useState(startDate ?? todayISO(1));
  const [time, setTime] = useState(edit?.time ?? "");
  const [party, setParty] = useState(edit?.partySize ?? 2);
  const [name, setName] = useState(edit?.guestName ?? "");
  const [phone, setPhone] = useState(edit?.guestPhone ?? "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [roomId, setRoomId] = useState<string | null>(edit?.preferredRoomId ?? null);
  const [dups, setDups] = useState<{ id: string; guestName: string; time: string; partySize: number }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const date = day === "oggi" ? todayISO() : day === "domani" ? todayISO(1) : altDate;
  const dayQ = useQuery({
    queryKey: ["day", rid, date],
    queryFn: () => api<DayData>(`/api/day?rid=${rid}&date=${date}`),
    enabled: !!boot.data && open,
  });

  // slot rapidi: dalla mezz'ora successiva a fine turno (se oggi) o tutto il turno (altri giorni)
  const slots = useMemo(() => {
    if (!boot.data) return { cena: [] as string[], pranzo: [] as string[] };
    const out: Record<string, string[]> = {};
    for (const p of boot.data.periods) {
      const list: string[] = [];
      const s = toMin(p.startTime), e = toMin(p.endTime);
      const start = date === todayISO() ? Math.max(s, Math.ceil((nowMin() + 15) / boot.data.settings.slotMinutes) * boot.data.settings.slotMinutes) : s;
      for (let t = start; t <= e - 45; t += boot.data.settings.slotMinutes) list.push(toHHMM(t));
      out[p.name.toLowerCase()] = list;
    }
    return out;
  }, [boot.data, date]);

  // feedback live + suggerimento tavolo per l'orario scelto
  const feedback = useMemo(() => {
    if (!boot.data || !dayQ.data || !time) return null;
    const period = periodFor(toMin(time), boot.data.periods);
    const dur = durationFor(party, period?.name ?? "cena", boot.data.settings);
    const res = dayQ.data.reservations;
    const stas = res.filter((r) => r.status !== "cancellata" && r.status !== "no_show");
    const totalCap = boot.data.tables.reduce((a, t) => a + t.capacity, 0);
    // Si ragiona per fascia oraria (±30 min): i coperti dell'intera giornata non
    // c'entrano con l'orario che il cliente sta chiedendo.
    const slotCovers = stas
      .filter((r) => Math.abs(toMin(r.time) - toMin(time)) <= 30)
      .reduce((a, r) => a + r.partySize, 0);
    const over = slotCovers + party >= (totalCap * boot.data.settings.overbookingPct) / 100;
    const { tables, combos } = freeTargetsAt({
      timeMin: toMin(time), party, dur, buf: boot.data.settings.bufferMinutes,
      tables: boot.data.tables, combos: boot.data.combos,
      assigned: stas.filter((r) => r.assignedTableId || r.assignedComboId),
      durFor: (p) => durationFor(p, period?.name ?? "cena", boot.data.settings),
    });
    const best = [...tables, ...combos].sort((a, b) => (a.capacity - party) - (b.capacity - party))[0];
    return { slotCovers, totalCap, over, best: best ? ("label" in best ? `tavolo ${best.label} (${best.capacity} p.)` : null) : null, periodName: period?.name };
  }, [boot.data, dayQ.data, time, party]);

  const submit = async (force = false) => {
    if (!name.trim() || !time || busy) return;
    setBusy(true);
    try {
      if (edit) {
        // modifica: nome, giorno, ora, coperti, telefono, note, sala preferita
        await api(`/api/reservations/${edit.id}`, {
          method: "PATCH",
          body: {
            restaurantId: rid, staffName: me,
            guestName: name.trim(), guestPhone: phone, date, time,
            partySize: party, notes, preferredRoomId: roomId,
          },
        });
        await qc.invalidateQueries({ queryKey: ["day", rid] });
        toast({ title: `${name.trim()} aggiornata`, msg: `${relDay(date)} alle ${time} · ${party} p.`, tone: "ok" });
        onClose();
        return;
      }
      await api("/api/reservations", {
        method: "POST",
        body: {
          restaurantId: rid, date, time, partySize: party, name, phone, notes,
          source: "telefono", createdBy: me, force, preferredRoomId: roomId,
        },
      });
      await qc.invalidateQueries({ queryKey: ["day", rid] });
      toast({ title: `Prenotato: ${name.trim()}, ${party} p. alle ${time}`, msg: `${relDay(date)} · inserita da te`, tone: "ok" });
      setName(""); setPhone(""); setNotes(""); setTime(""); setParty(2); setRoomId(null); setDups(null);
      onClose();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.payload?.duplicates) setDups(err.payload.duplicates);
      else toast({ title: err.message, tone: "err" });
    } finally { setBusy(false); }
  };

  const chipCls = (active: boolean) =>
    `min-h-[52px] shrink-0 rounded-2xl px-3.5 font-display text-[15px] font-bold tabular-nums active:scale-95 ${active ? "bg-brand text-on-brand shadow" : "bg-raised"}`;

  return (
    <Sheet open={open} onClose={onClose} title={edit ? "Modifica prenotazione" : "Prenotazione"}>
      <div className="grid min-w-0 gap-3.5">
        {/* 1 · GIORNO */}
        <Field label="Giorno">
          <div className="grid grid-cols-3 gap-2">
            {(["oggi", "domani", "altro"] as const).map((d) => (
              <button key={d} onClick={() => setDay(d)}
                className={`flex min-h-[56px] items-center justify-center gap-1.5 rounded-2xl text-[15px] font-bold active:scale-[0.97] ${day === d ? "bg-brand text-on-brand" : "bg-raised"}`}>
                {d === "altro" && <Calendar className="h-4 w-4" />}
                {d === "oggi" ? "Oggi" : d === "domani" ? "Domani" : "Altro"}
              </button>
            ))}
          </div>
          {day === "altro" && (
            <input type="date" value={altDate} min={todayISO()} onChange={(e) => setAltDate(e.target.value || todayISO())}
              className="mt-2 min-h-[56px] w-full rounded-2xl border border-line bg-bg px-4 font-display text-lg font-bold outline-none focus:border-brand" />
          )}
        </Field>

        {/* 2 · ORARIO (slot da 15 min + input libero) */}
        <Field label="Orario">
          <div className="min-w-0 space-y-2">
            {boot.data?.periods.map((p) => {
              const list = slots[p.name.toLowerCase()] ?? [];
              if (!list.length) return null;
              return (
                <div key={p.id}>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{p.name}</p>
                  <div className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4">
                    {list.map((t) => <button key={t} onClick={() => setTime(t)} className={chipCls(time === t)}>{t}</button>)}
                  </div>
                </div>
              );
            })}
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="min-h-[56px] w-full rounded-2xl border border-line bg-bg px-4 font-display text-lg font-bold outline-none focus:border-brand" />
          </div>
        </Field>

        {/* 3 · COPERTI */}
        <Field label="Coperti">
          <PartyGrid value={party} onChange={setParty} />
        </Field>

        {/* 4 · NOME (unico campo testuale obbligatorio) */}
        <Field label="Nome prenotazione">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Rossi" autoComplete="off" />
        </Field>

        {/* 5 · SALA (opzionale): alcuni clienti la chiedono già al telefono */}
        {(boot.data?.rooms.length ?? 0) > 1 && (
          <Field label="Sala richiesta (opzionale)">
            <div className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4">
              <button onClick={() => setRoomId(null)}
                className={`min-h-[48px] shrink-0 rounded-2xl px-4 text-[15px] font-semibold active:scale-95 ${!roomId ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}>
                Indifferente
              </button>
              {boot.data?.rooms.map((r) => (
                <button key={r.id} onClick={() => setRoomId(roomId === r.id ? null : r.id)}
                  className={`min-h-[48px] shrink-0 rounded-2xl px-4 text-[15px] font-semibold active:scale-95 ${roomId === r.id ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}>
                  {r.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="grid min-w-0 gap-2.5">
          <Field label="Telefono (opzionale)">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="333…" />
          </Field>
          <div className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4">
            {NOTE_CHIPS.map((n) => (
              <button key={n} onClick={() => setNotes((v) => (v.includes(n) ? v.replace(n, "").replace(/,\s*,/g, ",").trim() : (v ? `${v}, ${n}` : n)))}
                className={`min-h-[44px] shrink-0 rounded-full px-3.5 text-sm font-semibold active:scale-95 ${notes.includes(n) ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}>
                {n}
              </button>
            ))}
          </div>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note libere (opzionale)" />
        </div>

        {/* FEEDBACK LIVE mentre il cliente è ancora al telefono */}
        {feedback && (
          <div className={`rounded-2xl border-2 p-3.5 text-sm font-semibold ${feedback.over ? "border-soon/60 bg-soon/10 text-soon" : "border-ok/40 bg-ok/10 text-ok"}`}>
            <p>Alle {time}: {feedback.slotCovers} coperti già prenotati in quella fascia, su {feedback.totalCap} in sala.</p>
            <p className="mt-1 flex items-center gap-1.5">
              <Zap className="h-4 w-4" />
              {feedback.best ? <>Tavolo libero suggerito: <b>{feedback.best}</b></> : "Nessun tavolo libero in quella fascia: valuta un altro orario."}
            </p>
            {feedback.over && <p className="mt-1 flex items-center gap-1.5"><TriangleAlert className="h-4 w-4" /> Fascia molto piena: puoi prenotare lo stesso, lo gestiamo sul Piano.</p>}
          </div>
        )}

        {/* ANTI-DUPLICATI */}
        {dups && (
          <div className="rounded-2xl border-2 border-soon/60 bg-soon/10 p-3.5">
            <p className="font-bold text-soon">Forse è già prenotato:</p>
            {dups.map((d) => <p key={d.id} className="mt-1 font-semibold">· {d.guestName}, {d.partySize} pers. alle {d.time}</p>)}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Btn variant="soft" onClick={() => { setDups(null); setName(""); onClose(); }}>È la stessa</Btn>
              <Btn onClick={() => submit(true)}>È una nuova</Btn>
            </div>
          </div>
        )}

        <Btn size="xl" disabled={!name.trim() || !time || busy} onClick={() => submit(false)}>
          <Check className="h-6 w-6" /> {edit ? "Salva modifiche" : `Prenota ${name ? `${name.trim()} · ` : ""}${party} p. ${time ? `alle ${time}` : ""}`}
        </Btn>
      </div>
    </Sheet>
  );
}
