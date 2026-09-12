// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRIA DELLA PIANTINA
// Unità di misura = centimetri reali. 1 cella di griglia = 50 cm.
// Così un tavolo da 2 e uno da 8 hanno dimensioni coerenti fra loro e con la sala.
// Il perimetro può essere un rettangolo o un poligono qualsiasi (muri obliqui).
// ─────────────────────────────────────────────────────────────────────────────
export const CM_PER_CELL = 50;          // lato di una cella della griglia
export const SNAP = 10;                 // aggancio fine: 10 cm
export const MIN_ZOOM = 0.06;
export const MAX_ROOM_CM = 3000;        // 30 m per lato: copre anche le sale grandi
export const MAX_ZOOM = 2.4;

export type ElementKind = "wall" | "decor";
export type FloorElement = {
  id: string;
  kind: ElementKind;      // wall = muro/divisorio · decor = bancone, cucina, pilastro…
  x: number; y: number;   // angolo alto-sinistro, in cm
  w: number; h: number;
  rotation: number;       // gradi
  label: string;
  icon?: DecorIcon;       // aspetto dell'arredo sulla mappa
};
export type Point = { x: number; y: number };
export type RoomLayout = {
  w: number; h: number;           // riquadro che contiene la sala
  elements: FloorElement[];
  polygon?: Point[];              // perimetro reale; assente = rettangolo w×h
};

export type TableShape = "round" | "square" | "rect";

export const snapTo = (v: number, g: number = SNAP) => Math.round(v / g) * g;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const uid = () => `el_${Math.random().toString(36).slice(2, 10)}`;

// ── ARREDI: pochi, quelli che esistono in ogni locale ────────────────────────
export type DecorIcon = "bancone" | "cucina" | "cassa" | "scala" | "bagno" | "porta" | "pilastro" | "generico";
export const DECOR_PRESETS: { icon: DecorIcon; label: string; w: number; h: number }[] = [
  { icon: "bancone",  label: "Bancone",  w: 240, h: 70 },
  { icon: "cucina",   label: "Cucina",   w: 200, h: 180 },
  { icon: "cassa",    label: "Cassa",    w: 90,  h: 70 },
  { icon: "scala",    label: "Scala",    w: 120, h: 260 },
  { icon: "bagno",    label: "Bagno",    w: 160, h: 160 },
  { icon: "porta",    label: "Ingresso", w: 110, h: 30 },
  { icon: "pilastro", label: "Pilastro", w: 45,  h: 45 },
];

// Il nome guida la forma: scrivi "Bancone bar" e l'oggetto prende l'aspetto giusto.
export function iconFromLabel(label: string, fallback: DecorIcon = "generico"): DecorIcon {
  const s = label.toLowerCase();
  if (/banc|bar\b|buffet/.test(s)) return "bancone";
  if (/cucin|pass|forno/.test(s)) return "cucina";
  if (/cass|conto|pos\b/.test(s)) return "cassa";
  if (/scal|gradin/.test(s)) return "scala";
  if (/bagn|wc|toilet|servizi/.test(s)) return "bagno";
  if (/ingress|porta|entrat|uscita/.test(s)) return "porta";
  if (/pilastr|colonn/.test(s)) return "pilastro";
  return fallback;
}

// Dimensioni realistiche: ~60-65 cm di fronte per coperto.
export function tableGeometry(capacity: number, shape: TableShape): { width: number; height: number } {
  const c = Math.max(1, Math.min(20, capacity));
  if (shape === "round") {
    const d = c <= 2 ? 80 : c <= 4 ? 100 : c <= 6 ? 120 : c <= 8 ? 140 : 160;
    return { width: d, height: d };
  }
  if (shape === "square") {
    const s = c <= 2 ? 70 : c <= 4 ? 90 : 110;
    return { width: s, height: s };
  }
  const perSide = Math.max(2, Math.ceil(c / 2));
  return { width: clamp(perSide * 65, 130, 460), height: 85 };
}

export function suggestShape(capacity: number, current: TableShape): TableShape {
  if (capacity >= 7 && current !== "rect") return "rect";
  return current;
}

// Distanza di un punto da un segmento: base per capire se una sedia finisce
// dentro un muro, anche obliquo.
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export type SeatContext = {
  poly: Point[];       // perimetro della sala
  obstacles: Box[];    // altri tavoli, muri interni, arredi
  taken?: Point[];     // sedie già assegnate ad altri tavoli (coordinate sala)
  clearance?: number;  // spazio minimo dietro la sedia (cm)
};

