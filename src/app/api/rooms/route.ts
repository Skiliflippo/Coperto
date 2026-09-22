import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { broadcast } from "@/server/hub";
import { assertStaffInRestaurant, logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

const sha = (pin: string) => createHash("sha256").update(pin).digest("hex");

// Elimina una sala e i suoi tavoli. Azione seria e irreversibile sulla piantina:
// oltre al ruolo di titolare si richiede di riscrivere il PIN, come conferma.
export async function DELETE(req: Request) {
  const { restaurantId, staffId, pin, roomId } = await req.json();
  if (!restaurantId || !roomId) return NextResponse.json({ error: "Parametri mancanti" }, { status: 400 });

  const guard = await assertStaffInRestaurant(staffId, restaurantId, { requireOwner: true });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error === "Serve il titolare" ? "Solo il titolare può eliminare una sala" : guard.error }, { status: guard.status });
  }
  const owner = guard.staff;
  if (!/^\d{4}$/.test(String(pin)) || owner.pinHash !== sha(String(pin))) {
    return NextResponse.json({ error: "PIN sbagliato" }, { status: 401 });
  }

  const [room] = await db.select().from(s.rooms)
    .where(and(eq(s.rooms.id, roomId), eq(s.rooms.restaurantId, restaurantId)));
  if (!room) return NextResponse.json({ error: "Sala non trovata" }, { status: 404 });

  const rooms = await db.select().from(s.rooms).where(eq(s.rooms.restaurantId, restaurantId));
  if (rooms.length <= 1) {
    return NextResponse.json({ error: "Deve restare almeno una sala" }, { status: 409 });
  }

  // Non si cancella una sala con gente seduta: prima si libera il servizio in corso.
  const roomTables = await db.select().from(s.tables)
    .where(and(eq(s.tables.restaurantId, restaurantId), eq(s.tables.roomId, roomId)));
  const tableIds = roomTables.map((t) => t.id);
  if (tableIds.length) {
    const active = await db.select().from(s.seatings)
      .where(and(eq(s.seatings.restaurantId, restaurantId), eq(s.seatings.status, "seduto")));
    if (active.some((x) => (x.tableIds ?? []).some((id: string) => tableIds.includes(id)))) {
      return NextResponse.json({ error: "C'è gente seduta in questa sala: libera i tavoli prima" }, { status: 409 });
    }
  }

  // Tavoli e accorpamenti hanno ON DELETE CASCADE verso la sala: spariscono con lei.
  // Lo storico dei servizi resta comunque leggibile perché ogni occupazione salva
  // il numero del tavolo (tableLabel) al momento della seduta.
  await db.delete(s.rooms).where(eq(s.rooms.id, roomId));

  const msg = `${owner.name} ha eliminato la sala ${room.name}`;
  await logActivity(restaurantId, owner.name, "room_deleted", msg);
  broadcast(restaurantId, { actor: owner.name, msg });
  return NextResponse.json({ ok: true, removedTables: tableIds.length });
}
