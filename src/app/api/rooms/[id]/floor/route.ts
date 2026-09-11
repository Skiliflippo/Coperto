import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { isOwner, logActivity } from "@/server/data";
import { normalizeLayout, polygonOf, rectInsideRoom, tableGeometry, type TableShape } from "@/lib/floor";
export const dynamic = "force-dynamic";

type TableDraft = {
  id: string; label: string; capacity: number; maxCapacity?: number; shape: TableShape;
  x: number; y: number; width: number; height: number; rotation: number; isNew?: boolean;
};

// Salvataggio in blocco della piantina: planimetria + tavoli creati, spostati e rimossi.
// Una sola transazione → o si salva tutto, o non cambia niente (mai una sala a metà).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = await params;
  const body = await req.json();
  const { staffId, staffName = "", layout, tables = [], deleted = [] } = body as {
    staffId?: string; staffName?: string; layout?: unknown; tables?: TableDraft[]; deleted?: string[];
  };
  if (!(await isOwner(staffId))) {
    return NextResponse.json({ error: "Solo il titolare può modificare la mappa" }, { status: 403 });
  }
  const [room] = await db.select().from(s.rooms).where(eq(s.rooms.id, roomId));
  if (!room) return NextResponse.json({ error: "Sala non trovata" }, { status: 404 });
  const rid = room.restaurantId;

  // Un tavolo con gente seduta non si può eliminare: il servizio viene prima dell'estetica.
  const active = await db.select().from(s.seatings)
    .where(and(eq(s.seatings.restaurantId, rid), eq(s.seatings.status, "seduto")));
  const occupied = new Set(active.flatMap((x) => x.tableIds));
  const blocked = deleted.filter((tid) => occupied.has(tid));
  if (blocked.length) {
    const labels = (await db.select().from(s.tables).where(inArray(s.tables.id, blocked))).map((t) => t.label);
    return NextResponse.json({ error: `C'è gente seduta al tavolo ${labels.join(", ")}: libera prima di rimuoverlo` }, { status: 409 });
  }

  // Numeri tavolo duplicati: in sala si chiamano per numero, non possono ripetersi.
  const all = await db.select().from(s.tables).where(eq(s.tables.restaurantId, rid));
  const keptOther = all.filter((t) => !t.archived && t.roomId !== roomId && !deleted.includes(t.id));
  const labels = new Map<string, number>();
  for (const t of [...keptOther.map((t) => t.label), ...tables.map((t) => t.label.trim())]) {
    labels.set(t, (labels.get(t) ?? 0) + 1);
  }
  const dup = [...labels.entries()].find(([, n]) => n > 1);
  if (dup) return NextResponse.json({ error: `Il numero "${dup[0]}" è usato da due tavoli` }, { status: 409 });

  const clean = normalizeLayout(layout ?? room.layout);
  // I muri e gli arredi devono stare dentro il perimetro: il client lo impedisce già,
  // ma un payload manipolato non deve poter salvare una sala incoerente.
  const poly = polygonOf(clean);
  clean.elements = clean.elements.filter((e) => e.rotation !== 0 || rectInsideRoom(e.x, e.y, e.w, e.h, poly));

  const rows = tables.map((t) => {
    const cap = Math.max(1, Math.min(20, Math.round(t.capacity)));
    const shape: TableShape = t.shape === "round" || t.shape === "square" ? t.shape : "rect";
    const fallback = tableGeometry(cap, shape);
    return {
      draftId: t.id,
      isNew: !!t.isNew || !all.some((x) => x.id === t.id),
      label: String(t.label).trim().slice(0, 6) || "?",
      capacity: cap,
      maxCapacity: Math.max(cap, Math.min(24, Math.round(t.maxCapacity ?? cap))),
      shape,
      x: Math.round(t.x), y: Math.round(t.y),
      width: Math.max(50, Math.min(600, Math.round(t.width || fallback.width))),
      height: Math.max(50, Math.min(600, Math.round(t.height || fallback.height))),
      rotation: ((Math.round(t.rotation) % 360) + 360) % 360,
    };
  });
  const toCreate = rows.filter((r) => r.isNew);
  const toUpdate = rows.filter((r) => !r.isNew);
  let created = 0, updated = 0;

  // Una transazione, poche query: insert in blocco e update in parallelo.
  await db.transaction(async (tx) => {
    await tx.update(s.rooms).set({ layout: clean }).where(eq(s.rooms.id, roomId));
    if (deleted.length) {
      // archiviati, non cancellati: le statistiche dei servizi passati restano intatte
      await tx.update(s.tables).set({ archived: true, updatedAt: new Date() })
        .where(and(eq(s.tables.restaurantId, rid), inArray(s.tables.id, deleted)));
    }
    if (toCreate.length) {
      await tx.insert(s.tables).values(toCreate.map(({ draftId, isNew, ...r }) => ({ restaurantId: rid, roomId, ...r })));
      created = toCreate.length;
    }
    if (toUpdate.length) {
      const now = new Date();
      await Promise.all(toUpdate.map(({ draftId, isNew, ...r }) =>
        tx.update(s.tables).set({ ...r, roomId, archived: false, updatedAt: now }).where(eq(s.tables.id, draftId))));
      updated = toUpdate.length;
    }
  });

  const parts = [created && `${created} nuovi`, deleted.length && `${deleted.length} rimossi`].filter(Boolean);
  const msg = `${staffName} ha aggiornato la piantina di ${room.name}${parts.length ? ` (${parts.join(", ")})` : ""}`;
  await logActivity(rid, staffName, "floorplan_saved", msg);
  broadcast(rid, { actor: staffName, msg });
  return NextResponse.json({ ok: true, created, updated, deleted: deleted.length });
}
