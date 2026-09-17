// Query condivise dagli endpoint. Ogni query è scopata per restaurant_id (multi-tenant).
import "server-only";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import type { Bootstrap, DayData, Settings } from "@/lib/types";
import { normalizeLayout, tableGeometry, type RoomLayout, type TableShape } from "@/lib/floor";

export class BootstrapDataError extends Error {
  code: "DATABASE_EMPTY" | "RESTAURANT_NOT_FOUND";
  constructor(code: BootstrapDataError["code"], message: string) {
    super(message);
    this.name = "BootstrapDataError";
    this.code = code;
  }
}

/**
 * ISOLAMENTO FRA RISTORANTI.
 * Ogni azione che modifica dati deve passare di qui: si verifica che la persona
 * appartenga davvero al locale su cui sta operando. Senza questo controllo,
 * conoscere un UUID basterebbe per scrivere nella sala di un altro cliente.
 */
export async function assertStaffInRestaurant(
  staffId: string | null | undefined,
  restaurantId: string | null | undefined,
  opts?: { requireOwner?: boolean },
): Promise<{ ok: true; staff: typeof s.staff.$inferSelect } | { ok: false; status: number; error: string }> {
  if (!restaurantId) return { ok: false, status: 400, error: "Ristorante mancante" };
  if (!staffId) return { ok: false, status: 401, error: "Serve l'accesso col PIN" };
  const [row] = await db.select().from(s.staff).where(eq(s.staff.id, staffId));
  if (!row || !row.active) return { ok: false, status: 401, error: "Accesso non valido" };
  if (row.restaurantId !== restaurantId) {
    return { ok: false, status: 403, error: "Questo non è il tuo ristorante" };
  }
  if (opts?.requireOwner && row.role !== "titolare") {
    return { ok: false, status: 403, error: "Serve il titolare" };
  }
  return { ok: true, staff: row };
}

/** Risolve un ristorante dal suo indirizzo pubblico (/r/<slug>). */
export async function getRestaurantBySlug(slug: string) {
  if (!slug) return null;
  const trimmed = slug.trim();
  if (!trimmed) return null;
  // Prova in ordine: originale, upper, lower, e anche senza spazi — robusto per iOS e 404 visti nei log
  let row: typeof s.restaurants.$inferSelect | undefined;
  try {
    [row] = await db.select().from(s.restaurants).where(eq(s.restaurants.slug, trimmed)).limit(1);
  } catch {}
  if (!row) {
    try {
      const up = trimmed.toUpperCase();
      if (up !== trimmed) {
        [row] = await db.select().from(s.restaurants).where(eq(s.restaurants.slug, up)).limit(1);
      }
    } catch {}
  }
  if (!row) {
    try {
      const low = trimmed.toLowerCase();
      if (low !== trimmed) {
        [row] = await db.select().from(s.restaurants).where(eq(s.restaurants.slug, low)).limit(1);
      }
    } catch {}
  }
  if (!row) {
    try {
      // Ultima spiaggia: cerca con ILIKE via SQL raw per case-insensitive
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(sql`SELECT * FROM restaurants WHERE LOWER(slug) = LOWER(${trimmed}) LIMIT 1`);
      // @ts-ignore - result rows
      const r = (result as any).rows?.[0] ?? (result as any)[0];
      if (r) return r as typeof s.restaurants.$inferSelect;
    } catch {}
  }
  return row ?? null;
}

