import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { isOwner, logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Nuovo tavolo sulla piantina (solo titolare).
export async function POST(req: Request) {
  const b = await req.json();
  const { restaurantId, roomId, staffId, staffName = "", label, capacity = 4, x, y } = b;
  if (!(await isOwner(staffId))) {
    return NextResponse.json({ error: "Solo il titolare può modificare la mappa" }, { status: 403 });
  }
  if (!restaurantId || !roomId) return NextResponse.json({ error: "Campi mancanti" }, { status: 400 });

  // Numero automatico: primo libero dopo il massimo esistente
  const existing = await db.select().from(s.tables).where(eq(s.tables.restaurantId, restaurantId));
  const nextNum = Math.max(0, ...existing.map((t) => Number(t.label) || 0)) + 1;
  const finalLabel = String(label ?? nextNum);
  if (existing.some((t) => !t.archived && t.label === finalLabel)) {
    return NextResponse.json({ error: `Esiste già il tavolo ${finalLabel}` }, { status: 409 });
  }
  const cap = Math.max(1, Math.min(20, Number(capacity)));
  const geo = cap <= 2 ? { width: 90, height: 90, shape: "round" }
    : cap <= 4 ? { width: 120, height: 120, shape: "square" }
    : cap <= 6 ? { width: 190, height: 110, shape: "rect" }
    : cap <= 8 ? { width: 210, height: 110, shape: "rect" }
    : { width: 260, height: 120, shape: "rect" };
  const [row] = await db.insert(s.tables).values({
    restaurantId, roomId, label: finalLabel, capacity: cap,
    x: Math.round(x ?? 200), y: Math.round(y ?? 200), ...geo,
  }).returning();
  const msg = `${staffName} ha aggiunto il tavolo ${finalLabel} (${cap} posti)`;
  await logActivity(restaurantId, staffName, "table_created", msg);
  broadcast(restaurantId, { actor: staffName, msg });
  return NextResponse.json({ table: row });
}
