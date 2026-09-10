import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json();
  const { restaurantId, staffName = "", action } = b;
  const [cur] = await db.select().from(s.waitlistEntries).where(eq(s.waitlistEntries.id, id));
  if (!cur) return NextResponse.json({ error: "Non trovata" }, { status: 404 });

  const patch: Partial<typeof s.waitlistEntries.$inferInsert> = { updatedAt: new Date() };
  let msg = "";
  if (action === "status") {
    patch.status = b.status;
    if (b.status === "avvisato") patch.notifiedAt = new Date();
    const labels: Record<string, string> = { avvisato: "ha avvisato", andato_via: "segna andato via", in_attesa: "ha rimesso in attesa" };
    msg = `${staffName} ${labels[b.status] ?? b.status} ${cur.name}`;
  } else {
    if (b.partySize) patch.partySize = b.partySize;
    if (b.quotedMinutes !== undefined) patch.quotedMinutes = b.quotedMinutes;
    if (b.notes !== undefined) patch.notes = b.notes;
    if (b.roomPreference !== undefined) patch.roomPreference = b.roomPreference;
    return NextResponse.json({ ok: true });
  }
  const [row] = await db.update(s.waitlistEntries).set(patch).where(eq(s.waitlistEntries.id, id)).returning();
  await logActivity(restaurantId, staffName, "waitlist_updated", msg);
  broadcast(restaurantId, { actor: staffName, msg });
  return NextResponse.json({ entry: row });
}
