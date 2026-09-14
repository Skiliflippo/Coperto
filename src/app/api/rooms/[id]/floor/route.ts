import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { assertStaffInRestaurant, logActivity } from "@/server/data";
import {
  aabb, boxInsideRoom, boxesOverlap, elementBox, normalizeLayout, polygonOf,
  tableGeometry, type Box, type TableShape,
} from "@/lib/floor";
export const dynamic = "force-dynamic";

type TableDraft = {
  id: string; label: string; capacity: number; maxCapacity?: number; shape: TableShape; splitInto?: number;
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
  const [room] = await db.select().from(s.rooms).where(eq(s.rooms.id, roomId));
  if (!room) return NextResponse.json({ error: "Sala non trovata" }, { status: 404 });
  const rid = room.restaurantId;
  const guard = await assertStaffInRestaurant(staffId, rid, { requireOwner: true });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error === "Serve il titolare" ? "Solo il titolare può modificare la mappa" : guard.error }, { status: guard.status });
  }

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

  const [settings] = await db.select().from(s.restaurantSettings)
    .where(eq(s.restaurantSettings.restaurantId, rid));
  const std = settings?.standardTableSeats ?? 4;
  const clean = normalizeLayout(layout ?? room.layout);
  // Nessun oggetto fuori dai muri o sovrapposto a un altro. Durante la modifica
  // il client lascia libertà di manovra, ma una piantina incoerente non si salva:
  // qui si rifiuta invece di scartare pezzi in silenzio.
  const poly = polygonOf(clean);
  const placed: { label: string; box: Box }[] = [
    ...clean.elements.map((e) => ({ label: e.label || (e.kind === "wall" ? "muro" : "arredo"), box: elementBox(e) })),
    ...tables.map((t) => ({
      label: `tavolo ${String(t.label).trim()}`,
      box: aabb(Math.round(t.x), Math.round(t.y), Math.round(t.width), Math.round(t.height), Math.round(t.rotation)),
    })),
  ];
  const outside = placed.filter((p) => !boxInsideRoom(p.box, poly));
  if (outside.length) {
    return NextResponse.json(
      { error: `Fuori dalla sala: ${outside.map((p) => p.label).join(", ")}` },
      { status: 409 },
    );
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (boxesOverlap(placed[i].box, placed[j].box)) {
        return NextResponse.json(
          { error: `Sovrapposti: ${placed[i].label} e ${placed[j].label}` },
          { status: 409 },
        );
      }
    }
  }

  const rows = tables.map((t) => {
    const cap = Math.max(1, Math.min(20, Math.round(t.capacity)));
    const shape: TableShape = t.shape === "round" || t.shape === "square" ? t.shape : "rect";
    const fallback = tableGeometry(cap, shape, std);
    return {
      draftId: t.id,
      isNew: !!t.isNew || !all.some((x) => x.id === t.id),
      label: String(t.label).trim().slice(0, 6) || "?",
      capacity: cap,
      maxCapacity: Math.max(cap, Math.min(24, Math.round(t.maxCapacity ?? cap))),
      // un tavolo si stacca al massimo nelle parti che i suoi coperti consentono
      splitInto: Math.max(0, Math.min(6, Math.round(t.splitInto ?? 0))) >= 2
        ? Math.min(Math.round(t.splitInto ?? 0), Math.floor(cap / 2))
        : 0,
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
