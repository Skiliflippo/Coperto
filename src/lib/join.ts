// ─────────────────────────────────────────────────────────────────────────────
// ACCORPAMENTI INTELLIGENTI
// Se un gruppo non entra in nessun tavolo, l'app cerca tavoli VICINI sulla
// piantina, tutti completamente liberi — né occupati né prenotati — la cui somma
// di posti basta per il gruppo. Propone, non decide.
// I tavoli devono formare una CATENA di elementi consecutivi, come quando in sala
// si accostano fisicamente uno di fianco all'altro.
// ─────────────────────────────────────────────────────────────────────────────
import type { TableT } from "./types";
import type { TableStatus } from "./estimates";

export const seatsOf = (t: TableT, withExtraChairs = true) =>
  withExtraChairs ? Math.max(t.capacity, t.maxCapacity || 0) : t.capacity;

// Ingombro allineato agli assi (i tavoli ruotati vengono racchiusi nel loro riquadro)
export function tableBBox(t: TableT) {
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
  const A = tableBBox(a), B = tableBBox(b);
  const gapX = Math.max(0, Math.max(A.x1 - B.x2, B.x1 - A.x2));
  const gapY = Math.max(0, Math.max(A.y1 - B.y2, B.y1 - A.y2));
  const overlapX = Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1);
  const overlapY = Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1);
  const minW = Math.min(A.x2 - A.x1, B.x2 - B.x1);
  const minH = Math.min(A.y2 - A.y1, B.y2 - B.y1);
  // affiancati in orizzontale: distanza laterale piccola e si sovrappongono in verticale
  if (gapX <= maxGap && overlapY > minH / 3) return true;
  // impilati in verticale: distanza sopra/sotto piccola e si sovrappongono in orizzontale
  if (gapY <= maxGap && overlapX > minW / 3) return true;
  return false;
}

// Riquadro complessivo di un gruppo accostato: è la somma reale dei tavoli,
// non un rettangolone. Serve a disegnare in mappa un unico blocco delle
// dimensioni giuste.
export function groupBBox(tables: TableT[], pad = 8) {
  const boxes = tables.map(tableBBox);
  const x1 = Math.min(...boxes.map((b) => b.x1)) - pad;
  const y1 = Math.min(...boxes.map((b) => b.y1)) - pad;
  const x2 = Math.max(...boxes.map((b) => b.x2)) + pad;
  const y2 = Math.max(...boxes.map((b) => b.y2)) + pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Un gruppo è "compatto" se il riquadro che lo contiene non è molto più grande
// della somma dei tavoli: evita di disegnare un blocco enorme quando due tavoli
// accorpati (magari da una vecchia configurazione) stanno in punti lontani.
// tolerance bassa: scarta le catene "con buchi" (es. 1+3 saltando il 2), che
// richiederebbero di spostare fisicamente un tavolo in mezzo.
export function isCompactGroup(tables: TableT[], tolerance = 1.45): boolean {
  if (tables.length < 2) return true;
  const box = groupBBox(tables, 0);
  const own = tables.reduce((sum, t) => {
    const b = tableBBox(t);
    return sum + (b.x2 - b.x1) * (b.y2 - b.y1);
  }, 0);
  return box.w * box.h <= own * tolerance;
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
const isFree = (id: string, statuses?: Map<string, TableStatus>) =>
  !statuses || statuses.get(id)?.state === "libero";

export function findJoinProposals(args: {
  party: number;
  tables: TableT[];
  statuses?: Map<string, TableStatus>;   // assente = si valuta solo la geometria (vista Piano)
  maxGapCm: number;
  maxTables?: number;
  limit?: number;
}): JoinProposal[] {
  const { party, tables, statuses, maxGapCm, maxTables = 4, limit = 4 } = args;
  const free = tables.filter((t) => t.state !== "fuori_servizio" && isFree(t.id, statuses));

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

  // Catene di tavoli consecutivi: si parte da un tavolo e si aggiunge ogni volta
  // un vicino della catena, finché i posti bastano o si raggiunge il massimo.
  const found = new Map<string, JoinProposal>();
  const grow = (chain: TableT[]) => {
    const seats = chain.reduce((a, t) => a + seatsOf(t), 0);
    if (chain.length >= 2 && seats >= party && isCompactGroup(chain)) {
      const p = make(chain);
      if (!found.has(p.label)) found.set(p.label, p);
      return;   // catena minima sufficiente: non serve allungarla ancora
    }
    if (chain.length >= maxTables) return;
    for (const candidate of free) {
      if (chain.includes(candidate)) continue;
      if (!chain.some((t) => areAdjacent(t, candidate, maxGapCm))) continue;
      grow([...chain, candidate]);
    }
  };
  for (const start of free) grow([start]);

  const out = [...found.values()];
  // meno spreco, meno tavoli da spostare, meno sedie da aggiungere
  out.sort((a, b) => a.waste - b.waste || a.tables.length - b.tables.length || a.extraChairs - b.extraChairs);
  for (const p of out) {
    const chairs = p.extraChairs > 0 ? `, aggiungendo ${p.extraChairs} sedi${p.extraChairs === 1 ? "a" : "e"}` : "";
    const quanti = p.tables.length > 2 ? `${p.tables.length} tavoli vicini` : "Tavoli vicini";
    p.reason = `${quanti} e liberi: ${p.seats} posti${chairs}`;
  }
  return out.slice(0, limit);
}
