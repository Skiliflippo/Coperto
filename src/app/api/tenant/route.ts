import { NextResponse } from "next/server";
import { getRestaurantBySlug } from "@/server/data";
import { normalizeTenantCode } from "@/lib/tenant-code";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Verifica pubblica e minimale per il portale d'accesso. Non espone staff, UUID,
// piano o configurazione: soltanto se il codice esiste e il nome del locale.
// Accetta anche il codice in formato parlato ("k7mq2xrq4t").
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("slug") ?? "";
  const code = normalizeTenantCode(raw);
  const slug = raw.trim().toLowerCase();
  if (!code || code.length < 4) {
    return NextResponse.json(
      { exists: false, error: "Inserisci il codice locale che ti è stato consegnato." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const restaurant = await getRestaurantBySlug(code)
    ?? (slug ? await getRestaurantBySlug(slug) : null);
  if (!restaurant) {
    return NextResponse.json(
      { exists: false, error: "Codice non riconosciuto. Controllalo e riprova." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { exists: true, slug: restaurant.slug, name: restaurant.name },
    { headers: { "Cache-Control": "no-store" } },
  );
}
