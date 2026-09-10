import { NextResponse } from "next/server";
import { getRestaurantBundle } from "@/server/data";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const rid = new URL(req.url).searchParams.get("rid");
    const bundle = await getRestaurantBundle(rid);
    return NextResponse.json(bundle);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Errore bootstrap" }, { status: 404 });
  }
}
