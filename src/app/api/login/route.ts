import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { staffId, pin, slug } = await req.json();
  if (!staffId || !/^\d{4}$/.test(String(pin))) {
    return NextResponse.json({ error: "PIN a 4 cifre" }, { status: 400 });
  }
  const [row] = await db.select().from(s.staff)
    .where(and(eq(s.staff.id, staffId), eq(s.staff.active, true)));
  const hash = createHash("sha256").update(String(pin)).digest("hex");
  if (!row || row.pinHash !== hash) {
    return NextResponse.json({ error: "PIN sbagliato" }, { status: 401 });
  }
  // L'account deve essere di QUESTO ristorante, non di un altro cliente.
  if (slug) {
    const [rest] = await db.select().from(s.restaurants).where(eq(s.restaurants.id, row.restaurantId));
    if (!rest || rest.slug !== slug) {
      return NextResponse.json({ error: "Questo accesso non vale per questo ristorante" }, { status: 403 });
    }
  }
  await logActivity(row.restaurantId, row.name, "login", `${row.name} ha iniziato il turno`);
  return NextResponse.json({
    id: row.id, name: row.name, role: row.role, color: row.color, restaurantId: row.restaurantId,
  });
}
