import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { autoAssign } from "@/lib/autoassign";
import { getRestaurantBundle, getDayData, logActivity } from "@/server/data";
import { broadcast } from "@/server/hub";
export const dynamic = "force-dynamic";

// POST {action:'preview'} → proposta spiegata. {action:'apply', proposals} → applica (solo dopo conferma umana).
export async function POST(req: Request) {
  const b = await req.json();
  const { restaurantId, date, periodId, staffName = "" } = b;
  const bundle = await getRestaurantBundle(restaurantId);
  const day = await getDayData(restaurantId, date);
  const period = bundle.periods.find((p) => p.id === periodId) ?? bundle.periods[0];
  if (b.action === "preview") {
    const plan = autoAssign({ reservations: day.reservations, tables: bundle.tables, combos: bundle.combos, period, settings: bundle.settings });
    return NextResponse.json(plan);
  }
  // apply: le proposte arrivano dal client (già viste e confermate dall'operatore)
  let n = 0;
  for (const p of b.proposals ?? []) {
    await db.update(s.reservations).set({
      assignedTableId: p.kind === "table" ? p.id2 : null,
      assignedComboId: p.kind === "combo" ? p.id2 : null,
      joinedTableIds: Array.isArray(p.joinedTableIds) ? p.joinedTableIds : [],
      updatedAt: new Date(),
    }).where(and(eq(s.reservations.id, p.reservationId), eq(s.reservations.status, "confermata")));
    n++;
  }
  const msg = `${staffName} ha applicato Auto-sistema: ${n} prenotazioni sistemate (${period.name})`;
  await logActivity(restaurantId, staffName, "autoassign_applied", msg);
  broadcast(restaurantId, { actor: staffName, msg });
  return NextResponse.json({ applied: n });
}
