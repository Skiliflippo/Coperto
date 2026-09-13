import { NextResponse } from "next/server";
import { BootstrapDataError, getRestaurantBundle } from "@/server/data";

// Il bootstrap dipende dal tenant e dal database: non deve mai essere prerenderizzato
// o servito da una cache dopo un reseed/import del DB.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const restaurantId = url.searchParams.get("rid");
    const slug = url.searchParams.get("slug");

    // getRestaurantBundle restituisce l'intero stato iniziale dell'app:
    // ristorante, impostazioni, sale con planimetria JSONB (muri/arredi),
    // tavoli con geometria, accorpamenti, turni e feature flag.
    // Se rid proviene da una vecchia sessione, risolve automaticamente il tenant
    // demo o il primo tenant disponibile e ne restituisce l'UUID corretto.
    const payload = await getRestaurantBundle(restaurantId, slug);

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Restaurant-Id": payload.restaurant.id,
      },
    });
  } catch (error) {
    if (error instanceof BootstrapDataError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "DATABASE_EMPTY" ? 503 : 404 },
      );
    }

    console.error("[api/bootstrap] Impossibile caricare la sala", error);
    return NextResponse.json(
      {
        error: "Impossibile caricare la sala. Controlla DATABASE_URL e applica lo schema Drizzle.",
        code: "BOOTSTRAP_FAILED",
      },
      { status: 500 },
    );
  }
}
