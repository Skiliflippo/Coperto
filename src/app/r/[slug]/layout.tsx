import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getRestaurantBySlug } from "@/server/data";
import { TenantProvider } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Indirizzo dedicato del locale: se lo slug non esiste la pagina non esiste.
// Chi non ha il link non vede nulla, nemmeno il nome del ristorante.
export default async function TenantLayout(
  { children, params }: { children: ReactNode; params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();
  return <TenantProvider slug={slug}>{children}</TenantProvider>;
}
