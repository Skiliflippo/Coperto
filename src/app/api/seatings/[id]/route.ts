import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

// Azioni sul tavolo occupato: libera · prolunga · coperti ± · sposta · conto · nota
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json();
  const { restaurantId, staffName = "", action } = b;
  const [cur] = await db.select().from(s.seatings).where(eq(s.seatings.id, id));
  if (!cur) return NextResponse.json({ error: "Non trovata" }, { status: 404 });

  let msg = "";
  if (action === "libera") {
    // fine occupazione → il tavolo torna subito libero: in servizio nessuno ha tempo
    // di segnare "da pulire" e poi "pronto".
    await db.update(s.seatings).set({ status: "chiuso", actualEndAt: new Date() }).where(eq(s.seatings.id, id));
    msg = `${staffName} ha liberato il tavolo ${cur.tableLabel}`;
  } else if (action === "extend") {
    const mins = Number(b.minutes ?? 15);
    await db.update(s.seatings).set({ expectedEndAt: new Date(new Date(cur.expectedEndAt).getTime() + mins * 60000) }).where(eq(s.seatings.id, id));
    msg = `${staffName} ha prolungato il tavolo ${cur.tableLabel} di ${mins} min`;
  } else if (action === "party") {
    await db.update(s.seatings).set({ partySize: Number(b.partySize) }).where(eq(s.seatings.id, id));
    msg = `${staffName}: tavolo ${cur.tableLabel} ora ${b.partySize} coperti`;
  } else if (action === "move") {
    const tableIds: string[] = b.tableIds;
    const active = await db.select().from(s.seatings)
      .where(and(eq(s.seatings.restaurantId, restaurantId), eq(s.seatings.status, "seduto")));
    const clash = active.find((x) => x.id !== id && x.tableIds.some((tid: string) => tableIds.includes(tid)));
    if (clash) return NextResponse.json({ conflict: true, tableLabel: clash.tableLabel }, { status: 409 });
    await db.update(s.seatings).set({ tableIds, tableLabel: b.tableLabel }).where(eq(s.seatings.id, id));
    msg = `${staffName} ha spostato ${cur.name || "tavolo"} su ${b.tableLabel}`;
  } else if (action === "bill") {
    await db.update(s.seatings).set({ billRequested: !cur.billRequested }).where(eq(s.seatings.id, id));
    msg = `${staffName}: conto ${!cur.billRequested ? "richiesto al" : "annullato al"} tavolo ${cur.tableLabel}`;
  } else if (action === "note") {
    await db.update(s.seatings).set({ note: String(b.note ?? "") }).where(eq(s.seatings.id, id));
    return NextResponse.json({ ok: true }); // le note non generano notifiche: la sala è rumorosa
  } else {
    return NextResponse.json({ error: "Azione sconosciuta" }, { status: 400 });
  }
  await logActivity(restaurantId, staffName, `seating_${action}`, msg);
  broadcast(restaurantId, { actor: staffName, msg, kind: "seating" });
  return NextResponse.json({ ok: true });
}
