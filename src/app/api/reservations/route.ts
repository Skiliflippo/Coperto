import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Crea prenotazione telefonica. Anti-duplicati: stesso giorno + telefono o nome simile.
export async function POST(req: Request) {
  const b = await req.json();
  const { restaurantId, date, time, partySize, name, phone = "", notes = "", source = "telefono", createdBy = "", force = false } = b;
  if (!restaurantId || !date || !time || !partySize || !name?.trim()) {
    return NextResponse.json({ error: "Campi mancanti" }, { status: 400 });
  }
  const cleanPhone = String(phone).replace(/\D/g, "");
  if (!force) {
    const sameDay = await db.select().from(s.reservations)
      .where(and(eq(s.reservations.restaurantId, restaurantId), eq(s.reservations.date, date),
        or(eq(s.reservations.status, "confermata"), eq(s.reservations.status, "seduta"))));
    const dups = sameDay.filter((r) => {
      const rp = r.guestPhone.replace(/\D/g, "");
      const phoneMatch = cleanPhone.length >= 4 && rp.length >= 4 && (rp.includes(cleanPhone) || cleanPhone.includes(rp));
      const norm = (x: string) => x.trim().toLowerCase();
      const nameMatch = norm(r.guestName) === norm(name) ||
        (norm(name).length >= 3 && norm(r.guestName).startsWith(norm(name).slice(0, 3)) && norm(r.guestName)[0] === norm(name)[0]);
      return phoneMatch || nameMatch;
    });
    if (dups.length) return NextResponse.json({ duplicates: dups.map((d) => ({ id: d.id, guestName: d.guestName, time: d.time, partySize: d.partySize })) }, { status: 409 });
  }
  // cliente: riusa per telefono o nome, altrimenti crea (anagrafica si arricchisce da sola)
  let customerId: string | null = null;
  const existing = await db.select().from(s.customers).where(eq(s.customers.restaurantId, restaurantId));
  const found = existing.find((c) =>
    (cleanPhone.length >= 4 && c.phone.replace(/\D/g, "").includes(cleanPhone)) ||
    c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (found) customerId = found.id;
  else {
    const [c] = await db.insert(s.customers).values({ restaurantId, name: name.trim(), phone: String(phone) }).returning();
    customerId = c.id;
  }
  const [row] = await db.insert(s.reservations).values({
    restaurantId, customerId, guestName: name.trim(), guestPhone: String(phone),
    date, time, partySize, notes, source, createdBy,
  }).returning();
  await logActivity(restaurantId, createdBy, "reservation_created", `${createdBy} ha preso: ${name.trim()}, ${partySize} p. alle ${time}`);
  broadcast(restaurantId, { actor: createdBy, msg: `${createdBy} ha aggiunto ${name.trim()} alle ${time}` });
  return NextResponse.json({ reservation: row });
}
