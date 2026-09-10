"use client";
// Guscio dell'app: guardia PIN, tema, realtime, tab bar, indicatori connessione.
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Armchair, CalendarRange, Hourglass, Ellipsis, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useSession } from "@/store/session";
import { useRealtime } from "@/lib/hooks";
import { Providers } from "@/app/providers";
import { Toaster } from "@/components/toast";

const TABS = [
  { href: "/sala", label: "Sala", icon: Armchair },
  { href: "/prenotazioni", label: "Prenotazioni", icon: CalendarRange },
  { href: "/attesa", label: "Attesa", icon: Hourglass },
  { href: "/altro", label: "Altro", icon: Ellipsis },
];

function Shell({ children }: { children: ReactNode }) {
  const staff = useSession((s) => s.staff);
  const theme = useSession((s) => s.theme);
  const router = useRouter();
  const path = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const conn = useRealtime();

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

  return (
    <>
      <div className="no-print pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+10px)] z-50">
        <ConnBadge conn={conn} />
      </div>
      <main className="mx-auto min-h-dvh w-full max-w-5xl pb-[calc(env(safe-area-inset-bottom)+92px)]">{children}</main>
      <Toaster />
      <nav className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-[13px] font-semibold transition-colors ${active ? "text-brand" : "text-muted"}`}>
                <Icon className={`h-6 w-6 ${active ? "stroke-[2.6px]" : ""}`} />
                {label}
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
