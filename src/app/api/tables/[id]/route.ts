import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Azioni sul tavolo "di base": pronto · fuori servizio · nota · posizione mappa
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json();
  const { restaurantId, staffName = "", action } = b;
  const [cur] = await db.select().from(s.tables).where(eq(s.tables.id, id));
  if (!cur) return NextResponse.json({ error: "Non trovata" }, { status: 404 });

  let msg = "";
  if (action === "pronto") {
    await db.update(s.tables).set({ state: "libero", updatedAt: new Date() }).where(eq(s.tables.id, id));
    msg = `${staffName}: tavolo ${cur.label} pronto`;
  } else if (action === "fuori_servizio") {
    await db.update(s.tables).set({ state: "fuori_servizio", updatedAt: new Date() }).where(eq(s.tables.id, id));
    msg = `${staffName}: tavolo ${cur.label} fuori servizio`;
  } else if (action === "in_servizio") {
    await db.update(s.tables).set({ state: "libero", updatedAt: new Date() }).where(eq(s.tables.id, id));
    msg = `${staffName}: tavolo ${cur.label} di nuovo in servizio`;
  } else if (action === "note") {
    await db.update(s.tables).set({ note: String(b.note ?? ""), updatedAt: new Date() }).where(eq(s.tables.id, id));
    return NextResponse.json({ ok: true });
  } else if (action === "position") {
    await db.update(s.tables).set({ x: Math.round(b.x), y: Math.round(b.y), updatedAt: new Date() }).where(eq(s.tables.id, id));
    return NextResponse.json({ ok: true });
  } else {
    return NextResponse.json({ error: "Azione sconosciuta" }, { status: 400 });
  }
  await logActivity(restaurantId, staffName, `table_${action}`, msg);
  broadcast(restaurantId, { actor: staffName, msg });
  return NextResponse.json({ ok: true });
}
