// ─────────────────────────────────────────────────────────────────────────────
// AUTO-SISTEMA · algoritmo greedy spiegabile.
// Prima i gruppi grandi nei tavoli grandi, minimizzando lo spreco di capienza.
// Rispetta: buffer riassetto, accorpamenti, durate per coperti.
// NON applica mai da solo: produce una proposta con motivazioni da confermare.
// ─────────────────────────────────────────────────────────────────────────────
import type { Combo, Period, Reservation, Settings, TableT } from "./types";
import { planLargeParty, type LargePartyGroup } from "./large-party";
import { toMin } from "./time";
import { durationFor } from "./estimates";

export type Proposal = {
  reservationId: string; name: string; partySize: number; time: string;
  target:
    | { kind: "table"; table: TableT }
    | { kind: "combo"; combo: Combo }
    | {
        kind: "join"; tables: TableT[]; label: string;
        zones?: number; groups?: LargePartyGroup[];
      }; // accostati o distribuiti
  reason: string;
};
export type Skipped = { reservationId: string; name: string; partySize: number; time: string; reason: string };
export type AssignPlan = { proposals: Proposal[]; skipped: Skipped[] };

export function autoAssign(params: {
  reservations: Reservation[]; tables: TableT[]; combos: Combo[];
  period: Period; settings: Settings; scope?: "all" | "unassigned";
}): AssignPlan {
  const { tables, combos, period, settings } = params;
  const gap = settings.joinMaxGapCm ?? 150;
  const buf = settings.bufferMinutes;
  const pName = period.name;
  const inPeriod = (t: number) => t >= toMin(period.startTime) && t < toMin(period.endTime) + settings.slotMinutes;

  // Intervalli occupati per tavolo: prenotazioni già sistemate (con durata + buffer)
  const busy = new Map<string, Array<[number, number, string]>>(); // tableId → [start,end,label]
  const taken: Reservation[] = [];
  const todo: Reservation[] = [];
  for (const r of params.reservations) {
    if (r.status !== "confermata" || !inPeriod(toMin(r.time))) continue;
    if (r.assignedTableId || r.assignedComboId) taken.push(r); else todo.push(r);
  }
  const pushBusy = (tableId: string, s: number, e: number, label: string) => {
    const arr = busy.get(tableId) ?? [];
    arr.push([s, e, label]);
    busy.set(tableId, arr);
  };
  for (const r of taken) {
    const dur = durationFor(r.partySize, pName, settings);
    const s = toMin(r.time), e = s + dur + buf, lbl = `${r.guestName} ${r.time}`;
    if (r.assignedTableId) pushBusy(r.assignedTableId, s, e, lbl);
    for (const tid of r.joinedTableIds ?? []) pushBusy(tid, s, e, lbl);
    if (r.assignedComboId) {
      const c = combos.find((x) => x.id === r.assignedComboId);
      c?.tableIds.forEach((id) => pushBusy(id, s, e, lbl));
    }
  }
  const freeAt = (tableId: string, s: number, e: number) =>
    !(busy.get(tableId) ?? []).some(([bs, be]) => s < be && bs < e);

  // Greedy: gruppi grandi prima (sono i più difficili da piazzare), poi per orario
  todo.sort((a, b) => b.partySize - a.partySize || toMin(a.time) - toMin(b.time));
  const proposals: Proposal[] = [];
  const skipped: Skipped[] = [];

  for (const r of todo) {
    const dur = durationFor(r.partySize, pName, settings);
    const s = toMin(r.time), e = s + dur + buf;
    type Cand = { kind: "table" | "combo"; t?: TableT; c?: Combo; waste: number; pref: boolean };
    // Il cliente ha chiesto una sala al telefono: viene prima di ogni altra cosa.
    const wanted = r.preferredRoomId ?? null;
    const cands: Cand[] = [];
    for (const t of tables) {
      const seats = Math.max(t.capacity, t.maxCapacity || 0);
      if (seats < r.partySize || t.state === "fuori_servizio") continue;
      if (freeAt(t.id, s, e)) {
        cands.push({ kind: "table", t, waste: seats - r.partySize, pref: !!wanted && t.roomId === wanted });
      }
    }
    for (const c of combos) {
      if (c.capacity < r.partySize) continue;
      if (c.tableIds.some((id) => tables.find((table) => table.id === id)?.isJoinable === false)) continue;
      if (c.tableIds.every((id) => freeAt(id, s, e))) {
        cands.push({ kind: "combo", c, waste: c.capacity - r.partySize, pref: !!wanted && c.roomId === wanted });
      }
    }
    // Nessun tavolo singolo basta: il planner prova una catena accostabile e,
    // per gruppi enormi, poche zone vicine. Restituisce già file ordinate e sala.
    if (!cands.length && settings.allowTableJoin) {
      const libere = tables.filter((t) => t.state !== "fuori_servizio" && freeAt(t.id, s, e));
      const combined = planLargeParty({
        party: r.partySize,
        tables: libere,
        maxGapCm: gap,
        preferredRoomId: wanted,
      });
      if (combined.complete && combined.tables.length) {
        proposals.push({
          reservationId: r.id, name: r.guestName, partySize: r.partySize, time: r.time,
          target: {
            kind: "join",
            tables: combined.tables,
            label: combined.tables.map((t) => t.label).join("+"),
            zones: combined.groups.length,
            groups: combined.groups,
          },
          reason: combined.reason,
        });
        for (const table of combined.tables) pushBusy(table.id, s, e, r.guestName);
        continue;
      }
    }
    if (!cands.length) {
      // Gruppo molto grande: se una singola catena non basta, lo si distribuisce
      // su poche zone vicine. È una proposta spiegabile, non un fallimento generico.
      const libere = tables.filter((t) => t.state !== "fuori_servizio" && freeAt(t.id, s, e));
      const large = planLargeParty({
        party: r.partySize,
        tables: libere,
        maxGapCm: gap,
        preferredRoomId: wanted,
      });
      if (large.complete && large.tables.length) {
        const label = large.tables.map((t) => t.label).join("+");
        proposals.push({
          reservationId: r.id, name: r.guestName, partySize: r.partySize, time: r.time,
          target: {
            kind: "join",
            tables: large.tables,
            label,
            zones: large.groups.length,
            groups: large.groups,
          },
          reason: large.reason,
        });
        for (const table of large.tables) pushBusy(table.id, s, e, r.guestName);
        continue;
      }
      skipped.push({
        reservationId: r.id, name: r.guestName, partySize: r.partySize, time: r.time,
        reason: large.shortfall > 0
          ? `${large.totalSeats} posti liberi · ne mancano ${large.shortfall}`
          : `Nessun tavolo libero dalle ${r.time} per ${dur} min + ${buf} di riassetto`,
      });
      continue;
    }
    cands.sort((a, b) => Number(b.pref) - Number(a.pref) || a.waste - b.waste);
    const pick = cands[0];
    const label = pick.kind === "table" ? `Tavolo ${pick.t!.label}` : `Accorpati ${pick.c!.label}`;
    const note = /tranquill/i.test(r.notes) ? " · nota: chiesto tavolo tranquillo" : "";
    proposals.push({
      reservationId: r.id, name: r.guestName, partySize: r.partySize, time: r.time,
      target: pick.kind === "table" ? { kind: "table", table: pick.t! } : { kind: "combo", combo: pick.c! },
      reason: `${label}${pick.pref ? " · nella sala richiesta" : wanted ? " · sala richiesta non libera" : ""}${pick.waste > 0 ? ` · avanzano ${pick.waste} posti` : ""}${note}`,
    });
    // simula l'occupazione per i successivi
    if (pick.kind === "table") pushBusy(pick.t!.id, s, e, r.guestName);
    else pick.c!.tableIds.forEach((id) => pushBusy(id, s, e, r.guestName));
  }
  return { proposals, skipped };
}
