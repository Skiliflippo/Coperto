"use client";
// Guscio dell'app: guardia PIN, tema, realtime, tab bar, indicatori connessione.
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Armchair, CalendarRange, Ellipsis, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useSession } from "@/store/session";
import { useRealtime } from "@/lib/hooks";
import { Providers } from "@/app/providers";
import { useBootstrap } from "@/lib/hooks";
import { Onboarding } from "@/components/onboarding";
import { Toaster } from "@/components/toast";

// Tre voci: chi è in attesa sta in fila davanti alla porta, non nell'app.
const TABS = [
  { href: "/sala", label: "Sala", icon: Armchair },
  { href: "/prenotazioni", label: "Prenotazioni", icon: CalendarRange },
  { href: "/altro", label: "Altro", icon: Ellipsis },
];

function Shell({ children }: { children: ReactNode }) {
  const staff = useSession((s) => s.staff);
  const theme = useSession((s) => s.theme);
  const router = useRouter();
  const path = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const conn = useRealtime();
  const boot = useBootstrap();

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  useEffect(() => {
    if (hydrated && !staff) router.replace("/login");
  }, [hydrated, staff, router]);

  if (!hydrated || !staff) {
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
          {TABS.map(({ href, label, icon: Icon }) => {
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
