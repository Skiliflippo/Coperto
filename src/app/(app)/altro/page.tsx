"use client";
// ALTRO — Riepilogo di fine servizio (semplice, non BI) + identità + impostazioni.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Armchair, ChevronRight, Download, Hourglass, Moon, Sun, LogOut, Settings, TrendingDown, TrendingUp,
  UserX, Users, Footprints, Activity, Timer,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { relDay, todayISO } from "@/lib/time";
import { SkeletonRows } from "@/components/ui";
import { useRouter } from "next/navigation";

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
      : d > 0 ? <span className="inline-flex items-center gap-0.5 text-ok"><TrendingUp className="h-3.5 w-3.5" />+{d}% vs 7gg</span>
      : <span className="inline-flex items-center gap-0.5 text-over"><TrendingDown className="h-3.5 w-3.5" />{d}% vs 7gg</span>;
  };

  return (
    <div className="px-4 pb-6">
      <header className="pt-[calc(env(safe-area-inset-top)+14px)]">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">Coperto</p>
        <h1 className="font-display text-[28px] font-bold leading-tight">Riepilogo · {relDay(date).toLowerCase()}</h1>
      </header>

      {summary.isLoading || !S ? <div className="mt-4"><SkeletonRows n={4} h={80} /></div> : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Stat big icon={<Users className="h-5 w-5" />} label="Coperti serviti" value={String(S.covers)} sub={delta(S.covers, S.weekAvg.covers)} />
            <Stat icon={<Armchair className="h-5 w-5" />} label="Girature" value={String(S.tablesTurned)} sub={`${S.seatings} gruppi seduti`} />
            <Stat icon={<Timer className="h-5 w-5" />} label="Permanenza media" value={`${S.avgStay}′`} sub={topPeak ? `Picco: ${topPeak.hour}:00 (${topPeak.covers} coperti)` : undefined} />
            <Stat icon={<Footprints className="h-5 w-5" />} label="Walk-in vs prenotati" value={`${S.walkInCovers}/${S.bookedCovers}`} sub={`${S.walkIns} gruppi senza prenotazione`} />
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <div className="rounded-3xl border border-line bg-surface p-4">
              <p className="flex items-center gap-1.5 text-sm font-bold text-muted"><UserX className="h-4 w-4" /> No-show</p>
              <p className="mt-1 font-display text-3xl font-extrabold">{S.noShows} <span className="text-base font-bold text-muted">({S.noShowPct}%)</span></p>
              <p className="text-[13px] font-semibold text-over">{S.coversLost} coperti persi</p>
              <p className="mt-0.5 text-[13px] text-muted">media 7gg: {S.weekAvg.noShows}</p>
            </div>
            <div className="rounded-3xl border border-line bg-surface p-4">
              <p className="flex items-center gap-1.5 text-sm font-bold text-muted"><Hourglass className="h-4 w-4" /> Arrivi</p>
              <p className="mt-1 font-display text-3xl font-extrabold">{S.arrived}<span className="text-base font-bold text-muted">/{S.booked}</span></p>
              <p className="text-[13px] font-semibold text-soon">ritardo medio {S.avgLate}′</p>
              <p className="mt-0.5 text-[13px] text-muted">{S.cancelled} cancellate</p>
            </div>
          </div>

          {S.peak.length > 0 && (
            <div className="mt-2.5 rounded-3xl border border-line bg-surface p-4">
              <p className="text-sm font-bold text-muted">Quando siete andati più forte (coperti seduti per ora)</p>
              <div className="mt-3 flex h-24 items-end gap-1.5">
                {[...S.peak].sort((a, b) => a.hour - b.hour).map((p) => {
                  const max = Math.max(...S.peak.map((x) => x.covers));
                  return (
                    <div key={p.hour} className="flex-1 text-center">
                      <div className="mx-auto w-full max-w-10 rounded-t-lg bg-brand/80" style={{ height: `${Math.max(8, (p.covers / max) * 72)}px` }} title={`${p.covers}`} />
                      <p className="mt-1 text-[11px] font-bold text-muted">{p.hour}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <a href={`/api/summary?rid=${rid}&date=${date}&csv=1`} download
            className="mt-3 flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border-2 border-line bg-surface font-semibold active:scale-[0.98]">
            <Download className="h-5 w-5" /> Esporta riepilogo CSV (oggi + 7 giorni)
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
          Tema {theme === "light" ? "scuro" : "chiaro"} <span className="ml-auto text-sm text-muted">{theme === "light" ? "per il servizio di sera" : "per il dehors col sole"}</span>
        </button>
        {staff?.role === "titolare" && (
          <Link href="/altro/personale"
            className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold active:scale-[0.98]">
            <Users className="h-5 w-5" /> Personale e PIN
            <ChevronRight className="ml-auto h-5 w-5 text-muted" />
          </Link>
        )}
        {staff?.role === "titolare" && (
          <Link href="/altro/impostazioni"
            className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold active:scale-[0.98]">
            <Settings className="h-5 w-5" /> Impostazioni sala
            <ChevronRight className="ml-auto h-5 w-5 text-muted" />
          </Link>
        )}
        <button onClick={() => { setStaff(null); router.replace("/login"); }}
          className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold text-over active:scale-[0.98]">
          <LogOut className="h-5 w-5" /> Cambia utente <span className="ml-auto text-sm font-medium text-muted">{staff?.name} · {staff?.role === "titolare" ? "Titolare" : "Staff"}</span>
        </button>
        <p className="pt-2 text-center text-[13px] text-muted">Coperto · gestione sala e prenotazioni · i tuoi dati restano tuoi</p>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub, big }: { icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode; big?: boolean }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold text-muted">{icon} {label}</p>
      <p className={`mt-1 font-display font-extrabold ${big ? "text-4xl" : "text-3xl"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[13px] font-semibold">{sub}</p>}
    </div>
  );
}
