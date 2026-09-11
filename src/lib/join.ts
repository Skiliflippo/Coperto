// ─────────────────────────────────────────────────────────────────────────────
// ACCORPAMENTI INTELLIGENTI
// Se un gruppo non entra in nessun tavolo, l'app cerca due (o tre) tavoli VICINI
// sulla piantina, entrambi completamente liberi — né occupati né prenotati — la cui
// somma di posti basta per il gruppo. Propone, non decide: il tavolo unito nasce
// solo quando l'operatore conferma, e resta unito finché non lo si libera.
// L'adiacenza è geometrica: usa le posizioni reali dei tavoli sulla mappa.
// ─────────────────────────────────────────────────────────────────────────────
import type { TableT } from "./types";
import type { TableStatus } from "./estimates";

export const seatsOf = (t: TableT, withExtraChairs = true) =>
  withExtraChairs ? Math.max(t.capacity, t.maxCapacity || 0) : t.capacity;

// Ingombro allineato agli assi (i tavoli ruotati vengono racchiusi nel loro riquadro)
function bbox(t: TableT) {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const w = t.width * c + t.height * s;
  const h = t.width * s + t.height * c;
  return { x1: t.x - w / 2, y1: t.y - h / 2, x2: t.x + w / 2, y2: t.y + h / 2 };
}

// Due tavoli sono accostabili se stanno nella stessa sala, sono affiancati
// (si "vedono" su un lato) e distano meno di maxGap centimetri.
export function areAdjacent(a: TableT, b: TableT, maxGap: number): boolean {
  if (a.roomId !== b.roomId) return false;
  const A = bbox(a), B = bbox(b);
  const gapX = Math.max(0, Math.max(A.x1 - B.x2, B.x1 - A.x2));
  const gapY = Math.max(0, Math.max(A.y1 - B.y2, B.y1 - A.y2));
  // sovrapposizione sull'asse perpendicolare: almeno un terzo del lato più corto
  const overlapX = Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1);
  const overlapY = Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1);
  const minW = Math.min(A.x2 - A.x1, B.x2 - B.x1);
  const minH = Math.min(A.y2 - A.y1, B.y2 - B.y1);
  const sideBySide = gapY === 0 || overlapY > minH / 3;   // accostati in orizzontale
  const stacked = gapX === 0 || overlapX > minW / 3;      // accostati in verticale
  if (gapX <= maxGap && sideBySide && overlapY > 0) return true;
  if (gapY <= maxGap && stacked && overlapX > 0) return true;
  return false;
}

export type JoinProposal = {
  tables: TableT[];
  tableIds: string[];
  label: string;        // "7+8"
  seats: number;        // posti totali con sedie aggiunte
  baseSeats: number;    // posti senza sedie aggiunte
  extraChairs: number;  // sedie da aggiungere per arrivare al gruppo
  waste: number;
  reason: string;
};

// Un tavolo è "unibile" solo se completamente libero: occupato o prenotato non vale.
const isFree = (id: string, statuses: Map<string, TableStatus>) => statuses.get(id)?.state === "libero";

export function findJoinProposals(args: {
  party: number;
  tables: TableT[];
  statuses: Map<string, TableStatus>;
  maxGapCm: number;
  maxTables?: number;   // quanti tavoli al massimo accostare (default 3)
  limit?: number;
}): JoinProposal[] {
  const { party, tables, statuses, maxGapCm, maxTables = 3, limit = 4 } = args;
  const free = tables.filter((t) => t.state !== "fuori_servizio" && isFree(t.id, statuses));
  const out: JoinProposal[] = [];

  const make = (group: TableT[]): JoinProposal => {
    const seats = group.reduce((a, t) => a + seatsOf(t), 0);
    const baseSeats = group.reduce((a, t) => a + t.capacity, 0);
    const sorted = [...group].sort((a, b) => (Number(a.label) || 0) - (Number(b.label) || 0));
    return {
      tables: sorted,
      tableIds: sorted.map((t) => t.id),
      label: sorted.map((t) => t.label).join("+"),
      seats, baseSeats,
      extraChairs: Math.max(0, party - baseSeats),
      waste: seats - party,
      reason: "",
    };
  };

  // coppie adiacenti
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (!areAdjacent(free[i], free[j], maxGapCm)) continue;
      const p = make([free[i], free[j]]);
      if (p.seats >= party) out.push(p);
    }
  }
  // terzine: solo se nessuna coppia basta (gruppi molto grandi)
  if (!out.length && maxTables >= 3) {
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        if (!areAdjacent(free[i], free[j], maxGapCm)) continue;
        for (let k = j + 1; k < free.length; k++) {
          const catena = areAdjacent(free[k], free[i], maxGapCm) || areAdjacent(free[k], free[j], maxGapCm);
          if (!catena) continue;
          const p = make([free[i], free[j], free[k]]);
          if (p.seats >= party) out.push(p);
        }
      }
    }
  }

  // meno spreco, meno tavoli da spostare, meno sedie da aggiungere
  out.sort((a, b) => a.waste - b.waste || a.tables.length - b.tables.length || a.extraChairs - b.extraChairs);
  for (const p of out) {
    const chairs = p.extraChairs > 0 ? `, aggiungendo ${p.extraChairs} sedi${p.extraChairs === 1 ? "a" : "e"}` : "";
    p.reason = `Tavoli ${p.label} sono vicini e liberi: ${p.seats} posti per ${party}${chairs}`;
  }
  return out.slice(0, limit);
}