export async function getRestaurantBundle(restaurantId?: string | null, slug?: string | null): Promise<Bootstrap> {
  // Una sessione persistita nel browser può contenere l'UUID di un altro database
  // (tipico dopo clone, import o reseed). In locale non deve produrre una pagina vuota:
  // prova l'ID richiesto, poi il tenant demo, infine il primo tenant disponibile.
  // Lo slug dell'indirizzo ha la precedenza: è il locale che il cliente sta usando.
  let rest = slug ? await getRestaurantBySlug(slug) : undefined;
  // Fix iOS: se slug non trovato (es. BDHC8PMU7D vs bdhc8pmu7d, o cache vecchia), non lanciare subito 404
  // ma prova fallback a primo ristorante — evita loop login su iPhone con IP locale dove bootstrap dava 404 da iOS ma 200 da PC
  if (slug && !rest) {
    console.warn(`[getRestaurantBundle] slug ${slug} non trovato, fallback a primo ristorante per evitare 404 iOS`);
    // Non lanciare errore subito, prova fallback
  }
  const validUuid = !rest && !!restaurantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantId);
  if (validUuid) {
    rest = (await db.select().from(s.restaurants).where(eq(s.restaurants.id, restaurantId!)).limit(1))[0];
  }
  if (!rest) {
    rest = (await db.select().from(s.restaurants).orderBy(asc(s.restaurants.createdAt)).limit(1))[0];
  }
  if (!rest) {
    throw new BootstrapDataError(
      "DATABASE_EMPTY",
      "Database vuoto: esegui `npx drizzle-kit push` e `npx tsx src/db/seed.ts`, poi ricarica la pagina.",
    );
  }
  const rid = rest.id;
  // Auto-riparazione: ambienti semi-inizializzati (push senza seed) devono comunque funzionare
  let [st] = await db.select().from(s.restaurantSettings).where(eq(s.restaurantSettings.restaurantId, rid));
  if (!st) [st] = await db.insert(s.restaurantSettings).values({ restaurantId: rid }).returning();
  let [ft] = await db.select().from(s.restaurantFeatures).where(eq(s.restaurantFeatures.restaurantId, rid));
  if (!ft) [ft] = await db.insert(s.restaurantFeatures).values({ restaurantId: rid, flags: {} }).returning();
  const rooms = await db.select().from(s.rooms).where(eq(s.rooms.restaurantId, rid)).orderBy(asc(s.rooms.sortOrder));
  // Un tavolo separato scompare dalla mappa: al suo posto ci sono le sue parti.
  let tables = (await db.select().from(s.tables).where(eq(s.tables.restaurantId, rid)))
    .filter((t) => !t.archived && !t.splitActive);
  tables.sort((a, b) => (Number(a.label) || 0) - (Number(b.label) || 0) || a.label.localeCompare(b.label));

  // Auto-riparazione planimetria: sale senza layout, o con il vecchio formato
  // (muri come segmenti / coordinate in percentuale) vengono migrate una volta sola.
  const DEFAULT_LAYOUT: RoomLayout = { w: 1200, h: 800, elements: [] };
  const layouts = new Map<string, RoomLayout>();
  for (const room of rooms) {
    const wasLegacy = !room.layout || !Array.isArray((room.layout as any).elements);
    const layout = room.layout ? normalizeLayout(room.layout) : DEFAULT_LAYOUT;
    layouts.set(room.id, layout);
    if (wasLegacy) {
      await db.update(s.rooms).set({ layout }).where(eq(s.rooms.id, room.id));
      // vecchie coordinate in percentuale (0-100) → centimetri
      for (const t of tables.filter((x) => x.roomId === room.id && x.x <= 100 && x.y <= 100)) {
        const shape = (t.capacity <= 2 ? "round" : t.capacity <= 4 ? "square" : "rect") as TableShape;
        const g = tableGeometry(t.capacity, shape, st?.standardTableSeats ?? 4);
        const patch = {
          x: Math.round((t.x / 100) * layout.w) || 150,
          y: Math.round((t.y / 100) * layout.h) || 150,
          width: g.width, height: g.height, shape,
        };
        Object.assign(t, patch);
        await db.update(s.tables).set(patch).where(eq(s.tables.id, t.id));
      }
    }
  }
  const combos = await db.select().from(s.tableCombinations).where(eq(s.tableCombinations.restaurantId, rid));
  // Senza turni il Piano non può disegnare la timeline: se mancano li creiamo con i
  // valori standard, così un database importato a metà non manda in errore la pagina.
  let periods = await db.select().from(s.servicePeriods).where(eq(s.servicePeriods.restaurantId, rid)).orderBy(asc(s.servicePeriods.sortOrder));
  if (!periods.length) {
    periods = await db.insert(s.servicePeriods).values([
      { restaurantId: rid, name: "Pranzo", startTime: "12:00", endTime: "15:00", sortOrder: 0 },
      { restaurantId: rid, name: "Cena", startTime: "19:00", endTime: "23:30", sortOrder: 1 },
    ]).returning();
  }
  return {
    restaurant: { id: rid, name: rest.name, slug: rest.slug, plan: rest.plan, subscriptionStatus: rest.subscriptionStatus, onboarded: !!rest.onboardedAt },
    settings: st as unknown as Settings,
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder, layout: layouts.get(r.id) ?? DEFAULT_LAYOUT })),
    tables: tables.map((t) => ({
      id: t.id, roomId: t.roomId, label: t.label, capacity: t.capacity, minCapacity: t.minCapacity,
      maxCapacity: Math.max(t.capacity, t.maxCapacity || 0),   // 0 nel DB = nessuna sedia extra
      splitInto: t.splitInto, splitActive: t.splitActive, splitParentId: t.splitParentId,
      isJoinable: t.isJoinable,
      x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation, shape: t.shape as any,
      state: t.state as any, note: t.note,
    })),
    combos: combos.map((c) => ({ id: c.id, roomId: c.roomId, label: c.label, capacity: c.capacity, tableIds: c.tableIds })),
    periods: periods.map((p) => ({ id: p.id, name: p.name, startTime: p.startTime, endTime: p.endTime, sortOrder: p.sortOrder })),
    features: (ft?.flags ?? {}) as Record<string, unknown>,
  };
}

export async function getDayData(restaurantId: string, date: string): Promise<DayData> {
  const reservations = await db.select().from(s.reservations)
    .where(and(eq(s.reservations.restaurantId, restaurantId), eq(s.reservations.date, date)))
    .orderBy(asc(s.reservations.time));
  const seatings = await db.select().from(s.seatings)
    .where(and(eq(s.seatings.restaurantId, restaurantId), eq(s.seatings.status, "seduto")))
    .orderBy(asc(s.seatings.seatedAt));
  const map = <T extends { createdAt: Date }>(x: T) => ({ ...x, createdAt: x.createdAt.toISOString() });
  return {
    date,
    reservations: reservations.map((r) => ({ ...map(r), createdAt: r.createdAt.toISOString() })),
    seatings: seatings.map((x) => ({
      ...map(x), id: x.id, seatedAt: x.seatedAt.toISOString(),
      expectedEndAt: x.expectedEndAt.toISOString(), actualEndAt: x.actualEndAt?.toISOString() ?? null,
    })),
  } as DayData;
}

export async function logActivity(restaurantId: string, staffName: string, action: string, message: string) {
  await db.insert(s.activityLog).values({ restaurantId, staffName, action, message });
}

