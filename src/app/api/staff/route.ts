import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getRestaurantBundle } from "@/server/data";
export const dynamic = "force-dynamic";

// Lista staff pubblica (serve alla schermata PIN: nomi, non hash)
export async function GET() {
  const bundle = await getRestaurantBundle();
  const rows = await db.select({
    id: s.staff.id, name: s.staff.name, role: s.staff.role, color: s.staff.color,
  }).from(s.staff).where(and(eq(s.staff.restaurantId, bundle.restaurant.id), eq(s.staff.active, true)));
  return NextResponse.json({ restaurantId: bundle.restaurant.id, restaurantName: bundle.restaurant.name, staff: rows });
}
