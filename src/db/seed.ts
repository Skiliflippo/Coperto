// ─────────────────────────────────────────────────────────────────────────────
// SEED · Osteria del Vicolo (dati reali del locale)
// 3 sale · 18 tavoli · 72 coperti · pranzo 12-15 · cena 19-23:30
// Staff demo: Marco 1234 (titolare) · Sara 1111 · Luca 2222
// Esegui: npx tsx src/db/seed.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as s from "./schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema: s });
const sha = (p: string) => createHash("sha256").update(p).digest("hex");

// Data "locale del ristorante" (Europe/Rome), non del server
function romeDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(d);
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const tsAt = (date: string, time: string, addMin = 0) => {
  const [h, mm] = time.split(":").map(Number);
  // interpreta l'orario come Europe/Rome
  const probe = new Date(`${date}T${hhmm(h * 60 + mm)}:00Z`);
  const rome = new Date(probe.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const diff = probe.getTime() - rome.getTime(); // offset
  return new Date(probe.getTime() + diff + addMin * 60000);
};

async function main() {
  // idempotente: se esiste già l'osteria, ripulisce e ricrea
  const existing = await db.select().from(s.restaurants).where(eq(s.restaurants.slug, "osteria-del-vicolo"));
  if (existing[0]) {
    const rid = existing[0].id;
    for (const t of [s.activityLog, s.waitlistEntries, s.seatings, s.reservations, s.customers,
      s.tableCombinations, s.tables, s.rooms, s.servicePeriods, s.staff,
      s.restaurantFeatures, s.restaurantSettings] as const) {
      await db.delete(t).where(eq((t as any).restaurantId, rid));
    }
    await db.delete(s.restaurants).where(eq(s.restaurants.id, rid));
    console.log("→ dati precedenti rimossi");
  }

  const [rest] = await db.insert(s.restaurants).values({
    slug: "osteria-del-vicolo", name: "Osteria del Vicolo", plan: "trial",
    subscriptionStatus: "trialing", trialEndsAt: new Date(Date.now() + 30 * 86400000),
    onboardedAt: new Date(),   // il locale demo è già configurato
  }).returning();
  const rid = rest.id;
  await db.insert(s.restaurantSettings).values({ restaurantId: rid });
  await db.insert(s.restaurantFeatures).values({ restaurantId: rid, flags: { online_widget: false } });

  // SALE con planimetria in centimetri reali (vista dall'alto, 1 cella griglia = 50 cm)
  const el = (kind: "wall" | "decor", x: number, y: number, w: number, h: number, label = "", rotation = 0) =>
    ({ id: `el_${Math.random().toString(36).slice(2, 10)}`, kind, x, y, w, h, rotation, label });
  const [sala] = await db.insert(s.rooms).values({
    restaurantId: rid, name: "Sala interna", sortOrder: 0,
    layout: {
      w: 1250, h: 850,
      elements: [
        el("wall", 620, 0, 20, 240),          // divisorio ingresso
        el("decor", 1000, 450, 210, 330, "Bancone"),
        el("decor", 40, 640, 190, 180, "Cucina"),
        el("decor", 560, 780, 130, 60, "Ingresso"),
      ],
    },
  }).returning();
  const [dehors] = await db.insert(s.rooms).values({
    restaurantId: rid, name: "Dehors", sortOrder: 1,
    layout: { w: 1150, h: 600, elements: [el("decor", 20, 20, 90, 560, "Facciata"), el("wall", 130, 580, 1000, 18)] },
  }).returning();
  const [soppalco] = await db.insert(s.rooms).values({
    restaurantId: rid, name: "Soppalco", sortOrder: 2,
    layout: { w: 1050, h: 720, elements: [el("wall", 0, 380, 400, 18), el("decor", 30, 420, 170, 270, "Scala")] },
  }).returning();

  // TAVOLI: 6×2 · 8×4 · 3×6 · 1×10 = 72 coperti · geometria reale sulla piantina
  // dimensioni realistiche (~65 cm di fronte a coperto), coerenti con src/lib/floor.ts
  const geo = (cap: number) => {
    const shape = cap <= 2 ? "round" : cap <= 4 ? "square" : "rect";
    if (shape === "round") return { w: 80, h: 80, shape };
    if (shape === "square") return { w: 90, h: 90, shape };
    const perSide = Math.max(2, Math.ceil(cap / 2));
    return { w: Math.min(460, perSide * 65), h: 85, shape };
  };
  type T = { label: string; cap: number; room: string; x: number; y: number; rot?: number };
  const layout: T[] = [
    // Sala interna (44 coperti)
    // 1-2-3 sono la fila dei due posti lungo la parete: accostabili fra loro
    { label: "1", cap: 2, room: sala.id, x: 150, y: 120 }, { label: "2", cap: 2, room: sala.id, x: 300, y: 120 },
    { label: "3", cap: 2, room: sala.id, x: 450, y: 120 }, { label: "4", cap: 4, room: sala.id, x: 160, y: 360 },
    { label: "5", cap: 4, room: sala.id, x: 310, y: 360 }, { label: "6", cap: 4, room: sala.id, x: 300, y: 620 },
    { label: "7", cap: 4, room: sala.id, x: 450, y: 620 }, { label: "8", cap: 6, room: sala.id, x: 780, y: 380 },
    { label: "9", cap: 6, room: sala.id, x: 780, y: 640 }, { label: "10", cap: 10, room: sala.id, x: 900, y: 120 },
    // Dehors (10 coperti)
    { label: "11", cap: 2, room: dehors.id, x: 300, y: 280 }, { label: "12", cap: 4, room: dehors.id, x: 600, y: 280 },
    { label: "13", cap: 4, room: dehors.id, x: 730, y: 280 },
    // Soppalco (18 coperti)
    { label: "14", cap: 2, room: soppalco.id, x: 200, y: 160 }, { label: "15", cap: 2, room: soppalco.id, x: 330, y: 160 },
    { label: "16", cap: 4, room: soppalco.id, x: 680, y: 160 }, { label: "17", cap: 4, room: soppalco.id, x: 830, y: 160 },
    { label: "18", cap: 6, room: soppalco.id, x: 560, y: 520, rot: 90 },
  ];
  const tableRows = await db.insert(s.tables).values(
    layout.map((t) => {
      const g = geo(t.cap);
      // molti tavoli reggono sedie extra: un 2 diventa 3, un 4 diventa 6…
      const maxCap = t.cap <= 2 ? t.cap + 1 : t.cap <= 4 ? t.cap + 2 : t.cap + 2;
      return { restaurantId: rid, roomId: t.room, label: t.label, capacity: t.cap, maxCapacity: maxCap, x: t.x, y: t.y, width: g.w, height: g.h, shape: g.shape, rotation: t.rot ?? 0 };
    })
  ).returning();
  const byLabel: Record<string, typeof tableRows[number]> = {};
  for (const t of tableRows) byLabel[t.label] = t;

  // ACCORPAMENTI: 12+13 (8) e 16+17 (8)
  const [c12] = await db.insert(s.tableCombinations).values({
    restaurantId: rid, roomId: dehors.id, label: "12+13", capacity: 8, tableIds: [byLabel["12"].id, byLabel["13"].id],
  }).returning();
  const [c16] = await db.insert(s.tableCombinations).values({
    restaurantId: rid, roomId: soppalco.id, label: "16+17", capacity: 8, tableIds: [byLabel["16"].id, byLabel["17"].id],
  }).returning();
  const combos = [c12, c16];

  // TURNI
  const [pranzo] = await db.insert(s.servicePeriods).values({ restaurantId: rid, name: "Pranzo", startTime: "12:00", endTime: "15:00", sortOrder: 0 }).returning();
  const [cena] = await db.insert(s.servicePeriods).values({ restaurantId: rid, name: "Cena", startTime: "19:00", endTime: "23:30", sortOrder: 1 }).returning();

  // STAFF
  await db.insert(s.staff).values([
    { restaurantId: rid, name: "Marco", pinHash: sha("1234"), role: "titolare", color: "#E4572E" },
    { restaurantId: rid, name: "Sara", pinHash: sha("1111"), role: "staff", color: "#3B6FD9" },
    { restaurantId: rid, name: "Luca", pinHash: sha("2222"), role: "staff", color: "#2E9A5B" },
  ]);

  // CLIENTI
  const names: Array<[string, string]> = [
    ["Rossi", "333 1234567"], ["Bianchi", "347 9876543"], ["Ferrari", "320 5551234"],
    ["Moretti", "335 4445566"], ["Gallo", "389 1112233"], ["Conti", "366 7778899"],
    ["Esposito", "331 2223344"], ["Ricci", "348 6667788"], ["Marchetti", ""],
    ["De Luca", "339 8889900"], ["Villa", ""], ["Sartori", "342 1010101"],
  ];
  const custRows = await db.insert(s.customers).values(
    names.map(([name, phone], i) => ({ restaurantId: rid, name, phone, visits: (i * 7) % 21, notes: i === 3 ? "Seggiolone, tavolo tranquillo" : "" }))
  ).returning();
  const C = (n: string) => custRows.find((c) => c.name === n)!;

  // PRENOTAZIONI OGGI — un sabato sera realistico (~70% per la sera stessa)
  const today = romeDate(0);
  const tomorrow = romeDate(1);
  type R = { n: string; t: string; p: number; table?: string; combo?: number; note?: string; phone?: string; status?: string; pranzo?: boolean };
  const res: R[] = [
    { n: "Sartori", t: "12:30", p: 2, table: "1", pranzo: true },
    { n: "Villa", t: "13:00", p: 4, table: "5", pranzo: true },
    { n: "Gallo", t: "13:15", p: 6, table: "8", pranzo: true, note: "Compleanno" },
    { n: "Rossi", t: "19:30", p: 4, table: "4" },
    { n: "Bianchi", t: "19:30", p: 2, table: "2" },
    { n: "Moretti", t: "20:00", p: 5, combo: 0, note: "Seggiolone, tavolo tranquillo" },
    { n: "Ferrari", t: "20:00", p: 2 },
    { n: "Gallo", t: "20:15", p: 6 },
    { n: "Conti", t: "20:30", p: 8, table: "10", note: "Tavolo grande vicino alla porta" },
    { n: "Esposito", t: "20:30", p: 3, table: "6" },
    { n: "Ricci", t: "20:45", p: 2 },
    { n: "De Luca", t: "21:00", p: 4 },
    { n: "Marchetti", t: "21:15", p: 2, table: "3" },
    { n: "Bianchi", t: "21:30", p: 6, combo: 1, note: "Anniversario" },
  ];
  const resRows: Array<typeof s.reservations.$inferSelect> = [];
  for (const r of res) {
    const cust = C(r.n);
    const [row] = await db.insert(s.reservations).values({
      restaurantId: rid, customerId: cust.id, guestName: r.n, guestPhone: r.phone ?? cust.phone,
      date: today, time: r.t, partySize: r.p, notes: r.note ?? "",
      assignedTableId: r.table ? byLabel[r.table].id : null,
      assignedComboId: r.combo != null ? combos[r.combo].id : null,
      createdBy: "Marco",
    }).returning();
    resRows.push(row);
  }
  // Futuro (domani: solo inserimento/elenco/piano anteprima)
  await db.insert(s.reservations).values([
    { restaurantId: rid, guestName: "Neri", guestPhone: "333 9991122", date: tomorrow, time: "20:00", partySize: 4, createdBy: "Sara" },
    { restaurantId: rid, guestName: "Greco", guestPhone: "", date: tomorrow, time: "20:30", partySize: 10, notes: "Cena di lavoro", createdBy: "Sara" },
    { restaurantId: rid, guestName: "Fontana", guestPhone: "345 3322110", date: tomorrow, time: "21:00", partySize: 2, createdBy: "Marco" },
  ]);

  // STORICO (7 giorni): serve al confronto "media 7 giorni" del riepilogo
  const dur = (p: number, pranzoTurno: boolean) => (pranzoTurno ? (p >= 9 ? 120 : p >= 7 ? 90 : 60) : (p >= 9 ? 120 : p >= 7 ? 105 : 90));
  for (let d = 1; d <= 6; d++) {
    const date = romeDate(-d);
    const nRes = 12 + ((d * 5) % 6);
    for (let i = 0; i < nRes; i++) {
      const evening = i % 3 !== 2;
      const base = evening ? 19 * 60 : 12 * 60;
      const time = hhmm(base + ((i * 35 + d * 17) % (evening ? 150 : 120)));
      const p = [2, 2, 3, 4, 4, 4, 5, 6][(i + d) % 8];
      const noShow = (i + d) % 9 === 4;
      const cancelled = !noShow && (i + d) % 11 === 6;
      const cust = C(names[(i * 3 + d) % names.length][0]);
      const [r] = await db.insert(s.reservations).values({
        restaurantId: rid, customerId: cust.id, guestName: cust.name, guestPhone: cust.phone,
        date, time, partySize: p, partySizeActual: noShow || cancelled ? null : Math.max(1, p - ((i + d) % 5 === 2 ? 1 : 0)),
        status: noShow ? "no_show" : cancelled ? "cancellata" : "seduta", source: "telefono", createdBy: "Marco",
      }).returning();
      if (r.status === "seduta") {
        const seated = tsAt(date, time, ((i + d) % 3) * 6);
        const dmin = dur(p, !evening);
        await db.insert(s.seatings).values({
          restaurantId: rid, reservationId: r.id, tableIds: [tableRows[i % tableRows.length].id],
          tableLabel: tableRows[i % tableRows.length].label, name: r.guestName,
          partySize: r.partySizeActual!, seatedAt: seated, expectedEndAt: new Date(seated.getTime() + dmin * 60000),
          actualEndAt: new Date(seated.getTime() + (dmin + ((i * d) % 25) - 8) * 60000), status: "chiuso", createdBy: "Sara",
        });
      }
    }
    // qualche walk-in storico
    for (let w = 0; w < 4 + (d % 3); w++) {
      const time = hhmm(19 * 60 + ((w * 41 + d * 13) % 180));
      const p = [2, 2, 3, 4, 6][(w + d) % 5];
      const seated = tsAt(date, time);
      await db.insert(s.seatings).values({
        restaurantId: rid, tableIds: [tableRows[(w * 3) % tableRows.length].id], tableLabel: tableRows[(w * 3) % tableRows.length].label,
        name: "Walk-in", partySize: p, seatedAt: seated, expectedEndAt: new Date(seated.getTime() + 90 * 60000),
        actualEndAt: new Date(seated.getTime() + (82 + w * 6) * 60000), status: "chiuso", createdBy: "Luca",
      });
    }
  }


  console.log("✓ Seed completato:", rest.name, "| tavoli:", tableRows.length, "| prenotazioni oggi:", res.length);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
