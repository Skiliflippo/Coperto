import { NextResponse } from "next/server";
import { getRestaurantBySlug } from "@/server/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Verifica pubblica e minimale per il portale d'accesso. Non espone staff, UUID,
// piano o configurazione: soltanto se il codice esiste e il nome del locale.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("slug") ?? "";
  const slug = raw.trim().toLowerCase();
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return NextResponse.json(
      { exists: false, error: "Inserisci un codice valido, ad esempio il-gabbiano-2." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return NextResponse.json(
      { exists: false, error: "Locale non trovato. Controlla il codice e riprova." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { exists: true, slug: restaurant.slug, name: restaurant.name },
    { headers: { "Cache-Control": "no-store" } },
  );
}