export const SEAT_RADIUS = 13;     // raggio del pallino sedia, in cm
export const SEAT_MIN_GAP = 32;    // distanza minima fra i centri di due sedie

type SeatTable = {
  x: number; y: number; width: number; height: number;
  rotation: number; capacity: number; shape: TableShape;
};

// Da coordinate locali del tavolo a coordinate della sala (tiene conto della rotazione).
export function seatToWorld(t: SeatTable, local: Point): Point {
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = local.x - t.width / 2, dy = local.y - t.height / 2;
  return { x: t.x + dx * cos - dy * sin, y: t.y + dx * sin + dy * cos };
}

// Un posto è utilizzabile se sta dentro la sala, non è schiacciato contro un muro
// (anche obliquo), non finisce dentro un oggetto e non si sovrappone a una sedia
// di un altro tavolo.
function seatUsable(world: Point, ctx: SeatContext): boolean {
  const clearance = ctx.clearance ?? SEAT_RADIUS + 5;
  if (!pointInPolygon(world, ctx.poly)) return false;
  for (const { a, b } of polygonEdges(ctx.poly)) {
    if (distanceToSegment(world, a, b) < clearance) return false;
  }
  for (const box of ctx.obstacles) {
    const nx = clamp(world.x, box.x, box.x + box.w);
    const ny = clamp(world.y, box.y, box.y + box.h);
    if (Math.hypot(world.x - nx, world.y - ny) < clearance) return false;
  }
  for (const seat of ctx.taken ?? []) {
    if (Math.hypot(world.x - seat.x, world.y - seat.y) < SEAT_MIN_GAP) return false;
  }
  return true;
}

// Tratti liberi contigui in una sequenza campionata. `closed` gestisce l'anello
// (tavolo tondo), dove l'ultimo campione confina col primo.
function freeRuns(flags: boolean[], closed: boolean): { from: number; to: number }[] {
  const n = flags.length;
  const runs: { from: number; to: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i < n; i++) {
    if (flags[i]) { if (start === null) start = i; }
    else if (start !== null) { runs.push({ from: start, to: i - 1 }); start = null; }
  }
  if (start !== null) runs.push({ from: start, to: n - 1 });
  // anello chiuso: se inizio e fine sono liberi, i due tratti sono lo stesso
  if (closed && runs.length > 1 && flags[0] && flags[n - 1]) {
    const first = runs.shift()!;
    const last = runs.pop()!;
    runs.push({ from: last.from, to: first.to + n });   // indici oltre n = wraparound
  }
  return runs;
}

// TAVOLI TONDI: angoli equidistanti sull'arco disponibile.
function roundSeats(t: SeatTable, n: number, gap: number, ctx?: SeatContext): Point[] {
  const r = Math.max(t.width, t.height) / 2 + gap;
  const cx = t.width / 2, cy = t.height / 2;
  const at = (angle: number): Point => ({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });

  // niente vincoli: giro completo, spaziatura perfettamente uniforme
  if (!ctx) return Array.from({ length: n }, (_, i) => at((i / n) * Math.PI * 2 - Math.PI / 2));

  const STEPS = 96;
  const flags: boolean[] = [];
  for (let i = 0; i < STEPS; i++) {
    flags.push(seatUsable(seatToWorld(t, at((i / STEPS) * Math.PI * 2 - Math.PI / 2)), ctx));
  }
  if (flags.every(Boolean)) {
    return Array.from({ length: n }, (_, i) => at((i / n) * Math.PI * 2 - Math.PI / 2));
  }
  const runs = freeRuns(flags, true).sort((a, b) => (b.to - b.from) - (a.to - a.from));
  const best = runs[0];
  // tutto bloccato: meglio i posti standard che nessun posto
  if (!best) return Array.from({ length: n }, (_, i) => at((i / n) * Math.PI * 2 - Math.PI / 2));

  const step = (Math.PI * 2) / STEPS;
  const a0 = best.from * step - Math.PI / 2;
  const arc = (best.to - best.from) * step;
  // (i + 0.5) tiene le sedie staccate dai bordi dell'arco occupato
  return Array.from({ length: n }, (_, i) => at(a0 + (arc * (i + 0.5)) / n));
}

type Side = "top" | "bottom" | "left" | "right";

