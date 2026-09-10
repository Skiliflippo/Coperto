import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc, eq } from "drizzle-orm";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rid = new URL(req.url).searchParams.get("rid");
  if (!rid) return NextResponse.json({ error: "rid mancante" }, { status: 400 });
  const rows = await db.select().from(s.activityLog)
    .where(eq(s.activityLog.restaurantId, rid))
    .orderBy(desc(s.activityLog.createdAt)).limit(30);
  return NextResponse.json({ log: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
}
