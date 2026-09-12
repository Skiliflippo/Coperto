import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
export const dynamic = "force-dynamic";

// Elenco del personale per la schermata PIN: nomi e colori, mai gli hash.
// Se il database è vuoto non è un errore: significa che l'app va ancora
// configurata, e il client viene indirizzato al primo avvio.
export async function GET() {
  try {
    const [restaurant] = await db.select().from(s.restaurants)
      .orderBy(asc(s.restaurants.createdAt)).limit(1);
    if (!restaurant) {
      return NextResponse.json({ needsSetup: true, restaurantName: null, staff: [] });
    }
    const rows = await db.select({
      id: s.staff.id, name: s.staff.name, role: s.staff.role, color: s.staff.color,
    }).from(s.staff)
      .where(and(eq(s.staff.restaurantId, restaurant.id), eq(s.staff.active, true)))
      .orderBy(asc(s.staff.createdAt));

    // Nessun account attivo: il locale esiste ma non ci si può entrare.
    return NextResponse.json({
      needsSetup: rows.length === 0,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      staff: rows,
    });
  } catch (error) {
    console.error("[api/staff] elenco non leggibile", error);
    return NextResponse.json(
      { error: "Database non raggiungibile. Controlla DATABASE_URL e lo schema." },
      { status: 503 },
    );
  }
}
