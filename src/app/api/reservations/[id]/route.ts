import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { assertStaffInRestaurant, logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Modifica prenotazione: assegna/sposta tavolo, cambia ora/giorno/coperti, stato.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json();
  const { restaurantId, staffName = "", action, ...f } = b;
  const [cur] = await db.select().from(s.reservations).where(eq(s.reservations.id, id));
  if (!cur) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  const guard = await assertStaffInRestaurant(b.staffId, cur.restaurantId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const patch: Partial<typeof s.reservations.$inferInsert> = { updatedAt: new Date() };
  let msg = "";
  if (action === "assign") {
    let joinedIds: string[] = Array.isArray(f.joinedTableIds)
      ? [...new Set((f.joinedTableIds as unknown[])
          .filter((value): value is string => typeof value === "string"))]
      : [];

    // Capienza verificata sul server. Un singolo tavolo troppo piccolo non è una
    // decisione discrezionale: è un dato fisico. Per le tavolate si sommano
    // tavolo principale + joinedTableIds.
    if (f.tableId) {
      const mainTableId = String(f.tableId);
      joinedIds = joinedIds.filter((id) => id !== mainTableId);
      const ids = [...new Set([mainTableId, ...joinedIds])];
      const rows = await db.select().from(s.tables).where(inArray(s.tables.id, ids));
      if (rows.length !== ids.length || rows.some((table) => table.restaurantId !== cur.restaurantId || table.archived)) {
        return NextResponse.json({ error: "Uno dei tavoli non appartiene a questo ristorante" }, { status: 403 });
      }
      const capacity = rows.reduce((sum, table) => sum + Math.max(table.capacity, table.maxCapacity || 0), 0);
      if (capacity < cur.partySize) {
        return NextResponse.json({
          error: `Posti insufficienti: ${capacity} disponibili per ${cur.partySize} persone`,
          capacity,
          missing: cur.partySize - capacity,
        }, { status: 409 });
      }
    } else if (f.comboId) {
      const [combo] = await db.select().from(s.tableCombinations).where(eq(s.tableCombinations.id, String(f.comboId)));
      if (!combo || combo.restaurantId !== cur.restaurantId) {
        return NextResponse.json({ error: "Accorpamento non valido per questo ristorante" }, { status: 403 });
      }
      if (combo.capacity < cur.partySize) {
        return NextResponse.json({
          error: `Posti insufficienti: ${combo.capacity} disponibili per ${cur.partySize} persone`,
          capacity: combo.capacity,
          missing: cur.partySize - combo.capacity,
        }, { status: 409 });
      }
    }

    patch.assignedTableId = f.tableId ?? null;
    patch.assignedComboId = f.comboId ?? null;
    patch.joinedTableIds = joinedIds;
    if (f.time) patch.time = f.time;
    const lbl = f.label ? `tavolo ${f.label}` : "nessun tavolo";
    msg = `${staffName}: ${cur.guestName} → ${lbl}${f.time ? ` alle ${f.time}` : ""}`;
  } else if (action === "status") {
    patch.status = f.status;
    const labels: Record<string, string> = { no_show: "segnato no-show", cancellata: "cancellato", confermata: "riaperto" };
    msg = `${staffName} ha ${labels[f.status] ?? f.status}: ${cur.guestName}`;
    // no-show: aggiorna storico cliente (mai automatico, solo su azione esplicita)
    if (f.status === "no_show" && cur.customerId) {
      const [c] = await db.select().from(s.customers).where(eq(s.customers.id, cur.customerId));
      if (c) await db.update(s.customers).set({ noShows: c.noShows + 1, lastNoShowAt: new Date() }).where(eq(s.customers.id, c.id));
    }
  } else {
    if (f.time) patch.time = f.time;
    if (f.date) patch.date = f.date;
    if (f.partySize) {
      const nextParty = Math.max(1, Math.min(80, Number(f.partySize)));
      patch.partySize = nextParty;
      // Se la prenotazione cresce oltre i tavoli già scelti, torna da sistemare.
      if (cur.assignedTableId) {
        const ids = [cur.assignedTableId, ...(cur.joinedTableIds ?? [])];
        const rows = await db.select().from(s.tables).where(inArray(s.tables.id, ids));
        const capacity = rows.reduce((sum, table) => sum + Math.max(table.capacity, table.maxCapacity || 0), 0);
        if (capacity < nextParty) {
          patch.assignedTableId = null;
          patch.assignedComboId = null;
          patch.joinedTableIds = [];
        }
      } else if (cur.assignedComboId) {
        const [combo] = await db.select().from(s.tableCombinations).where(eq(s.tableCombinations.id, cur.assignedComboId));
        if (!combo || combo.capacity < nextParty) {
          patch.assignedComboId = null;
          patch.joinedTableIds = [];
        }
      }
    }
    if (f.notes !== undefined) patch.notes = f.notes;
    if (f.guestName) patch.guestName = f.guestName;
    if (f.guestPhone !== undefined) patch.guestPhone = f.guestPhone;
    if (f.preferredRoomId !== undefined) patch.preferredRoomId = f.preferredRoomId || null;
    msg = `${staffName} ha modificato ${cur.guestName}${f.time ? ` → ${f.time}` : ""}${f.partySize ? `, ${f.partySize} p.` : ""}`;
  }
  const [row] = await db.update(s.reservations).set(patch).where(eq(s.reservations.id, id)).returning();
  await logActivity(restaurantId, staffName, "reservation_updated", msg);
  broadcast(restaurantId, { actor: staffName, msg });
  return NextResponse.json({ reservation: row });
}
