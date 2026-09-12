// ─────────────────────────────────────────────────────────────────────────────
// AGGIUNTA IN BLOCCO DEI TAVOLI (solo alla prima creazione di una sala)
// Il titolare dichiara quanti tavoli ha per ogni capienza; l'app li dispone su
// una griglia dentro il perimetro. Poi si aggiustano trascinandoli: molto più
// veloce che disegnarne trenta a mano.
// ─────────────────────────────────────────────────────────────────────────────
import {
  polygonOf, rectInsideRoom, tableGeometry,
  type Point, type RoomLayout, type TableShape,
} from "./floor";

export type BulkRow = { capacity: number; count: number; shape: TableShape };

export type BulkTable = {
  id: string; label: string; capacity: number; maxCapacity: number; shape: TableShape;
  x: number; y: number; width: number; height: number; rotation: number; isNew: true;
};

/** Righe iniziali: le taglie che esistono in quasi ogni sala. */
export const defaultBulkRows = (): BulkRow[] => [
  { capacity: 2, count: 4, shape: "round" },
  { capacity: 4, count: 6, shape: "square" },
  { capacity: 6, count: 2, shape: "rect" },
];

/**
 * Dispone i tavoli in righe ordinate dentro il perimetro, dai più grandi ai più
 * piccoli. Restituisce anche quelli che non ci stanno, così l'interfaccia può
 * dirlo invece di piazzarli fuori dai muri.
 */
export function layoutBulkTables(rows: BulkRow[], layout: RoomLayout, startNumber = 1) {
  const poly = polygonOf(layout);
  const margin = 60;                 // respiro dai muri, per far passare le persone
  const gapX = 70, gapY = 90;        // corridoi fra i tavoli

  const wanted = rows
    .filter((r) => r.count > 0 && r.capacity > 0)
    .flatMap((r) => Array.from({ length: r.count }, () => ({ capacity: r.capacity, shape: r.shape })))
    .sort((a, b) => b.capacity - a.capacity);

  const placed: BulkTable[] = [];
  let label = startNumber;
  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0;
  let skipped = 0;

  const fits = (x: number, y: number, w: number, h: number) =>
    rectInsideRoom(x, y, w, h, poly) &&
    !placed.some((t) => {
      const ax = t.x - t.width / 2, ay = t.y - t.height / 2;
      return x < ax + t.width + gapX * 0.4 && ax < x + w + gapX * 0.4
        && y < ay + t.height + gapY * 0.4 && ay < y + h + gapY * 0.4;
    });

  for (const item of wanted) {
    const g = tableGeometry(item.capacity, item.shape);
    let done = false;

    // scorre a destra, poi va a capo, finché trova posto
    for (let attempt = 0; attempt < 400 && !done; attempt++) {
      if (cursorX + g.width > layout.w - margin) {   // a capo
        cursorX = margin;
        cursorY += rowHeight + gapY;
        rowHeight = 0;
      }
      if (cursorY + g.height > layout.h - margin) break;   // sala finita

      if (fits(cursorX, cursorY, g.width, g.height)) {
        placed.push({
          id: `bulk_${label}_${Math.random().toString(36).slice(2, 8)}`,
          label: String(label++),
          capacity: item.capacity,
          maxCapacity: item.capacity + (item.capacity <= 2 ? 1 : 2),
          shape: item.shape,
          x: Math.round(cursorX + g.width / 2),
          y: Math.round(cursorY + g.height / 2),
          width: g.width, height: g.height, rotation: 0, isNew: true,
        });
        rowHeight = Math.max(rowHeight, g.height);
        cursorX += g.width + gapX;
        done = true;
      } else {
        cursorX += 25;   // prova poco più in là (utile con piante irregolari)
      }
    }
    if (!done) skipped++;
  }

  return { tables: placed, skipped };
}

export const totalCovers = (rows: BulkRow[]) =>
  rows.reduce((sum, r) => sum + Math.max(0, r.capacity) * Math.max(0, r.count), 0);
export const totalTables = (rows: BulkRow[]) =>
  rows.reduce((sum, r) => sum + Math.max(0, r.count), 0);

export type { Point };
