import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Siedi: crea l'occupazione reale. Se c'è prenotazione la collega (deviazioni = differenza tra le due).
export async function POST(req: Request) {
  const b = await req.json();
  const { restaurantId, tableIds, tableLabel, partySize, name = "", note = "",
    reservationId, waitlistId, expectedEndAt, createdBy = "" } = b;
  if (!restaurantId || !tableIds?.length || !partySize || !expectedEndAt) {
    return NextResponse.json({ error: "Campi mancanti" }, { status: 400 });
  }
  // Conflitto multi-dispositivo: il tavolo è appena stato occupato da qualcun altro?
  const active = await db.select().from(s.seatings)
    .where(and(eq(s.seatings.restaurantId, restaurantId), eq(s.seatings.status, "seduto")));
  const clash = active.find((x) => x.tableIds.some((id: string) => tableIds.includes(id)));
  if (clash) {
    return NextResponse.json({ conflict: true, occupiedBy: clash.createdBy || "un collega", tableLabel: clash.tableLabel },
      { status: 409 });
  }
  // i tavoli devono essere "liberi" (non fuori servizio / non da pulire)
  const tRows = await db.select().from(s.tables).where(inArray(s.tables.id, tableIds));
  const blocked = tRows.find((t) => t.state !== "libero");
  if (blocked) {
    return NextResponse.json({ conflict: true, occupiedBy: blocked.state === "da_pulire" ? "in pulizia" : "fuori servizio", tableLabel: blocked.label }, { status: 409 });
  }
  const [row] = await db.insert(s.seatings).values({
    restaurantId, reservationId: reservationId ?? null, waitlistId: waitlistId ?? null,
    tableIds, tableLabel, partySize, name, note, expectedEndAt: new Date(expectedEndAt), createdBy,
  }).returning();
  if (reservationId) {
    await db.update(s.reservations)
      .set({ status: "seduta", partySizeActual: partySize, assignedTableId: tRows.length === 1 ? tRows[0].id : null, updatedAt: new Date() })
      .where(eq(s.reservations.id, reservationId));
  }
  if (waitlistId) {
    await db.update(s.waitlistEntries).set({ status: "seduto", seatedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.waitlistEntries.id, waitlistId));
  }
  // contatore visite cliente (fedeltà implicita)
  if (reservationId) {
    const [r] = await db.select().from(s.reservations).where(eq(s.reservations.id, reservationId));
    if (r?.customerId) {
      const [c] = await db.select().from(s.customers).where(eq(s.customers.id, r.customerId));
      if (c) await db.update(s.customers).set({ visits: c.visits + 1 }).where(eq(s.customers.id, c.id));
    }
  }
  const who = name || "Walk-in";
  const msg = `${createdBy} ha seduto ${who} (${partySize}) al tavolo ${tableLabel}`;
  await logActivity(restaurantId, createdBy, "seating_created", msg);
  broadcast(restaurantId, { actor: createdBy, msg, kind: "seating" });
  return NextResponse.json({ seating: row });
}