// TAVOLI RETTANGOLARI/QUADRATI: si valuta quanto spazio libero ha ogni lato e i
// posti si distribuiscono in proporzione, equidistanti dentro il tratto libero.
function rectSeats(t: SeatTable, n: number, gap: number, ctx?: SeatContext): Point[] {
  const { width: w, height: h } = t;
  const geom: Record<Side, { from: Point; to: Point; len: number }> = {
    top: { from: { x: 0, y: -gap }, to: { x: w, y: -gap }, len: w },
    bottom: { from: { x: 0, y: h + gap }, to: { x: w, y: h + gap }, len: w },
    left: { from: { x: -gap, y: 0 }, to: { x: -gap, y: h }, len: h },
    right: { from: { x: w + gap, y: 0 }, to: { x: w + gap, y: h }, len: h },
  };
  const lerp = (side: Side, u: number): Point => {
    const g = geom[side];
    return { x: g.from.x + (g.to.x - g.from.x) * u, y: g.from.y + (g.to.y - g.from.y) * u };
  };
  // i lati corti servono solo su tavoli davvero lunghi (capotavola)
  const sides: Side[] = w >= 170 || h >= 170
    ? ["top", "bottom", "left", "right"]
    : (w >= h ? ["top", "bottom"] : ["left", "right"]);

  // tratto libero più ampio per ciascun lato
  const usable = new Map<Side, { u0: number; u1: number; len: number }>();
  for (const side of sides) {
    if (!ctx) { usable.set(side, { u0: 0, u1: 1, len: geom[side].len }); continue; }
    const STEPS = 24;
    const flags: boolean[] = [];
    for (let i = 0; i < STEPS; i++) {
      flags.push(seatUsable(seatToWorld(t, lerp(side, (i + 0.5) / STEPS)), ctx));
    }
    const runs = freeRuns(flags, false).sort((a, b) => (b.to - b.from) - (a.to - a.from));
    const best = runs[0];
    if (!best) continue;
    const u0 = best.from / STEPS, u1 = (best.to + 1) / STEPS;
    const len = (u1 - u0) * geom[side].len;
    if (len < SEAT_MIN_GAP * 0.6) continue;       // tratto troppo corto per una sedia
    usable.set(side, { u0, u1, len });
  }
  // nessun lato libero: si torna alla disposizione standard
  if (!usable.size) return rectSeats(t, n, gap);

  // quote proporzionali alla lunghezza libera, resti al lato con più spazio per sedia
  const entries = [...usable.entries()];
  const total = entries.reduce((a, [, v]) => a + v.len, 0) || 1;
  const count = new Map<Side, number>(entries.map(([side]) => [side, 0]));
  let assigned = 0;
  for (const [side, v] of entries) {
    const q = Math.floor((n * v.len) / total);
    count.set(side, q);
    assigned += q;
  }
  while (assigned < n) {
    let bestSide = entries[0][0], bestScore = -Infinity;
    for (const [side, v] of entries) {
      const score = v.len / (count.get(side)! + 1);
      if (score > bestScore) { bestScore = score; bestSide = side; }
    }
    count.set(bestSide, count.get(bestSide)! + 1);
    assigned++;
  }

  const out: Point[] = [];
  for (const [side, v] of entries) {
    const k = count.get(side) ?? 0;
    for (let i = 0; i < k; i++) out.push(lerp(side, v.u0 + ((v.u1 - v.u0) * (i + 0.5)) / k));
  }
  return out;
}

// POSTI A SEDERE — unica funzione usata da mappa in servizio ed editor.
export function tableSeats(t: SeatTable, ctx?: SeatContext, gap = 24): Point[] {
  const n = Math.min(Math.max(1, t.capacity), 14);
  return t.shape === "round" ? roundSeats(t, n, gap, ctx) : rectSeats(t, n, gap, ctx);
}

// Calcola i posti di TUTTI i tavoli di una sala in un colpo solo: ogni tavolo
// vede le sedie già piazzate dai precedenti, così due tavoli vicini non si
// contendono lo stesso spazio. I tavoli grandi hanno la precedenza.
export function computeRoomSeats<T extends SeatTable & { id: string; label?: string }>(
  tables: T[], poly: Point[], obstacles: Box[],
): Map<string, Point[]> {
  const order = [...tables].sort((a, b) =>
    b.capacity - a.capacity || (a.label ?? a.id).localeCompare(b.label ?? b.id));
  const boxes = new Map(order.map((t) => [t.id, aabb(t.x, t.y, t.width, t.height, t.rotation)]));
  const taken: Point[] = [];
  const result = new Map<string, Point[]>();
  for (const t of order) {
    const others = order.filter((o) => o.id !== t.id).map((o) => boxes.get(o.id)!);
    const seats = tableSeats(t, { poly, obstacles: [...obstacles, ...others], taken });
    result.set(t.id, seats);
    for (const seat of seats) taken.push(seatToWorld(t, seat));
  }
  return result;
}

