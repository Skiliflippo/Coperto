import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getRestaurantBySlug } from "@/server/data";
import { TenantProvider } from "@/lib/tenant";
import { normalizeTenantCode } from "@/lib/tenant-code";

export const dynamic = "force-dynamic";

// Indirizzo dedicato del locale: se lo slug non esiste la pagina non esiste.
// Chi non ha il link non vede nulla, nemmeno il nome del ristorante.
export default async function TenantLayout(
  { children, params }: { children: ReactNode; params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  // Fix iPhone/PC: slug case-insensitive — BDHC8PMU7D == bdhc8pmu7d
  const normalized = normalizeTenantCode(raw) || raw.trim();
  const restaurant = (await getRestaurantBySlug(raw)) ?? (await getRestaurantBySlug(normalized)) ?? (await getRestaurantBySlug(normalized.toLowerCase()));
  if (!restaurant) notFound();
  return <TenantProvider slug={restaurant.slug}>{children}</TenantProvider>;
}
