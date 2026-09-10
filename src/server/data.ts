// Query condivise dagli endpoint. Ogni query è scopata per restaurant_id (multi-tenant).
import "server-only";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import type { Bootstrap, DayData, Settings } from "@/lib/types";

export async function getRestaurantBundle(restaurantId?: string | null): Promise<Bootstrap> {
  const rest = restaurantId
    ? (await db.select().from(s.restaurants).where(eq(s.restaurants.id, restaurantId)))[0]
    : (await db.select().from(s.restaurants).where(eq(s.restaurants.slug, "osteria-del-vicolo")))[0];
  if (!rest) throw new Error("Ristorante non trovato");
  const rid = rest.id;
  // Auto-riparazione: ambienti semi-inizializzati (push senza seed) devono comunque funzionare
  let [st] = await db.select().from(s.restaurantSettings).where(eq(s.restaurantSettings.restaurantId, rid));
  if (!st) [st] = await db.insert(s.restaurantSettings).values({ restaurantId: rid }).returning();
  let [ft] = await db.select().from(s.restaurantFeatures).where(eq(s.restaurantFeatures.restaurantId, rid));
  if (!ft) [ft] = await db.insert(s.restaurantFeatures).values({ restaurantId: rid, flags: {} }).returning();
  const rooms = await db.select().from(s.rooms).where(eq(s.rooms.restaurantId, rid)).orderBy(asc(s.rooms.sortOrder));
  const tables = await db.select().from(s.tables).where(eq(s.tables.restaurantId, rid));
  tables.sort((a, b) => Number(a.label) - Number(b.label));
  const combos = await db.select().from(s.tableCombinations).where(eq(s.tableCombinations.restaurantId, rid));
  const periods = await db.select().from(s.servicePeriods).where(eq(s.servicePeriods.restaurantId, rid)).orderBy(asc(s.servicePeriods.sortOrder));
  return {
    restaurant: { id: rid, name: rest.name, slug: rest.slug, plan: rest.plan, subscriptionStatus: rest.subscriptionStatus },
    settings: st as unknown as Settings,
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder })),
    tables: tables.map((t) => ({ id: t.id, roomId: t.roomId, label: t.label, capacity: t.capacity, minCapacity: t.minCapacity, x: t.x, y: t.y, state: t.state as any, note: t.note })),
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
  const waitlist = await db.select().from(s.waitlistEntries)
    .where(and(eq(s.waitlistEntries.restaurantId, restaurantId),
      ne(s.waitlistEntries.status, "seduto"), ne(s.waitlistEntries.status, "andato_via")))
    .orderBy(asc(s.waitlistEntries.createdAt));
  const map = <T extends { createdAt: Date }>(x: T) => ({ ...x, createdAt: x.createdAt.toISOString() });
  return {
    date,
    reservations: reservations.map((r) => ({ ...map(r), createdAt: r.createdAt.toISOString() })),
    seatings: seatings.map((x) => ({
      ...map(x), id: x.id, seatedAt: x.seatedAt.toISOString(),
      expectedEndAt: x.expectedEndAt.toISOString(), actualEndAt: x.actualEndAt?.toISOString() ?? null,
    })),
    waitlist: waitlist.map(map),
  } as unknown as DayData;
}

export async function logActivity(restaurantId: string, staffName: string, action: string, message: string) {
  await db.insert(s.activityLog).values({ restaurantId, staffName, action, message });
}
