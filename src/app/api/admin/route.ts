import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";
import { logActivity } from "@/server/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Area sviluppatore: registra nuovi clienti. Non è raggiungibile dall'app dei
 * ristoranti e non compare in nessun menu. La password sta in ADMIN_PASSWORD:
 * senza variabile d'ambiente l'endpoint resta chiuso.
 */
function checkPassword(password: unknown): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, status: 503, error: "Area sviluppatore non configurata (manca ADMIN_PASSWORD)" };
  }
  const given = String(password ?? "");
  // confronto a tempo costante: non si deduce la password dai tempi di risposta
  const a = Buffer.from(sha(given));
  const b = Buffer.from(sha(expected));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Password sbagliata" };
  }
  return { ok: true };
}

const slugify = (name: string) =>
  name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ristorante";

async function uniqueSlug(base: string) {
  const taken = new Set((await db.select({ slug: s.restaurants.slug }).from(s.restaurants)).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 99; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Elenco dei clienti registrati, con il loro indirizzo. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const auth = checkPassword(body.password);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (body.action === "list") {
    const rows = await db.select().from(s.restaurants).orderBy(asc(s.restaurants.createdAt));
    const out = [];
    for (const r of rows) {
      const team = await db.select().from(s.staff).where(eq(s.staff.restaurantId, r.id));
      const tables = await db.select().from(s.tables).where(eq(s.tables.restaurantId, r.id));
      out.push({
        id: r.id, name: r.name, slug: r.slug,
        onboarded: !!r.onboardedAt,
        createdAt: r.createdAt.toISOString(),
        staff: team.filter((x) => x.active).length,
        tables: tables.filter((t) => !t.archived).length,
      });
    }
    return NextResponse.json({ restaurants: out });
  }

  if (body.action === "create") {
    const name = String(body.restaurantName ?? "").trim().slice(0, 60);
    const owner = String(body.ownerName ?? "").trim().slice(0, 20);
    const pin = String(body.pin ?? "");
    if (!name) return NextResponse.json({ error: "Serve il nome del ristorante" }, { status: 400 });
    if (!owner) return NextResponse.json({ error: "Serve il nome del titolare" }, { status: 400 });
    if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: "Il PIN deve avere 4 cifre" }, { status: 400 });

    const slug = await uniqueSlug(slugify(body.slug ? String(body.slug) : name));

    const created = await db.transaction(async (tx) => {
      const [restaurant] = await tx.insert(s.restaurants).values({
        slug, name, plan: "trial", subscriptionStatus: "trialing",
        trialEndsAt: new Date(Date.now() + 30 * 86400000),
      }).returning();

      // Configurazione minima: senza queste righe sala e Piano non funzionano.
      await tx.insert(s.restaurantSettings).values({ restaurantId: restaurant.id });
      await tx.insert(s.restaurantFeatures).values({ restaurantId: restaurant.id, flags: {} });
      await tx.insert(s.servicePeriods).values([
        { restaurantId: restaurant.id, name: "Pranzo", startTime: "12:00", endTime: "15:00", sortOrder: 0 },
        { restaurantId: restaurant.id, name: "Cena", startTime: "19:00", endTime: "23:30", sortOrder: 1 },
      ]);
      await tx.insert(s.staff).values({
        restaurantId: restaurant.id, name: owner, pinHash: sha(pin),
        role: "titolare", color: "#E4572E",
      });
      return restaurant;
    });

    await logActivity(created.id, owner, "restaurant_created", `Locale ${name} registrato`);
    return NextResponse.json({
      restaurant: { id: created.id, name: created.name, slug: created.slug },
      // il titolare entrerà da qui e disegnerà la sala col percorso guidato
      loginPath: `/r/${created.slug}/login`,
    });
  }

  return NextResponse.json({ error: "Azione sconosciuta" }, { status: 400 });
}
