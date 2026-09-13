import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { logActivity } from "@/server/data";
export const dynamic = "force-dynamic";

const sha = (pin: string) => createHash("sha256").update(pin).digest("hex");

const slugify = (name: string) =>
  name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ristorante";

/** Il primo avvio è possibile solo finché non esiste un titolare attivo. */
async function setupState(slug?: string | null) {
  const restaurants = slug
    ? await db.select().from(s.restaurants).where(eq(s.restaurants.slug, slug)).limit(1)
    : await db.select().from(s.restaurants).limit(1);
  if (!restaurants.length) return { needsSetup: true, restaurant: null };
  const restaurant = restaurants[0];
  const staff = await db.select().from(s.staff).where(eq(s.staff.restaurantId, restaurant.id));
  const hasOwner = staff.some((x) => x.active && x.role === "titolare");
  return { needsSetup: !hasOwner, restaurant };
}

// Il client chiede se l'app è già configurata: guida verso /setup o /login.
export async function GET(req: Request) {
  try {
    const slug = new URL(req.url).searchParams.get("slug");
    const { needsSetup, restaurant } = await setupState(slug);
    return NextResponse.json({
      needsSetup,
      restaurantName: restaurant?.name ?? null,
      onboarded: !!restaurant?.onboardedAt,
    });
  } catch (error) {
    console.error("[api/setup] stato non leggibile", error);
    return NextResponse.json(
      { error: "Database non raggiungibile. Controlla DATABASE_URL e lo schema." },
      { status: 503 },
    );
  }
}

// PRIMO AVVIO: crea ristorante, impostazioni, turni e account del titolare.
// Non richiede autenticazione — non esiste ancora nessuno — ma è consentito
// una sola volta: appena c'è un titolare attivo, l'endpoint si chiude.
export async function POST(req: Request) {
  try {
    const { restaurantName, ownerName, pin, slug } = await req.json();
    const name = String(restaurantName ?? "").trim().slice(0, 60);
    const owner = String(ownerName ?? "").trim().slice(0, 20);
    const code = String(pin ?? "");

    if (!name) return NextResponse.json({ error: "Serve il nome del ristorante" }, { status: 400 });
    if (!owner) return NextResponse.json({ error: "Serve il tuo nome" }, { status: 400 });
    if (!/^\d{4}$/.test(code)) return NextResponse.json({ error: "Il PIN deve avere 4 cifre" }, { status: 400 });

    const { needsSetup, restaurant: existing } = await setupState(slug);
    if (!needsSetup) {
      return NextResponse.json({ error: "L'app è già configurata: entra con il tuo PIN" }, { status: 409 });
    }

    // Se le tabelle sono state svuotate a metà, si riusa il ristorante rimasto
    // invece di crearne un secondo.
    let restaurantId: string;
    if (existing) {
      restaurantId = existing.id;
      await db.update(s.restaurants).set({ name }).where(eq(s.restaurants.id, restaurantId));
    } else {
      const [created] = await db.insert(s.restaurants).values({
        slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        plan: "trial",
        subscriptionStatus: "trialing",
        trialEndsAt: new Date(Date.now() + 30 * 86400000),
      }).returning();
      restaurantId = created.id;
    }

    // Configurazione minima: senza impostazioni e turni sala e Piano non funzionano.
    const [settings] = await db.select().from(s.restaurantSettings)
      .where(eq(s.restaurantSettings.restaurantId, restaurantId));
    if (!settings) await db.insert(s.restaurantSettings).values({ restaurantId });

    const [features] = await db.select().from(s.restaurantFeatures)
      .where(eq(s.restaurantFeatures.restaurantId, restaurantId));
    if (!features) await db.insert(s.restaurantFeatures).values({ restaurantId, flags: {} });

    const periods = await db.select().from(s.servicePeriods)
      .where(eq(s.servicePeriods.restaurantId, restaurantId));
    if (!periods.length) {
      await db.insert(s.servicePeriods).values([
        { restaurantId, name: "Pranzo", startTime: "12:00", endTime: "15:00", sortOrder: 0 },
        { restaurantId, name: "Cena", startTime: "19:00", endTime: "23:30", sortOrder: 1 },
      ]);
    }

    const [row] = await db.insert(s.staff).values({
      restaurantId, name: owner, pinHash: sha(code), role: "titolare", color: "#E4572E",
    }).returning();

    await logActivity(restaurantId, owner, "setup_done", `${owner} ha configurato ${name}`);

    // Sessione immediata: si prosegue con la piantina senza dover rifare il login.
    return NextResponse.json({
      id: row.id, name: row.name, role: row.role, color: row.color, restaurantId,
    });
  } catch (error) {
    console.error("[api/setup] configurazione non riuscita", error);
    return NextResponse.json(
      { error: "Configurazione non riuscita. Verifica che lo schema sia applicato al database." },
      { status: 500 },
    );
  }
}
