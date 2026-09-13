import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { broadcast } from "@/server/hub";
import { assertStaffInRestaurant, logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

const sha = (pin: string) => createHash("sha256").update(pin).digest("hex");
const COLORS = ["#E4572E", "#3B6FD9", "#2E9A5B", "#8E44AD", "#D19220", "#0E9AA7"];

// Gestione del personale: solo il titolare. Il PIN serve a sapere chi fa cosa,
// non è una password: si può reimpostare in un tocco.
export async function POST(req: Request) {
  const b = await req.json();
  const { restaurantId, staffId, staffName = "", action } = b;
  const guard = await assertStaffInRestaurant(staffId, restaurantId, { requireOwner: true });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error === "Serve il titolare" ? "Solo il titolare gestisce il personale" : guard.error }, { status: guard.status });
  }
  const list = await db.select().from(s.staff).where(eq(s.staff.restaurantId, restaurantId));

  if (action === "create") {
    const name = String(b.name ?? "").trim().slice(0, 20);
    const pin = String(b.pin ?? "");
    if (!name) return NextResponse.json({ error: "Serve il nome" }, { status: 400 });
    if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: "Il PIN deve avere 4 cifre" }, { status: 400 });
    if (list.some((x) => x.active && x.name.toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: `${name} esiste già` }, { status: 409 });
    }
    if (list.some((x) => x.active && x.pinHash === sha(pin))) {
      return NextResponse.json({ error: "PIN già usato da un altro collega" }, { status: 409 });
    }
    const [row] = await db.insert(s.staff).values({
      restaurantId, name, pinHash: sha(pin),
      role: b.role === "titolare" ? "titolare" : "staff",
      color: COLORS[list.length % COLORS.length],
    }).returning();
    const msg = `${staffName} ha aggiunto ${name} al personale`;
    await logActivity(restaurantId, staffName, "staff_created", msg);
    broadcast(restaurantId, { actor: staffName, msg });
    return NextResponse.json({ staff: { id: row.id, name: row.name, role: row.role, color: row.color } });
  }

  if (action === "pin") {
    const pin = String(b.pin ?? "");
    if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: "Il PIN deve avere 4 cifre" }, { status: 400 });
    if (list.some((x) => x.active && x.id !== b.targetId && x.pinHash === sha(pin))) {
      return NextResponse.json({ error: "PIN già usato da un altro collega" }, { status: 409 });
    }
    await db.update(s.staff).set({ pinHash: sha(pin) })
      .where(and(eq(s.staff.id, b.targetId), eq(s.staff.restaurantId, restaurantId)));
    const who = list.find((x) => x.id === b.targetId)?.name ?? "";
    await logActivity(restaurantId, staffName, "staff_pin", `${staffName} ha cambiato il PIN di ${who}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "role") {
    const owners = list.filter((x) => x.active && x.role === "titolare");
    if (owners.length === 1 && owners[0].id === b.targetId && b.role !== "titolare") {
      return NextResponse.json({ error: "Deve restare almeno un titolare" }, { status: 409 });
    }
    await db.update(s.staff).set({ role: b.role === "titolare" ? "titolare" : "staff" })
      .where(and(eq(s.staff.id, b.targetId), eq(s.staff.restaurantId, restaurantId)));
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const target = list.find((x) => x.id === b.targetId);
    if (!target) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    if (target.role === "titolare" && list.filter((x) => x.active && x.role === "titolare").length === 1) {
      return NextResponse.json({ error: "Deve restare almeno un titolare" }, { status: 409 });
    }
    // disattivato, non cancellato: le azioni registrate a suo nome restano leggibili
    await db.update(s.staff).set({ active: false }).where(eq(s.staff.id, b.targetId));
    const msg = `${staffName} ha rimosso ${target.name} dal personale`;
    await logActivity(restaurantId, staffName, "staff_deleted", msg);
    broadcast(restaurantId, { actor: staffName, msg });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Azione sconosciuta" }, { status: 400 });
}
