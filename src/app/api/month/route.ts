import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, lte, ne } from "drizzle-orm";
export const dynamic = "force-dynamic";

// Conteggi per giorno: quante prenotazioni e quanti coperti. Una sola query,
// così la vista Calendario resta immediata anche con mesi pieni.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!rid || !from || !to) return NextResponse.json({ error: "Parametri mancanti" }, { status: 400 });

  const rows = await db.select({ date: s.reservations.date, partySize: s.reservations.partySize })
    .from(s.reservations)
    .where(and(
      eq(s.reservations.restaurantId, rid),
      gte(s.reservations.date, from), lte(s.reservations.date, to),
      ne(s.reservations.status, "cancellata"),
    ));

  const map = new Map<string, { date: string; reservations: number; covers: number }>();
  for (const r of rows) {
    const cur = map.get(r.date) ?? { date: r.date, reservations: 0, covers: 0 };
    cur.reservations++; cur.covers += r.partySize;
    map.set(r.date, cur);
  }
  return NextResponse.json({ days: [...map.values()] });
}
