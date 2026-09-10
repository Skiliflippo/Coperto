// Stime di sala: durata occupazione, stato derivato tavolo, suggerimenti walk-in,
// stima attesa. Funzioni pure → testabili e usate sia dal client che dagli endpoint.
import type { Combo, Period, Seating, Settings, TableT, TableLiveState } from "./types";
import { toMin } from "./time";

// Durata stimata in base a coperti + turno (configurabile da impostazioni)
export function durationFor(partySize: number, periodName: string | null, settings: Settings): number {
  const key = (periodName ?? "cena").toLowerCase();
  const bands = settings.durations[key] ?? settings.durations.cena;
  if (partySize >= 9) return bands.xl;
  if (partySize >= 7) return bands.large;
  return bands.base;
}
export function periodFor(partyTimeMin: number, periods: Period[]): Period | null {
  return periods.find((p) => toMin(p.startTime) <= partyTimeMin && partyTimeMin <= toMin(p.endTime)) ?? null;
}

// Stato LIVE del tavolo: base (DB) + occupazioni attive + orologio
export function liveState(table: TableT, active: Seating | undefined, nowMs: number): TableLiveState {
  if (table.state === "fuori_servizio") return "fuori_servizio";
  if (active) {
    const end = new Date(active.expectedEndAt).getTime();
    if (nowMs > end) return "oltre_tempo";
    if (end - nowMs <= 15 * 60000) return "in_liberazione";
    return "occupato";
  }
  return table.state === "da_pulire" ? "da_pulire" : "libero";
}

// Mappa tavolo → seating attiva
export function activeSeatingByTable(seatings: Seating[]): Map<string, Seating> {
  const m = new Map<string, Seating>();
  for (const s of seatings) if (s.status === "seduto") for (const id of s.tableIds) m.set(id, s);
  return m;
}

export type FreeCandidate =
  | { kind: "table"; table: TableT; waste: number; freeNow: boolean; freeInMin: number }
  | { kind: "combo"; combo: Combo; waste: number; freeNow: boolean; freeInMin: number };

// Walk-in: tavoli compatibili ordinati per efficienza (meno spreco prima), poi accorpamenti
export function walkInSuggestions(
  party: number, tables: TableT[], combos: Combo[], seatings: Seating[], nowMs: number
): { free: FreeCandidate[]; nextMin: number | null } {
  const byTable = activeSeatingByTable(seatings);
  const out: FreeCandidate[] = [];
  let nextMin: number | null = null;
  const considerFreeIn = (endIso: string) => {
    const m = Math.ceil((new Date(endIso).getTime() - nowMs) / 60000);
    if (nextMin == null || m < nextMin) nextMin = m;
  };
  for (const t of tables) {
    const st = byTable.get(t.id);
    const state = liveState(t, st, nowMs);
    if (state === "fuori_servizio" || state === "da_pulire") continue;
    if (t.capacity >= party) {
      if (!st) out.push({ kind: "table", table: t, waste: t.capacity - party, freeNow: true, freeInMin: 0 });
      else considerFreeIn(st.expectedEndAt);
    }
  }
  for (const c of combos) {
    if (c.capacity < party) continue;
    const acts = c.tableIds.map((id) => byTable.get(id)).filter(Boolean) as Seating[];
    if (acts.length === 0) out.push({ kind: "combo", combo: c, waste: c.capacity - party, freeNow: true, freeInMin: 0 });
    else considerFreeIn(acts.map((a) => a.expectedEndAt).sort().reverse()[0]);
  }
  out.sort((a, b) => a.waste - b.waste);
  return { free: out.filter((c) => c.freeNow), nextMin };
}

// Stima attesa per la lista d'attesa: guarda liberazioni previste E prenotazioni in arrivo
export function estimateWaitMin(
  party: number, tables: TableT[], combos: Combo[], seatings: Seating[],
  reservations: { time: string; partySize: number; assignedTableId: string | null; assignedComboId: string | null }[],
  nowMinOfDay: number, settings: Settings, nowMs: number
): number | null {
  const byTable = activeSeatingByTable(seatings);
  const fitting = tables.filter((t) => t.capacity >= party && t.state === "libero");
  const candidates: number[] = []; // minuti da ora in cui un tavolo adatto si libera "per davvero"
  for (const t of fitting) {
    const st = byTable.get(t.id);
    if (!st) { candidates.push(0); continue; }
    // se dopo la liberazione prevista arriva subito una prenotazione su quel tavolo, non conta
    const freedMin = nowMinOfDay + Math.ceil((new Date(st.expectedEndAt).getTime() - nowMs) / 60000);
    const blocked = reservations.some(
      (r) => r.assignedTableId === t.id && toMin(r.time) < freedMin + settings.bufferMinutes + 30
    );
    if (!blocked) candidates.push(Math.max(0, freedMin - nowMinOfDay));
  }
  const joinedFree = combos.some((c) => c.capacity >= party && c.tableIds.every((id) => !byTable.get(id)));
  if (joinedFree) candidates.push(0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  return candidates[0];
}

// Tavoli/accorpamenti liberi in una fascia [timeMin, timeMin+dur+buffer)
export function freeTargetsAt(params: {
  timeMin: number; party: number; dur: number; buf: number;
  tables: TableT[]; combos: Combo[];
  assigned: { id?: string; time: string; partySize: number; assignedTableId: string | null; assignedComboId: string | null }[];
  durFor: (partySize: number) => number;
}): { tables: TableT[]; combos: Combo[] } {
  const { timeMin, party, dur, buf, tables, combos, assigned, durFor } = params;
  const s = timeMin, e = timeMin + dur + buf;
  const busyByTable = new Map<string, Array<[number, number]>>();
  const push = (id: string, a: number, b: number) => {
    const arr = busyByTable.get(id) ?? []; arr.push([a, b]); busyByTable.set(id, arr);
  };
  for (const r of assigned) {
    const a = toMin(r.time), b = a + durFor(r.partySize) + buf;
    if (r.assignedTableId) push(r.assignedTableId, a, b);
    if (r.assignedComboId) combos.find((c) => c.id === r.assignedComboId)?.tableIds.forEach((tid) => push(tid, a, b));
  }
  const free = (id: string) => !(busyByTable.get(id) ?? []).some(([a, b]) => s < b && a < e);
  return {
    tables: tables.filter((t) => t.capacity >= party && t.state !== "fuori_servizio" && free(t.id)),
    combos: combos.filter((c) => c.capacity >= party && c.tableIds.every(free)),
  };
}

// Sovraccarico coperti per fascia oraria (warning overbooking sul Piano)
export function loadBySlot(
  reservationTimes: { time: string; partySize: number }[], slotMin: number
): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of reservationTimes) {
    const slot = Math.floor(toMin(r.time) / slotMin) * slotMin;
    m.set(slot, (m.get(slot) ?? 0) + r.partySize);
  }
  return m;
}
