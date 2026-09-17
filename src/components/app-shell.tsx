"use client";
// Guscio dell'app: guardia PIN, tema, realtime, tab bar, indicatori connessione.
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Armchair, CalendarRange, Ellipsis, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useSession } from "@/store/session";
import { useRealtime } from "@/lib/hooks";
import { Providers } from "@/app/providers";
import { useBootstrap } from "@/lib/hooks";
import { Onboarding } from "@/components/onboarding";
import { Toaster } from "@/components/toast";
import { useTenantPath } from "@/lib/tenant";

const TABS = [
  { path: "/sala", label: "Sala", icon: Armchair },
  { path: "/prenotazioni", label: "Prenotazioni", icon: CalendarRange },
  { path: "/altro", label: "Altro", icon: Ellipsis },
];

function Shell({ children }: { children: ReactNode }) {
  const staff = useSession((s) => s.staff);
  const theme = useSession((s) => s.theme);
  const router = useRouter();
  const tp = useTenantPath();
  const path = usePathname();
  const hydrated = useSession((state) => state.hydrated);
  const conn = useRealtime();
  const boot = useBootstrap();
  // Chiaro/scuro è una scelta del dispositivo; la palette è del locale.
  const palette = boot.data?.settings?.theme ?? "terracotta";
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    for (const cls of Array.from(root.classList)) {
      if (cls.startsWith("theme-")) root.classList.remove(cls);
    }
    root.classList.add(`theme-${palette}`);
  }, [theme, palette]);
  // Fallback iPhone: se la hydration di zustand non completa (localStorage SecurityError in private/PWA),
  // forza hydrated=true dopo 800ms per sbloccare l'app — fix "rimane chiodato su sta aprendo la sala"
  useEffect(() => {
    if (hydrated) return;
    const id = setTimeout(() => {
      const s = useSession.getState();
      if (!s.hydrated) s.setHydrated(true);
    }, 800);
    return () => clearTimeout(id);
  }, [hydrated]);

  useEffect(() => {
    if (hydrated && !staff) {
      const target = tp("/login");
      router.replace(target);
    }
  }, [hydrated, staff, tp, router]);

  // Database svuotato o non ancora configurato: la sessione salvata nel browser
  // non vale più. Si riparte dal primo avvio invece di restare a caricare.
  // Fix iPhone: non cancellare lo staff su errori di rete (offline) — solo su DATABASE_EMPTY / RESTAURANT_NOT_FOUND
  useEffect(() => {
    if (!boot.isError) return;
    const err = boot.error as any;
    const status = err?.status;
    const code = err?.payload?.code;
    if (status === 503 || status === 404 || code === "DATABASE_EMPTY" || code === "RESTAURANT_NOT_FOUND") {
      useSession.getState().setStaff(null);
      router.replace(tp("/setup"));
    }
  }, [boot.isError, boot.error, tp, router]);

  // Fix iPhone: mostra loading solo se davvero non sappiamo nulla.
  // Se staff esiste già in memoria (appena fatto login), mostra la sala anche se hydrated è ancora false
  // Altrimenti su iPhone con localStorage bloccato si resta chiodati su "sta aprendo la sala"
  if (!hydrated && !staff) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="grid h-16 w-16 animate-pop place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand">C</div>
          <p className="text-sm font-semibold text-muted">Coperto sta aprendo la sala…</p>
        </div>
      </div>
    );
  }
  if (!staff) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="grid h-16 w-16 animate-pop place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand">C</div>
          <p className="text-sm font-semibold text-muted">Coperto sta aprendo la sala…</p>
        </div>
      </div>
    );
  }

  // Primo accesso: prima di tutto si disegna la sala.
  if (boot.data && !boot.data.restaurant.onboarded) {
    return <><Onboarding boot={boot.data} /><Toaster /></>;
  }

  return (
    <>
      <div className="no-print pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+10px)] z-50">
        <ConnBadge conn={conn} />
      </div>
      <main className="mx-auto min-h-dvh w-full max-w-5xl pb-[calc(env(safe-area-inset-bottom)+72px)]">{children}</main>
      <Toaster />
      {/* Navigazione: pillola compatta, solo icone. Nessun testo da tagliare,
          l'icona attiva si accende. Occupa il minimo indispensabile. */}
      <nav className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-line/60 bg-surface/75 p-1 shadow-lg backdrop-blur-xl">
          {TABS.map(({ path: tabPath, label, icon: Icon }) => {
            const href = tp(tabPath);
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href} aria-label={label} title={label}
                className={`relative grid h-11 w-14 place-items-center rounded-full transition-colors active:scale-90 ${active ? "text-brand" : "text-muted"}`}>
                {active && <span className="absolute inset-0 rounded-full bg-brand/12" />}
                <Icon className={`relative h-[22px] w-[22px] ${active ? "stroke-[2.6px]" : "stroke-[2px]"}`} />
                {active && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-brand" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function ConnBadge({ conn }: { conn: "online" | "offline" | "connecting" }) {
  if (conn === "online") return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-ok/40 bg-surface px-3 py-1.5 text-xs font-bold text-ok shadow-sm">
      <Wifi className="h-3.5 w-3.5" /> Live
    </div>
  );
  if (conn === "connecting") return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-soon/50 bg-surface px-3 py-1.5 text-xs font-bold text-soon shadow-sm">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Riconnetto…
    </div>
  );
  return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-over/50 bg-surface px-3 py-1.5 text-xs font-bold text-over shadow-sm">
      <WifiOff className="h-3.5 w-3.5" /> Offline
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  return <Providers><Shell>{children}</Shell></Providers>;
}
