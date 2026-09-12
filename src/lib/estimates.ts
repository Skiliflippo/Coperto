// Motore di sala: durate, stati live, disponibilità immediata e futura.
// Funzioni pure, testabili, condivise fra mappa, walk-in e Piano.
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

// ─────────────────────────────────────────────────────────────────────────────
// STATO LIVE DEI TAVOLI
// Nessuno stato da aggiornare a mano: tutto si deduce da orologio e prenotazioni.
//  · occupato    → c'è gente seduta
//  · oltre l'ora → seduti da più di settings.overtimeMinutes (default 60')
//  · prenotato   → tavolo vuoto ma con prenotazione in arrivo: non si può assegnare
//  · libero      → assegnabile subito
// ─────────────────────────────────────────────────────────────────────────────
export type ResLite = {
  id: string; guestName: string; time: string; partySize: number; status: string;
  assignedTableId: string | null; assignedComboId: string | null;
};
export type TableStatus = {
  state: TableLiveState;
  seating?: Seating;
  minutesSeated?: number;
  reservation?: ResLite;   // prenotazione che tiene impegnato il tavolo
};

export function computeTableStatuses(args: {
  tables: TableT[]; combos: Combo[]; seatings: Seating[]; reservations: ResLite[];
  settings: Settings; nowMs: number; nowMinOfDay: number;
}): Map<string, TableStatus> {
  const { tables, combos, seatings, reservations, settings, nowMs, nowMinOfDay } = args;
  const byTable = activeSeatingByTable(seatings);
  const hold = settings.reservationHoldMinutes ?? 90;
  const overtime = settings.overtimeMinutes ?? 60;

  // prenotazioni ancora da far sedere, mappate sui tavoli che impegnano
  const holds = new Map<string, ResLite>();
  for (const r of reservations) {
    if (r.status !== "confermata") continue;      // cancellata/no-show → il tavolo torna libero
    const t = toMin(r.time);
    // impegna da "hold" minuti prima fino a un'ora dopo l'orario (poi è ritardo conclamato)
    if (t - nowMinOfDay > hold || nowMinOfDay - t > 60) continue;
    const ids = r.assignedTableId
      ? [r.assignedTableId]
      : combos.find((c) => c.id === r.assignedComboId)?.tableIds ?? [];
    for (const id of ids) {
      const cur = holds.get(id);
      if (!cur || toMin(r.time) < toMin(cur.time)) holds.set(id, r);
    }
  }

  const out = new Map<string, TableStatus>();
  for (const t of tables) {
    if (t.state === "fuori_servizio") { out.set(t.id, { state: "fuori_servizio" }); continue; }
    const seating = byTable.get(t.id);
    if (seating) {
      const minutesSeated = Math.max(0, Math.round((nowMs - new Date(seating.seatedAt).getTime()) / 60000));
      out.set(t.id, { state: minutesSeated > overtime ? "oltre_tempo" : "occupato", seating, minutesSeated });
      continue;
    }
    const reservation = holds.get(t.id);
    out.set(t.id, reservation ? { state: "prenotato", reservation } : { state: "libero" });
  }
  return out;
}

// Mappa tavolo → seating attiva
export function activeSeatingByTable(seatings: Seating[]): Map<string, Seating> {
  const m = new Map<string, Seating>();
  for (const s of seatings) if (s.status === "seduto") for (const id of s.tableIds) m.set(id, s);
  return m;
}

export type FreeCandidate =
  | { kind: "table"; table: TableT; waste: number; extraChairs: number }
  | { kind: "combo"; combo: Combo; waste: number; extraChairs: number };

// Tavoli assegnabili ADESSO per un gruppo: esclude occupati, fuori servizio e prenotati.
// `forReservationId` permette di sedere una prenotazione sul tavolo che lei stessa tiene.
export function availableTargets(args: {
  party: number; tables: TableT[]; combos: Combo[]; statuses: Map<string, TableStatus>;
  forReservationId?: string; excludeIds?: string[];
}): { free: FreeCandidate[]; nextFreeMin: number | null; nextFreeLabel: string | null } {
  const { party, tables, combos, statuses, forReservationId, excludeIds = [] } = args;
  const usable = (id: string) => {
    if (excludeIds.includes(id)) return false;
    const st = statuses.get(id);
    if (!st) return false;
    if (st.state === "libero") return true;
    return st.state === "prenotato" && !!forReservationId && st.reservation?.id === forReservationId;
  };
  const free: FreeCandidate[] = [];
  for (const t of tables) {
    // un 2 posti con maxCapacity 4 accoglie 4 persone aggiungendo sedie
    const seats = Math.max(t.capacity, t.maxCapacity || 0);
    if (seats >= party && usable(t.id)) {
      free.push({ kind: "table", table: t, waste: seats - party, extraChairs: Math.max(0, party - t.capacity) });
    }
  }
  for (const c of combos) {
    if (c.capacity >= party && c.tableIds.every(usable)) {
      free.push({ kind: "combo", combo: c, waste: c.capacity - party, extraChairs: 0 });
    }
  }
  // prima chi non richiede sedie extra, poi chi spreca meno posti
  free.sort((a, b) => a.extraChairs - b.extraChairs || a.waste - b.waste || (a.kind === "table" ? -1 : 1));

  // prossima liberazione utile (per dire "tra ~12 minuti" quando è tutto pieno)
  let nextFreeMin: number | null = null;
  let nextFreeLabel: string | null = null;
  for (const t of tables) {
    if (t.capacity < party || excludeIds.includes(t.id)) continue;
    const st = statuses.get(t.id);
    if (!st?.seating || st.minutesSeated == null) continue;
    const left = Math.max(0, Math.round((new Date(st.seating.expectedEndAt).getTime() - Date.now()) / 60000));
    if (nextFreeMin == null || left < nextFreeMin) { nextFreeMin = left; nextFreeLabel = t.label; }
  }
  return { free, nextFreeMin, nextFreeLabel };
}

// Disponibilità futura e carico del Piano.
// Sovraccarico coperti per fascia oraria (warning overbooking sul Piano)
// Tavoli/accorpamenti liberi in una fascia futura [time, time+durata+buffer):
// serve al Piano e al form prenotazioni, dove non conta "adesso" ma un orario preciso.
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
    tables: tables.filter((t) => Math.max(t.capacity, t.maxCapacity || 0) >= party && t.state !== "fuori_servizio" && free(t.id)),
    combos: combos.filter((c) => c.capacity >= party && c.tableIds.every(free)),
  };
}

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
