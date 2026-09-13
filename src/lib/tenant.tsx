"use client";
// Il ristorante corrente vive nell'indirizzo: /r/<slug>/sala.
// Qui si tiene allineata la sessione e si costruiscono i link interni, così
// nessuna pagina può finire per sbaglio sul locale di un altro cliente.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useSession } from "@/store/session";

const TenantContext = createContext<string>("");

export function TenantProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const setSlug = useSession((s) => s.setSlug);
  useEffect(() => { setSlug(slug); }, [slug, setSlug]);
  return <TenantContext.Provider value={slug}>{children}</TenantContext.Provider>;
}

/** Slug del ristorante aperto. Funziona sia dal contesto sia dai parametri URL. */
export function useTenant(): string {
  const fromContext = useContext(TenantContext);
  const params = useParams<{ slug?: string }>();
  return fromContext || (typeof params?.slug === "string" ? params.slug : "");
}

/** Costruisce un percorso interno al ristorante corrente. */
export function useTenantPath(): (path: string) => string {
  const slug = useTenant();
  return (path: string) => `/r/${slug}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Aggiunge lo slug a una query string di API. */
export function withSlug(slug: string, query: string): string {
  if (!slug) return query;
  return query.includes("?") ? `${query}&slug=${encodeURIComponent(slug)}` : `${query}?slug=${encodeURIComponent(slug)}`;
}
