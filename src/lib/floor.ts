// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRIA DELLA PIANTINA
// Unità di misura = centimetri reali. 1 cella di griglia = 50 cm.
// Così un tavolo da 2 e uno da 8 hanno dimensioni coerenti fra loro e con la sala.
// Il perimetro può essere un rettangolo o un poligono qualsiasi (muri obliqui).
// ─────────────────────────────────────────────────────────────────────────────
export const CM_PER_CELL = 50;          // lato di una cella della griglia
export const SNAP = 10;                 // aggancio fine: 10 cm
export const MIN_ZOOM = 0.06;
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

export type Sides = { top: boolean; bottom: boolean; left: boolean; right: boolean };

// Distribuisce n posti fra i lati liberi in proporzione alla loro lunghezza:
// su un rettangolo i lati lunghi ricevono più sedie, come nella realtà.
function allocateBySide(n: number, sides: { key: string; len: number }[]): Map<string, number> {
  const out = new Map<string, number>(sides.map((s) => [s.key, 0]));
  const total = sides.reduce((a, s) => a + s.len, 0) || 1;
  // quota proporzionale, poi si assegnano i resti al lato con più spazio per sedia
  let assigned = 0;
  for (const s of sides) {
    const q = Math.floor((n * s.len) / total);
    out.set(s.key, q);
    assigned += q;
  }
  while (assigned < n) {
    let best = sides[0], bestScore = -Infinity;
    for (const s of sides) {
      const score = s.len / (out.get(s.key)! + 1);   // chi ha più spazio libero per sedia
      if (score > bestScore) { bestScore = score; best = s; }
    }
    out.set(best.key, out.get(best.key)! + 1);
    assigned++;
  }
  return out;
}

// Le sedie non finiscono dentro il muro: se un lato è a filo, i posti si
// ridistribuiscono sui lati liberi mantenendo la spaziatura regolare.
export function seatPositions(capacity: number, w: number, h: number, shape: TableShape, blocked?: Sides) {
  const n = Math.min(Math.max(1, capacity), 14);
  const out: Point[] = [];
  const B = blocked ?? { top: false, bottom: false, left: false, right: false };
  const GAP = 24;   // distanza della sedia dal bordo del tavolo

  if (shape === "round") {
    const r = Math.max(w, h) / 2 + GAP;
    const cx = w / 2, cy = h / 2;
    // settori vietati: quelli rivolti verso un muro
    const forbidden: [number, number][] = [];
    if (B.top) forbidden.push([Math.PI, Math.PI * 2]);          // sopra (y negativa)
    if (B.bottom) forbidden.push([0, Math.PI]);
    if (B.left) forbidden.push([Math.PI / 2, (3 * Math.PI) / 2]);
    if (B.right) forbidden.push([(3 * Math.PI) / 2, Math.PI * 2], [0, Math.PI / 2]);
    const allowed = (a: number) => {
      const t = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return !forbidden.some(([s0, e0]) => t > s0 + 0.05 && t < e0 - 0.05);
    };
    if (!forbidden.length) {
      // cerchio completo: spaziatura perfettamente uniforme
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      return out;
    }
    // arco libero più ampio: si distribuiscono i posti al suo interno
    const steps = 720;
    let bestStart = 0, bestLen = 0, curStart: number | null = null;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      if (i < steps && allowed(a)) { if (curStart === null) curStart = a; }
      else if (curStart !== null) {
        const len = a - curStart;
        if (len > bestLen) { bestLen = len; bestStart = curStart; }
        curStart = null;
      }
    }
    if (bestLen === 0) { bestStart = 0; bestLen = Math.PI * 2; }
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? bestStart + bestLen / 2 : bestStart + (bestLen * (i + 0.5)) / n;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return out;
  }

  // rettangolari e quadrati: quote proporzionali alla lunghezza dei lati liberi
  const sides = [
    { key: "top", len: w, free: !B.top },
    { key: "bottom", len: w, free: !B.bottom },
    { key: "left", len: h, free: !B.left },
    { key: "right", len: h, free: !B.right },
  ].filter((s) => s.free);
  const usable = sides.length ? sides : [{ key: "top", len: w, free: true }];
  const alloc = allocateBySide(n, usable.map(({ key, len }) => ({ key, len })));
  for (const { key } of usable) {
    const count = alloc.get(key) ?? 0;
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      if (key === "top") out.push({ x: t * w, y: -GAP });
      if (key === "bottom") out.push({ x: t * w, y: h + GAP });
      if (key === "left") out.push({ x: -GAP, y: t * h });
      if (key === "right") out.push({ x: w + GAP, y: t * h });
    }
  }
  return out;
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
  const w = Number(l.w) > 0 ? Math.round(l.w) : 1200;
  const h = Number(l.h) > 0 ? Math.round(l.h) : 800;
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
