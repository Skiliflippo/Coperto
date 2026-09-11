"use client";
// IMPOSTAZIONI — configurazione operativa del ristorante, accessibile al titolare.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Check, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useBootstrap } from "@/lib/hooks";
import { useSession } from "@/store/session";
import type { Bootstrap, Settings, StaffSession } from "@/lib/types";
import { Btn, Field, SkeletonRows } from "@/components/ui";
import { toast } from "@/components/toast";

type PeriodDraft = { id: string; name: string; startTime: string; endTime: string };

function Num({ label, value, onChange, min = 0, max = 60, step = 5, suffix = "min" }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-[15px] font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(min, value - step))}
          className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-2xl font-bold active:scale-95">−</button>
        <p className="w-20 text-center font-display text-xl font-extrabold tabular-nums">
          {value}<span className="ml-0.5 text-xs font-semibold text-muted">{suffix}</span>
        </p>
        <button onClick={() => onChange(Math.min(max, value + step))}
          className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-2xl font-bold active:scale-95">+</button>
      </div>
    </div>
  );
}

export default function ImpostazioniPage() {
  const staff = useSession((state) => state.staff);
  const boot = useBootstrap();

  if (staff?.role !== "titolare") {
    return (
      <div className="px-4 pt-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-soon" />
        <p className="mt-3 font-bold">Solo il titolare tocca le impostazioni.</p>
        <Link href="/altro" className="mt-4 inline-block rounded-2xl bg-raised px-5 py-3 font-semibold">Torna ad Altro</Link>
      </div>
    );
  }
  if (!boot.data) return <div className="px-4 pt-6"><SkeletonRows n={6} /></div>;

  // Il componente figlio nasce solo quando i dati sono disponibili: non serve un
  // effetto che copi i dati della query nello stato locale.
  return <SettingsForm key={boot.data.restaurant.id} staff={staff} boot={boot.data} />;
}

function SettingsForm({ staff, boot }: { staff: StaffSession; boot: Bootstrap }) {
  const qc = useQueryClient();
  const [settings, setSettings] = useState<Settings>(() => structuredClone(boot.settings));
  const [periods, setPeriods] = useState<PeriodDraft[]>(() =>
    boot.periods.map(({ id, name, startTime, endTime }) => ({ id, name, startTime, endTime })),
  );
  const [busy, setBusy] = useState(false);

  const setBand = (turno: string, band: "base" | "large" | "xl", value: number) => {
    const current = settings.durations[turno] ?? settings.durations.cena;
    setSettings({
      ...settings,
      durations: { ...settings.durations, [turno]: { ...current, [band]: value } },
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: {
          restaurantId: staff.restaurantId,
          staffName: staff.name,
          settings,
          periods,
        },
      });
      await qc.invalidateQueries({ queryKey: ["bootstrap", staff.restaurantId] });
      toast({ title: "Impostazioni salvate", msg: "Attive da subito su tutti i dispositivi.", tone: "ok" });
    } catch (error: unknown) {
      toast({ title: error instanceof Error ? error.message : "Salvataggio non riuscito", tone: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pb-6">
      <header className="flex items-center gap-3 pt-[calc(env(safe-area-inset-top)+14px)]">
        <Link href="/altro" className="grid h-12 w-12 place-items-center rounded-2xl bg-raised active:scale-95" aria-label="Indietro">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-[24px] font-bold">Impostazioni</h1>
      </header>

      <p className="mt-4 text-sm font-bold uppercase tracking-wide text-muted">Tavoli</p>
      <div className="mt-2 space-y-2">
        <button onClick={() => setSettings({ ...settings, allowTableJoin: !settings.allowTableJoin })}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left active:scale-[0.99]">
          <span>
            <span className="block text-[15px] font-semibold">Unisci tavoli</span>
            <span className="block text-[13px] text-muted">Se un gruppo non entra, proponi di accostare due tavoli vicini e liberi</span>
          </span>
          <span className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${settings.allowTableJoin ? "bg-ok" : "bg-raised"}`}>
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-all ${settings.allowTableJoin ? "left-7" : "left-1"}`} />
          </span>
        </button>
        {settings.allowTableJoin && (
          <Num label="Distanza max fra tavoli accostabili" value={settings.joinMaxGapCm ?? 90}
            onChange={(value) => setSettings({ ...settings, joinMaxGapCm: value })}
            min={20} max={200} step={10} suffix="cm" />
        )}
      </div>

      <p className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Ritmo del servizio</p>
      <div className="mt-2 space-y-2">
        <Num label="Granularità slot piano" value={settings.slotMinutes} onChange={(value) => setSettings({ ...settings, slotMinutes: value })} min={5} max={30} step={5} />
        <Num label="Buffer riassetto tra turni" value={settings.bufferMinutes} onChange={(value) => setSettings({ ...settings, bufferMinutes: value })} min={0} max={45} step={5} />
        <Num label="Evidenzia in ritardo dopo" value={settings.lateThresholdMinutes} onChange={(value) => setSettings({ ...settings, lateThresholdMinutes: value })} min={5} max={30} step={5} />
        <Num label="Tavolo oltre l'ora dopo" value={settings.overtimeMinutes ?? 60} onChange={(value) => setSettings({ ...settings, overtimeMinutes: value })} min={30} max={180} step={15} />
        <Num label="Prenotazione blocca il tavolo da" value={settings.reservationHoldMinutes ?? 90} onChange={(value) => setSettings({ ...settings, reservationHoldMinutes: value })} min={15} max={180} step={15} />
        <Num label="Proponi no-show dopo" value={settings.noShowThresholdMinutes} onChange={(value) => setSettings({ ...settings, noShowThresholdMinutes: value })} min={5} max={45} step={5} />
        <Num label="Alert overbooking al" value={settings.overbookingPct} onChange={(value) => setSettings({ ...settings, overbookingPct: value })} min={50} max={110} step={5} suffix="%" />
      </div>

      {boot.periods.map((period) => {
        const key = period.name.toLowerCase();
        const duration = settings.durations[key] ?? settings.durations.cena;
        const draft = periods.find((item) => item.id === period.id) ?? period;
        return (
          <div key={period.id}>
            <p className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Durata tavoli · {period.name}</p>
            <div className="mt-2 space-y-2">
              <Num label="Fino a 6 coperti" value={duration.base} onChange={(value) => setBand(key, "base", value)} min={30} max={150} step={15} />
              <Num label="7–8 coperti" value={duration.large} onChange={(value) => setBand(key, "large", value)} min={45} max={180} step={15} />
              <Num label="9+ coperti" value={duration.xl} onChange={(value) => setBand(key, "xl", value)} min={60} max={240} step={15} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label={`${period.name} inizia`}>
                <input type="time" value={draft.startTime}
                  onChange={(event) => setPeriods(periods.map((item) => item.id === period.id ? { ...item, startTime: event.target.value } : item))}
                  className="min-h-[56px] w-full rounded-2xl border border-line bg-surface px-4 font-display text-lg font-bold outline-none focus:border-brand" />
              </Field>
              <Field label={`${period.name} finisce`}>
                <input type="time" value={draft.endTime}
                  onChange={(event) => setPeriods(periods.map((item) => item.id === period.id ? { ...item, endTime: event.target.value } : item))}
                  className="min-h-[56px] w-full rounded-2xl border border-line bg-surface px-4 font-display text-lg font-bold outline-none focus:border-brand" />
              </Field>
            </div>
          </div>
        );
      })}

      <div className="mt-6">
        <Btn size="xl" disabled={busy} onClick={save}><Check className="h-6 w-6" /> Salva impostazioni</Btn>
      </div>
    </div>
  );
}
