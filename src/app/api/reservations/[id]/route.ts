import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Modifica prenotazione: assegna/sposta tavolo, cambia ora/giorno/coperti, stato.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json();
  const { restaurantId, staffName = "", action, ...f } = b;
  const [cur] = await db.select().from(s.reservations).where(eq(s.reservations.id, id));
  if (!cur) return NextResponse.json({ error: "Non trovata" }, { status: 404 });

  const patch: Partial<typeof s.reservations.$inferInsert> = { updatedAt: new Date() };
  let msg = "";
  if (action === "assign") {
    patch.assignedTableId = f.tableId ?? null;
    patch.assignedComboId = f.comboId ?? null;
    patch.joinedTableIds = Array.isArray(f.joinedTableIds) ? f.joinedTableIds : [];
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
    if (f.partySize) patch.partySize = f.partySize;
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
