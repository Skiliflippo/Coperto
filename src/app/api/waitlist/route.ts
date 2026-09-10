import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json();
  const { restaurantId, name, partySize, phone = "", roomPreference = "", notes = "",
    quotedMinutes, linkedReservationId, createdBy = "" } = b;
  if (!restaurantId || !name?.trim() || !partySize) {
    return NextResponse.json({ error: "Campi mancanti" }, { status: 400 });
  }
  const [row] = await db.insert(s.waitlistEntries).values({
    restaurantId, name: name.trim(), partySize, phone, roomPreference, notes,
    quotedMinutes: quotedMinutes ?? null, linkedReservationId: linkedReservationId ?? null,
  }).returning();
  const msg = `${createdBy} ha messo in attesa ${name.trim()} (${partySize})`;
  await logActivity(restaurantId, createdBy, "waitlist_created", msg);
  broadcast(restaurantId, { actor: createdBy, msg });
  return NextResponse.json({ entry: row });
}
