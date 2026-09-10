import { NextResponse } from "next/server";
import { getDayData } from "@/server/data";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid");
  const date = url.searchParams.get("date");
  if (!rid || !date) return NextResponse.json({ error: "Parametri mancanti" }, { status: 400 });
  return NextResponse.json(await getDayData(rid, date));
}