// ── PERIMETRO ────────────────────────────────────────────────────────────────
export const rectPolygon = (w: number, h: number): Point[] =>
  [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

export const polygonOf = (l: RoomLayout): Point[] =>
  l.polygon && l.polygon.length >= 3 ? l.polygon : rectPolygon(l.w, l.h);

export function polygonBounds(poly: Point[]) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

// Punto dentro il perimetro (ray casting) — serve per non piazzare fuori dai muri.
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Un rettangolo sta dentro la sala se sta dentro il perimetro. Si testa leggermente
// rimpicciolito (eps) così un muro o un tavolo APPOGGIATO al perimetro è valido:
// senza tolleranza il ray casting sul bordo esatto darebbe "fuori".
export function rectInsideRoom(x: number, y: number, w: number, h: number, poly: Point[], eps = 2): boolean {
  const e = Math.min(eps, w / 4, h / 4);
  return [
    { x: x + e, y: y + e }, { x: x + w - e, y: y + e },
    { x: x + e, y: y + h - e }, { x: x + w - e, y: y + h - e },
    { x: x + w / 2, y: y + h / 2 },
  ].every((p) => pointInPolygon(p, poly));
}

// Riporta un punto dentro il perimetro spostandolo al vertice più vicino del bordo.
export function clampPointToRoom(p: Point, poly: Point[]): Point {
  if (pointInPolygon(p, poly)) return p;
  let best = p, bestD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  // rientra di qualche centimetro, così non resta esattamente sul muro
  const c = centroid(poly);
  const k = 6 / (Math.hypot(c.x - best.x, c.y - best.y) || 1);
  return { x: best.x + (c.x - best.x) * k, y: best.y + (c.y - best.y) * k };
}

export function centroid(poly: Point[]): Point {
  const n = poly.length || 1;
  return { x: poly.reduce((a, p) => a + p.x, 0) / n, y: poly.reduce((a, p) => a + p.y, 0) / n };
}

export function normalizeLayout(raw: unknown): RoomLayout {
  const l = (raw ?? {}) as Record<string, any>;
  const w = Number(l.w) > 0 ? clamp(Math.round(l.w), 400, MAX_ROOM_CM) : 1200;
  const h = Number(l.h) > 0 ? clamp(Math.round(l.h), 400, MAX_ROOM_CM) : 800;
  const polygon = Array.isArray(l.polygon) && l.polygon.length >= 3
    ? l.polygon.map((p: any) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
    : undefined;
  if (Array.isArray(l.elements)) {
    return {
      w, h, polygon,
      elements: l.elements.map((e: any) => ({
        id: String(e.id ?? uid()),
        kind: e.kind === "decor" ? "decor" : "wall",
        x: Math.round(e.x ?? 0), y: Math.round(e.y ?? 0),
        w: Math.max(10, Math.round(e.w ?? 100)), h: Math.max(10, Math.round(e.h ?? 20)),
        rotation: Math.round(e.rotation ?? 0),
        label: String(e.label ?? ""),
        icon: (e.icon as DecorIcon) ?? (e.kind === "decor" ? iconFromLabel(String(e.label ?? "")) : undefined),
      })),
    };
  }
  // formato storico: muri come segmenti + oggetti
  const elements: FloorElement[] = [];
  for (const s of (l.walls ?? []) as any[]) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const ang = (Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI;
    elements.push({ id: uid(), kind: "wall", x: Math.round(s.x1), y: Math.round(s.y1 - 9), w: Math.max(20, Math.round(len)), h: 18, rotation: Math.round(ang), label: "" });
  }
  for (const o of (l.objects ?? []) as any[]) {
    const label = String(o.label ?? "");
    elements.push({ id: uid(), kind: "decor", x: Math.round(o.x), y: Math.round(o.y), w: Math.max(20, Math.round(o.w)), h: Math.max(20, Math.round(o.h)), rotation: 0, label, icon: iconFromLabel(label) });
  }
  return { w, h, polygon, elements };
}

// ── COLLISIONI, MAGNETE E VINCOLI ────────────────────────────────────────────
export type Box = { x: number; y: number; w: number; h: number };
export const boxOf = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

// Ingombro allineato agli assi di un oggetto ruotato
export function aabb(cx: number, cy: number, w: number, h: number, rotation: number): Box {
  const rad = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const bw = w * c + h * s, bh = w * s + h * c;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}
export const elementBox = (e: FloorElement): Box =>
  e.rotation ? aabb(e.x + e.w / 2, e.y + e.h / 2, e.w, e.h, e.rotation) : { x: e.x, y: e.y, w: e.w, h: e.h };

export function boxesOverlap(a: Box, b: Box, tolerance = 2): boolean {
  return a.x + a.w - tolerance > b.x && b.x + b.w - tolerance > a.x
    && a.y + a.h - tolerance > b.y && b.y + b.h - tolerance > a.y;
}
export const boxInsideRoom = (b: Box, poly: Point[]) => rectInsideRoom(b.x, b.y, b.w, b.h, poly);

// Segmenti del perimetro: servono al magnete e ai controlli di attraversamento
export function polygonEdges(poly: Point[]): { a: Point; b: Point }[] {
  return poly.map((p, i) => ({ a: p, b: poly[(i + 1) % poly.length] }));
}

// MAGNETE: se un lato dell'oggetto passa vicino a un muro (o a un altro oggetto),
// lo si appoggia a filo. Sotto la soglia scatta, sopra resta libero.
export function snapBoxToWalls(box: Box, poly: Point[], others: Box[], threshold = 26): Box {
  let { x, y } = box;
  const edgesX: number[] = [], edgesY: number[] = [];
  for (const { a, b } of polygonEdges(poly)) {
    if (Math.abs(a.x - b.x) < 1) edgesX.push(a.x);        // muro verticale
    if (Math.abs(a.y - b.y) < 1) edgesY.push(a.y);        // muro orizzontale
  }
  for (const o of others) { edgesX.push(o.x, o.x + o.w); edgesY.push(o.y, o.y + o.h); }
  let bestX = threshold, bestY = threshold;
  for (const ex of edgesX) {
    if (Math.abs(box.x - ex) < bestX) { bestX = Math.abs(box.x - ex); x = ex; }
    if (Math.abs(box.x + box.w - ex) < bestX) { bestX = Math.abs(box.x + box.w - ex); x = ex - box.w; }
  }
  for (const ey of edgesY) {
    if (Math.abs(box.y - ey) < bestY) { bestY = Math.abs(box.y - ey); y = ey; }
    if (Math.abs(box.y + box.h - ey) < bestY) { bestY = Math.abs(box.y + box.h - ey); y = ey - box.h; }
  }
  return { ...box, x, y };
}

// Lati del tavolo appoggiati a un muro o a un altro oggetto: lì non ci stanno sedie.
export function blockedSides(box: Box, poly: Point[], others: Box[], gap = 26) {
  const near = (v: number, t: number) => Math.abs(v - t) <= gap;
  const res = { top: false, bottom: false, left: false, right: false };
  for (const { a, b } of polygonEdges(poly)) {
    if (Math.abs(a.x - b.x) < 1) {
      const within = Math.min(a.y, b.y) < box.y + box.h && Math.max(a.y, b.y) > box.y;
      if (within && near(box.x, a.x)) res.left = true;
      if (within && near(box.x + box.w, a.x)) res.right = true;
    }
    if (Math.abs(a.y - b.y) < 1) {
      const within = Math.min(a.x, b.x) < box.x + box.w && Math.max(a.x, b.x) > box.x;
      if (within && near(box.y, a.y)) res.top = true;
      if (within && near(box.y + box.h, a.y)) res.bottom = true;
    }
  }
  for (const o of others) {
    const overlapX = o.x < box.x + box.w && o.x + o.w > box.x;
    const overlapY = o.y < box.y + box.h && o.y + o.h > box.y;
    if (overlapY && near(box.x, o.x + o.w)) res.left = true;
    if (overlapY && near(box.x + box.w, o.x)) res.right = true;
    if (overlapX && near(box.y, o.y + o.h)) res.top = true;
    if (overlapX && near(box.y + box.h, o.y)) res.bottom = true;
  }
  return res;
}

export function fitView(roomW: number, roomH: number, viewW: number, viewH: number, pad = 48) {
  const zoom = clamp(Math.min((viewW - pad * 2) / roomW, (viewH - pad * 2) / roomH), MIN_ZOOM, MAX_ZOOM);
  return { zoom, panX: (viewW - roomW * zoom) / 2, panY: (viewH - roomH * zoom) / 2 };
}
