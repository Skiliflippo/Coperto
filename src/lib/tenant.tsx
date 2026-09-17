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

/** Estrae slug da window.location come ultima spiaggia per iPhone PWA dove context/params possono essere vuoti durante hydration lenta */
function slugFromLocation(): string {
  try {
    if (typeof window === "undefined") return "";
    const m = window.location.pathname.match(/\/r\/([^\/]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  } catch {
    return "";
  }
}

/** Slug del ristorante aperto. Funziona sia dal contesto sia dai parametri URL. */
export function useTenant(): string {
  const fromContext = useContext(TenantContext);
  const params = useParams<{ slug?: string }>();
  const fromParams = typeof params?.slug === "string" ? params.slug : "";
  // Fallback iPhone: se context e params sono vuoti durante hydration, leggi da URL
  if (fromContext) return fromContext;
  if (fromParams) return fromParams;
  return slugFromLocation();
}

/** Costruisce un percorso interno al ristorante corrente. */
export function useTenantPath(): (path: string) => string {
  const slug = useTenant();
  return (path: string) => `/r/${slug}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Aggiunge lo slug a una query string di API. */
export function withSlug(slug: string, query: string): string {
  const effective = slug || slugFromLocation();
  if (!effective) return query;
  return query.includes("?") ? `${query}&slug=${encodeURIComponent(effective)}` : `${query}?slug=${encodeURIComponent(effective)}`;
}
