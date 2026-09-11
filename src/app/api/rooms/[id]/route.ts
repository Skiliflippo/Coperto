import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { isOwner, logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Salva la planimetria della sala: dimensioni, muri, arredi fissi (solo titolare).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json();
  const { staffId, staffName = "", layout, name } = b;
  if (!(await isOwner(staffId))) {
    return NextResponse.json({ error: "Solo il titolare può modificare la mappa" }, { status: 403 });
  }
  const [cur] = await db.select().from(s.rooms).where(eq(s.rooms.id, id));
  if (!cur) return NextResponse.json({ error: "Sala non trovata" }, { status: 404 });

  const clean = layout ? {
    w: Math.max(400, Math.min(4000, Math.round(layout.w))),
    h: Math.max(400, Math.min(4000, Math.round(layout.h))),
    walls: (layout.walls ?? []).slice(0, 100).map((w: any) => ({
      x1: Math.round(w.x1), y1: Math.round(w.y1), x2: Math.round(w.x2), y2: Math.round(w.y2),
    })),
    objects: (layout.objects ?? []).slice(0, 50).map((o: any) => ({
      x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h), label: String(o.label ?? "").slice(0, 24),
    })),
  } : cur.layout;

  await db.update(s.rooms).set({ layout: clean, ...(name ? { name: String(name).slice(0, 40) } : {}) }).where(eq(s.rooms.id, id));
  const msg = `${staffName} ha aggiornato la piantina di ${name ?? cur.name}`;
  await logActivity(cur.restaurantId, staffName, "room_layout_updated", msg);
  broadcast(cur.restaurantId, { actor: staffName, msg });
  return NextResponse.json({ ok: true });
}
