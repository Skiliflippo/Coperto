import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const b = await req.json();
  const { restaurantId, staffName = "", settings, periods } = b;
  if (!restaurantId || !settings) return NextResponse.json({ error: "Campi mancanti" }, { status: 400 });
  await db.update(s.restaurantSettings).set({
    slotMinutes: settings.slotMinutes, bufferMinutes: settings.bufferMinutes,
    lateThresholdMinutes: settings.lateThresholdMinutes, noShowThresholdMinutes: settings.noShowThresholdMinutes,
    overbookingPct: settings.overbookingPct, durations: settings.durations,
    overtimeMinutes: settings.overtimeMinutes, reservationHoldMinutes: settings.reservationHoldMinutes,
    allowTableJoin: settings.allowTableJoin, joinMaxGapCm: settings.joinMaxGapCm,
  }).where(eq(s.restaurantSettings.restaurantId, restaurantId));
  for (const p of periods ?? []) {
    await db.update(s.servicePeriods).set({ startTime: p.startTime, endTime: p.endTime })
      .where(eq(s.servicePeriods.id, p.id));
  }
  const msg = `${staffName} ha aggiornato le impostazioni`;
  await logActivity(restaurantId, staffName, "settings_updated", msg);
  broadcast(restaurantId, { actor: staffName, msg });
  return NextResponse.json({ ok: true });
}
