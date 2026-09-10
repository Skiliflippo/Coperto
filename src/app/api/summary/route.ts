import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, lt, ne } from "drizzle-orm";
export const dynamic = "force-dynamic";

// Finestra del giorno di servizio nel fuso del locale (00:00 → 04:00 del giorno dopo)
function romeRange(date: string): [Date, Date] {
  const probe = new Date(`${date}T00:00:00Z`);
  const rome = new Date(probe.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const off = probe.getTime() - rome.getTime();
  const start = new Date(probe.getTime() + off);
  return [start, new Date(start.getTime() + 28 * 3600000)];
}
const romeHour = (d: Date) => Number(new Date(d).toLocaleString("en-US", { timeZone: "Europe/Rome", hour: "numeric", hour12: false })) % 24;

async function statsFor(rid: string, date: string) {
  const [start, end] = romeRange(date);
  const seatings = await db.select().from(s.seatings)
    .where(and(eq(s.seatings.restaurantId, rid), gte(s.seatings.seatedAt, start), lt(s.seatings.seatedAt, end)));
  const reservations = await db.select().from(s.reservations)
    .where(and(eq(s.reservations.restaurantId, rid), eq(s.reservations.date, date)));
  const wait = await db.select().from(s.waitlistEntries)
    .where(and(eq(s.waitlistEntries.restaurantId, rid), gte(s.waitlistEntries.createdAt, start), lt(s.waitlistEntries.createdAt, end)));

  const covers = seatings.reduce((a, x) => a + x.partySize, 0);
  const closed = seatings.filter((x) => x.actualEndAt);
  const avgStay = closed.length
    ? Math.round(closed.reduce((a, x) => a + (x.actualEndAt!.getTime() - x.seatedAt.getTime()) / 60000, 0) / closed.length) : 0;
  const peak = new Map<number, number>();
  for (const x of seatings) peak.set(romeHour(x.seatedAt), (peak.get(romeHour(x.seatedAt)) ?? 0) + x.partySize);

  const booked = reservations.filter((r) => r.status !== "cancellata");
  const arrived = reservations.filter((r) => r.status === "seduta");
  const noShow = reservations.filter((r) => r.status === "no_show");
  const seatByRes = new Map(seatings.filter((x) => x.reservationId).map((x) => [x.reservationId!, x]));
  let lateSum = 0, lateN = 0;
  for (const r of arrived) {
    const sx = seatByRes.get(r.id);
    if (!sx) continue;
    const [h, m] = r.time.split(":").map(Number);
    const exp = romeRange(r.date)[0].getTime() + (h * 60 + m) * 60000;
    const late = Math.round((sx.seatedAt.getTime() - exp) / 60000);
    if (late > 0) { lateSum += late; lateN++; }
  }
  const walkIns = seatings.filter((x) => !x.reservationId);
  const seatedFromWait = wait.filter((x) => x.seatedAt);
  const avgWait = seatedFromWait.length
    ? Math.round(seatedFromWait.reduce((a, x) => a + (x.seatedAt!.getTime() - x.createdAt.getTime()) / 60000, 0) / seatedFromWait.length) : 0;

  return {
    date, covers, seatings: seatings.length, avgStay, tablesTurned: closed.length,
    peak: [...peak.entries()].map(([h, c]) => ({ hour: h, covers: c })).sort((a, b) => a.hour - b.hour),
    booked: booked.length, arrived: arrived.length, noShows: noShow.length,
    noShowPct: booked.length ? Math.round((noShow.length / booked.length) * 100) : 0,
    coversLost: noShow.reduce((a, r) => a + r.partySize, 0),
    avgLate: lateN ? Math.round(lateSum / lateN) : 0,
    walkIns: walkIns.length, walkInCovers: walkIns.reduce((a, x) => a + x.partySize, 0),
    bookedCovers: arrived.reduce((a, r) => a + (r.partySizeActual ?? r.partySize), 0),
    avgWait, waitLeft: wait.filter((x) => x.status === "andato_via").length,
    cancelled: reservations.filter((r) => r.status === "cancellata").length,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid");
  const date = url.searchParams.get("date");
  if (!rid || !date) return NextResponse.json({ error: "Parametri mancanti" }, { status: 400 });
  const today = await statsFor(rid, date);
  const week: Awaited<ReturnType<typeof statsFor>>[] = [];
  for (let d = 1; d <= 7; d++) {
    const dt = new Date(date + "T12:00:00"); dt.setDate(dt.getDate() - d);
    const iso = dt.toISOString().slice(0, 10);
    week.push(await statsFor(rid, iso));
  }
  const avg = (k: "covers" | "seatings" | "noShows" | "walkIns" | "avgWait") =>
    week.length ? Math.round(week.reduce((a, w) => a + w[k], 0) / week.length) : 0;
  const summary = { ...today, weekAvg: { covers: avg("covers"), seatings: avg("seatings"), noShows: avg("noShows"), walkIns: avg("walkIns") } };

  if (url.searchParams.get("csv")) {
    const head = "giorno,coperti,girature,permanenza_media_min,prenotati,arrivati,no_show,no_show_pct,coperti_persi_no_show,ritardo_medio_min,walk_in,attesa_media_min,andati_via,cancellate";
    const all = [today, ...week];
    const rows = all.map((w: any) => [w.date, w.covers, w.tablesTurned, w.avgStay, w.booked, w.arrived, w.noShows, w.noShowPct, w.coversLost, w.avgLate, w.walkIns, w.avgWait, w.waitLeft, w.cancelled].join(","));
    return new Response([head, ...rows].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="riepilogo-${date}.csv"` },
    });
  }
  return NextResponse.json(summary);
}
