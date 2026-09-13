import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "@/server/hub";
import { assertStaffInRestaurant, logActivity } from "@/server/data";
import { normalizeLayout } from "@/lib/floor";
export const dynamic = "force-dynamic";

// Percorso guidato del primo accesso: crea/aggiorna la sala con il suo perimetro
// e segna il locale come configurato. Solo il titolare.
export async function POST(req: Request) {
  const b = await req.json();
  const { restaurantId, staffId, staffName = "", roomName = "Sala", layout, finish, createNew } = b;
  const guard = await assertStaffInRestaurant(staffId, restaurantId, { requireOwner: true });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error === "Serve il titolare" ? "Solo il titolare può configurare la sala" : guard.error }, { status: guard.status });
  }

  let roomId: string | null = null;
  if (layout) {
    const clean = normalizeLayout(layout);
    const existing = await db.select().from(s.rooms).where(eq(s.rooms.restaurantId, restaurantId));
    // createNew = si sta aggiungendo un ambiente: non si tocca quello esistente.
    const target = createNew ? undefined : (existing.find((r) => r.name === roomName) ?? existing[0]);
    if (target) {
      await db.update(s.rooms).set({ layout: clean, name: roomName }).where(eq(s.rooms.id, target.id));
      roomId = target.id;
    } else {
      if (createNew && existing.some((r) => r.name.trim().toLowerCase() === roomName.trim().toLowerCase())) {
        return NextResponse.json({ error: `Esiste già una sala "${roomName}"` }, { status: 409 });
      }
      const [created] = await db.insert(s.rooms)
        .values({ restaurantId, name: roomName, sortOrder: existing.length, layout: clean }).returning();
      roomId = created.id;
      if (createNew) {
        const msg = `${staffName} ha creato la sala ${roomName}`;
        await logActivity(restaurantId, staffName, "room_created", msg);
        broadcast(restaurantId, { actor: staffName, msg });
      }
    }
  }
  if (finish) {
    await db.update(s.restaurants).set({ onboardedAt: new Date() }).where(eq(s.restaurants.id, restaurantId));
    const msg = `${staffName} ha completato la configurazione della sala`;
    await logActivity(restaurantId, staffName, "onboarding_done", msg);
    broadcast(restaurantId, { actor: staffName, msg });
  }
  return NextResponse.json({ ok: true, roomId });
}
