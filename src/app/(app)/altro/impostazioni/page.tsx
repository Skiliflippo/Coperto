"use client";
// IMPOSTAZIONI — tutto quello che nella carta è "abitudine", qui è configurazione.
// Solo il titolare. Ogni numero cambia il comportamento di sala e piano.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Check, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useBootstrap } from "@/lib/hooks";
import { useSession } from "@/store/session";
import type { Settings } from "@/lib/types";
import { Btn, Field, SkeletonRows } from "@/components/ui";
import { toast } from "@/components/toast";

function Num({ label, value, onChange, min = 0, max = 60, step = 5, suffix = "min" }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-[15px] font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(min, value - step))} className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-2xl font-bold active:scale-95">−</button>
        <p className="w-20 text-center font-display text-xl font-extrabold tabular-nums">{value}<span className="ml-0.5 text-xs font-semibold text-muted">{suffix}</span></p>
        <button onClick={() => onChange(Math.min(max, value + step))} className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-2xl font-bold active:scale-95">+</button>
      </div>
    </div>
  );
}

export default function ImpostazioniPage() {
  const staff = useSession((s) => s.staff);
  const me = staff?.name ?? "";
  const rid = staff?.restaurantId;
  const boot = useBootstrap();
  const qc = useQueryClient();
  const [s, setS] = useState<Settings | null>(null);
  const [periods, setPeriods] = useState<{ id: string; name: string; startTime: string; endTime: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (boot.data && !s) {
      setS(boot.data.settings);
      setPeriods(boot.data.periods.map((p) => ({ id: p.id, name: p.name, startTime: p.startTime, endTime: p.endTime })));
    }
  }, [boot.data, s]);

  if (staff?.role !== "titolare") {
    return (
      <div className="px-4 pt-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-soon" />
        <p className="mt-3 font-bold">Solo il titolare tocca le impostazioni.</p>
        <Link href="/altro" className="mt-4 inline-block rounded-2xl bg-raised px-5 py-3 font-semibold">Torna ad Altro</Link>
      </div>
    );
  }
  if (!boot.data || !s) return <div className="px-4 pt-6"><SkeletonRows n={6} /></div>;

  const setBand = (turno: string, band: "base" | "large" | "xl", v: number) =>
    setS({ ...s, durations: { ...s.durations, [turno]: { ...s.durations[turno], [band]: v } } });
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PUT", body: { restaurantId: rid, staffName: me, settings: s, periods } });
      await qc.invalidateQueries({ queryKey: ["bootstrap", rid] });
      toast({ title: "Impostazioni salvate", msg: "Attive da subito su tutti i dispositivi.", tone: "ok" });
    } catch (e: any) { toast({ title: e.message, tone: "err" }); }
    setBusy(false);
  };

  return (
    <div className="px-4 pb-6">
      <header className="flex items-center gap-3 pt-[calc(env(safe-area-inset-top)+14px)]">
        <Link href="/altro" className="grid h-12 w-12 place-items-center rounded-2xl bg-raised active:scale-95" aria-label="Indietro"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="font-display text-[24px] font-bold">Impostazioni</h1>
      </header>

      <p className="mt-4 text-sm font-bold uppercase tracking-wide text-muted">Ritmo del servizio</p>
      <div className="mt-2 space-y-2">
        <Num label="Granularità slot piano" value={s.slotMinutes} onChange={(v) => setS({ ...s, slotMinutes: v })} min={5} max={30} step={5} />
        <Num label="Buffer riassetto tra turni" value={s.bufferMinutes} onChange={(v) => setS({ ...s, bufferMinutes: v })} min={0} max={45} step={5} />
        <Num label="Evidenzia 'in ritardo' dopo" value={s.lateThresholdMinutes} onChange={(v) => setS({ ...s, lateThresholdMinutes: v })} min={5} max={30} step={5} />
        <Num label="Proponi no-show dopo" value={s.noShowThresholdMinutes} onChange={(v) => setS({ ...s, noShowThresholdMinutes: v })} min={5} max={45} step={5} />
        <Num label="Alert overbooking al" value={s.overbookingPct} onChange={(v) => setS({ ...s, overbookingPct: v })} min={50} max={110} step={5} suffix="%" />
      </div>

      {boot.data.periods.map((p) => {
        const key = p.name.toLowerCase();
        const d = s.durations[key] ?? s.durations.cena;
        return (
          <div key={p.id}>
            <p className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Durata tavoli · {p.name}</p>
            <div className="mt-2 space-y-2">
              <Num label="Fino a 6 coperti" value={d.base} onChange={(v) => setBand(key, "base", v)} min={30} max={150} step={15} />
              <Num label="7–8 coperti" value={d.large} onChange={(v) => setBand(key, "large", v)} min={45} max={180} step={15} />
              <Num label="9+ coperti" value={d.xl} onChange={(v) => setBand(key, "xl", v)} min={60} max={240} step={15} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label={`${p.name} inizia`}>
                <input type="time" value={periods.find((x) => x.id === p.id)?.startTime ?? p.startTime}
                  onChange={(e) => setPeriods(periods.map((x) => x.id === p.id ? { ...x, startTime: e.target.value } : x))}
                  className="min-h-[56px] w-full rounded-2xl border border-line bg-surface px-4 font-display text-lg font-bold outline-none focus:border-brand" />
              </Field>
              <Field label={`${p.name} finisce`}>
                <input type="time" value={periods.find((x) => x.id === p.id)?.endTime ?? p.endTime}
                  onChange={(e) => setPeriods(periods.map((x) => x.id === p.id ? { ...x, endTime: e.target.value } : x))}
                  className="min-h-[56px] w-full rounded-2xl border border-line bg-surface px-4 font-display text-lg font-bold outline-none focus:border-brand" />
              </Field>
            </div>
          </div>
        );
      })}

      <div className="mt-6"><Btn size="xl" disabled={busy} onClick={save}><Check className="h-6 w-6" /> Salva impostazioni</Btn></div>
      <p className="mt-3 text-center text-[13px] text-muted">Nuovo ristorante in futuro? Sarà una riga nel database, non codice.</p>
    </div>
  );
}
