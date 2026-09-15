"use client";
// Destinazione della PWA e del collegamento "Riapri il locale".
// Non è una pagina: decide al volo dove portare l'utente in base al locale
// memorizzato su questo dispositivo, oppure mostra la landing.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/store/session";

export default function AppEntryPage() {
  const router = useRouter();
  const session = useSession();
  const slug = session.slug ?? session.rememberedSlug;
  const staff = session.staff;
  const hydrated = session.hydrated;

  useEffect(() => {
    if (!hydrated) return;
    router.replace(slug ? `/r/${slug}${staff ? "/sala" : "/login"}` : "/");
  }, [hydrated, slug, staff, router]);

  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="grid h-16 w-16 animate-pop place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand">C</div>
        <p className="text-sm font-semibold text-muted">Sto aprendo la sala…</p>
      </div>
    </div>
  );
}
