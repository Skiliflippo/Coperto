import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { assertStaffInRestaurant, logActivity } from "@/server/data";
import { splitTableParts } from "@/lib/floor";
export const dynamic = "force-dynamic";

/**
 * STACCA un tavolo grande nelle sue parti (es. il 12 da 8 → 12a e 12b da 4).
 * È un'azione di sala, non di configurazione: la fa chiunque sia in servizio,
 * tipicamente quando arriva un gruppo piccolo e non resta altro che un tavolone.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { restaurantId, staffId, staffName = "" } = await req.json().catch(() => ({}));

  const [table] = await db.select().from(s.tables).where(eq(s.tables.id, id));
  if (!table) return NextResponse.json({ error: "Tavolo non trovato" }, { status: 404 });
  const guard = await assertStaffInRestaurant(staffId, table.restaurantId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  if (table.splitActive) return NextResponse.json({ error: "Questo tavolo è già staccato" }, { status: 409 });
  if (table.splitInto < 2) {
    return NextResponse.json({ error: `Il tavolo ${table.label} non è staccabile` }, { status: 409 });
  }

  // Non si stacca un tavolo con gente seduta: prima si libera.
  const active = await db.select().from(s.seatings)
    .where(and(eq(s.seatings.restaurantId, table.restaurantId), eq(s.seatings.status, "seduto")));
  if (active.some((x) => x.tableIds.includes(id))) {
    return NextResponse.json({ error: `C'è gente seduta al tavolo ${table.label}` }, { status: 409 });
  }

  const [settings] = await db.select().from(s.restaurantSettings)
    .where(eq(s.restaurantSettings.restaurantId, table.restaurantId));
  const std = settings?.standardTableSeats ?? 4;
  const parts = splitTableParts(table, table.splitInto, std);
  const existing = await db.select().from(s.tables).where(eq(s.tables.restaurantId, table.restaurantId));
  const used = new Set(existing.filter((t) => !t.archived).map((t) => t.label));
  if (parts.some((p) => used.has(p.label))) {
    return NextResponse.json({ error: "I numeri delle parti sono già usati" }, { status: 409 });
  }

  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(s.tables).values(parts.map((p) => ({
      restaurantId: table.restaurantId,
      roomId: table.roomId,
      label: p.label,
      capacity: p.capacity,
      maxCapacity: p.capacity + 1,      // una sedia in più ci sta sempre
      minCapacity: 1,
      x: p.x, y: p.y, width: p.width, height: p.height,
      rotation: p.rotation, shape: table.shape,
      splitParentId: table.id,
    }))).returning();
    await tx.update(s.tables).set({ splitActive: true, updatedAt: new Date() }).where(eq(s.tables.id, id));
    return rows;
  });

  const labels = created.map((t) => t.label).join(" e ");
  const msg = `${staffName} ha staccato il tavolo ${table.label} in ${labels}`;
  await logActivity(table.restaurantId, staffName, "table_split", msg);
  broadcast(restaurantId ?? table.restaurantId, { actor: staffName, msg });
  return NextResponse.json({
    ok: true,
    parts: created.map((t) => ({ id: t.id, label: t.label, capacity: t.capacity })),
  });
}

/** RIUNISCE le parti: torna il tavolo grande di partenza. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staffId, staffName = "" } = await req.json().catch(() => ({}));

  const [target] = await db.select().from(s.tables).where(eq(s.tables.id, id));
  if (!target) return NextResponse.json({ error: "Tavolo non trovato" }, { status: 404 });
  const guard = await assertStaffInRestaurant(staffId, target.restaurantId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  // si può chiamare sia sul padre sia su una delle parti
  const parentId = target.splitParentId ?? target.id;
  const [parent] = await db.select().from(s.tables).where(eq(s.tables.id, parentId));
  if (!parent?.splitActive) return NextResponse.json({ error: "Non c'è niente da riunire" }, { status: 409 });

  const children = await db.select().from(s.tables).where(eq(s.tables.splitParentId, parentId));
  const childIds = children.map((c) => c.id);

  const active = await db.select().from(s.seatings)
    .where(and(eq(s.seatings.restaurantId, parent.restaurantId), eq(s.seatings.status, "seduto")));
  const busy = children.filter((c) => active.some((x) => x.tableIds.includes(c.id)));
  if (busy.length) {
    return NextResponse.json(
      { error: `C'è gente seduta al tavolo ${busy.map((c) => c.label).join(", ")}` },
      { status: 409 },
    );
  }

  await db.transaction(async (tx) => {
    if (childIds.length) await tx.delete(s.tables).where(inArray(s.tables.id, childIds));
    await tx.update(s.tables).set({ splitActive: false, updatedAt: new Date() }).where(eq(s.tables.id, parentId));
  });

  const msg = `${staffName} ha riunito il tavolo ${parent.label}`;
  await logActivity(parent.restaurantId, staffName, "table_merged", msg);
  broadcast(parent.restaurantId, { actor: staffName, msg });
  return NextResponse.json({ ok: true, tableId: parent.id, label: parent.label });
}
