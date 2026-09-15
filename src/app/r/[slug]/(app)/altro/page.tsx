"use client";
// ALTRO — Riepilogo di fine servizio (semplice, non BI) + identità + impostazioni.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Armchair, ChevronRight, Download, Hourglass, Moon, Sun, LogOut, Settings, Store, TrendingDown, TrendingUp,
  UserX, Users, Footprints, Activity, Timer,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { relDay, todayISO } from "@/lib/time";
import { SkeletonRows } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useTenantPath } from "@/lib/tenant";

type Summary = {
  date: string; covers: number; seatings: number; avgStay: number; tablesTurned: number;
  peak: { hour: number; covers: number }[]; booked: number; arrived: number; noShows: number; noShowPct: number;
  coversLost: number; avgLate: number; walkIns: number; walkInCovers: number; bookedCovers: number;
  cancelled: number;
  weekAvg: { covers: number; seatings: number; noShows: number; walkIns: number };
};
type LogRow = { id: string; staffName: string; action: string; message: string; createdAt: string };

export default function AltroPage() {
  const staff = useSession((s) => s.staff);
  const theme = useSession((s) => s.theme);
  const toggleTheme = useSession((s) => s.toggleTheme);
  const setStaff = useSession((s) => s.setStaff);
  const router = useRouter();
  const tp = useTenantPath();
  const rid = staff?.restaurantId;
  const [date] = useState(todayISO());

  const summary = useQuery({
    queryKey: ["summary", rid, date],
    queryFn: () => api<Summary>(`/api/summary?rid=${rid}&date=${date}`),
    enabled: !!rid,
  });
  const log = useQuery({
    queryKey: ["log", rid],
    queryFn: () => api<{ log: LogRow[] }>(`/api/log?rid=${rid}`),
    enabled: !!rid,
  });

  const S = summary.data;
  const topPeak = S?.peak.length ? [...S.peak].sort((a, b) => b.covers - a.covers)[0] : null;
  const delta = (cur: number, avg: number) => {
    if (!avg) return null;
    const d = Math.round(((cur - avg) / avg) * 100);
    return d === 0 ? <span className="text-muted">= media 7gg</span>
      : d > 0 ? <span className="inline-flex items-center gap-0.5 text-ok"><TrendingUp className="h-3 w-3" />+{d}% vs 7gg</span>
      : <span className="inline-flex items-center gap-0.5 text-over"><TrendingDown className="h-3 w-3" />{d}% vs 7gg</span>;
  };

  return (
    <div className="px-4 pb-6">
      <header className="pt-[calc(env(safe-area-inset-top)+14px)]">
        <h1 className="font-display text-[22px] font-bold leading-tight">Riepilogo · {relDay(date).toLowerCase()}</h1>
      </header>

      {summary.isLoading || !S ? <div className="mt-4"><SkeletonRows n={4} h={80} /></div> : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat icon={<Users className="h-3.5 w-3.5" />} label="Coperti" value={String(S.covers)} sub={delta(S.covers, S.weekAvg.covers)} />
            <Stat icon={<Armchair className="h-3.5 w-3.5" />} label="Girature" value={String(S.tablesTurned)} sub={`${S.seatings} gruppi`} />
            <Stat icon={<Timer className="h-3.5 w-3.5" />} label="Permanenza" value={`${S.avgStay}′`} sub={topPeak ? `picco ${topPeak.hour}:00` : undefined} />
            <Stat icon={<UserX className="h-3.5 w-3.5" />} label="No-show" value={`${S.noShows}`}
              sub={<span className="text-over">{S.noShowPct}% · {S.coversLost} coperti persi</span>} />
            <Stat icon={<Hourglass className="h-3.5 w-3.5" />} label="Arrivi" value={`${S.arrived}/${S.booked}`}
              sub={<span className="text-soon">ritardo {S.avgLate}′ · {S.cancelled} disdette</span>} />
            <Stat icon={<Footprints className="h-3.5 w-3.5" />} label="Senza prenotare" value={String(S.walkIns)} sub={`${S.walkInCovers} coperti`} />
          </div>

          {S.peak.length > 0 && (
            <div className="mt-2 rounded-2xl border border-line bg-surface px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Coperti per ora</p>
              <div className="mt-2 flex h-14 items-end gap-1">
                {[...S.peak].sort((a, b) => a.hour - b.hour).map((p) => {
                  const max = Math.max(...S.peak.map((x) => x.covers));
                  return (
                    <div key={p.hour} className="flex-1 text-center">
                      <div className="mx-auto w-full max-w-8 rounded-t bg-brand/80" style={{ height: `${Math.max(5, (p.covers / max) * 44)}px` }} title={`${p.covers} coperti`} />
                      <p className="mt-0.5 text-[10px] font-bold text-muted">{p.hour}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <a href={`/api/summary?rid=${rid}&date=${date}&csv=1`} download
            className="mt-2 inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[13px] font-semibold text-muted active:scale-95">
            <Download className="h-4 w-4" /> Esporta CSV
          </a>
        </>
      )}

      {/* Ultime azioni: chi ha fatto cosa */}
      <div className="mt-5">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-muted"><Activity className="h-4 w-4" /> Ultime azioni</p>
        <div className="space-y-1.5">
          {(log.data?.log ?? []).slice(0, 12).map((l) => (
            <p key={l.id} className="rounded-xl bg-surface px-3.5 py-2.5 text-[14px] font-medium text-muted">
              <span className="font-bold text-ink">{l.staffName || "?"}</span> · {l.message.replace(/^\S+ ha |^\S+: /, "")}
              <span className="ml-1.5 text-[12px]">{new Date(l.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
            </p>
          ))}
          {!log.data?.log.length && <p className="text-sm text-muted">Ancora nessuna azione registrata oggi.</p>}
        </div>
      </div>

      {/* Identità + impostazioni */}
      <div className="mt-6 space-y-2">
        <button onClick={toggleTheme}
          className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold active:scale-[0.98]">
          {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          Tema {theme === "light" ? "scuro" : "chiaro"}
        </button>
        {staff?.role === "titolare" && (
          <Link href={tp("/altro/personale")}
            className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold active:scale-[0.98]">
            <Users className="h-5 w-5" /> Personale e PIN
            <ChevronRight className="ml-auto h-5 w-5 text-muted" />
          </Link>
        )}
        {staff?.role === "titolare" && (
          <Link href={tp("/altro/impostazioni")}
            className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold active:scale-[0.98]">
            <Settings className="h-5 w-5" /> Impostazioni sala
            <ChevronRight className="ml-auto h-5 w-5 text-muted" />
          </Link>
        )}
        <button onClick={() => { setStaff(null); router.replace(tp("/login")); }}
          className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold text-over active:scale-[0.98]">
          <LogOut className="h-5 w-5" /> Cambia utente <span className="ml-auto text-sm font-medium text-muted">{staff?.name} · {staff?.role === "titolare" ? "Titolare" : "Staff"}</span>
        </button>

        {/* Torna al portale e dimentica questo locale su questo dispositivo. */}
        <button onClick={() => { useSession.getState().forgetLocale(); router.replace("/"); }}
          className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold active:scale-[0.98]">
          <Store className="h-5 w-5" /> Cambia locale
          <span className="ml-auto text-sm font-medium text-muted">torna al portale</span>
        </button>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-2.5">
      <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">{icon} {label}</p>
      <p className="mt-0.5 font-display text-[22px] font-extrabold leading-none">{value}</p>
      {sub && <p className="mt-1 text-[11px] font-semibold leading-tight">{sub}</p>}
    </div>
  );
}
