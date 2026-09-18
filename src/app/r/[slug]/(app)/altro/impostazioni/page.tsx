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
import { Btn, Field, Sheet, SkeletonRows } from "@/components/ui";
import { toast } from "@/components/toast";
import { RoomsManager } from "@/components/rooms-manager";
import { THEMES } from "@/lib/themes";
import { useTenantPath } from "@/lib/tenant";

type PeriodDraft = { id: string; name: string; startTime: string; endTime: string };

// Ogni voce spiegata con parole di sala e un esempio concreto.
type Help = { title: string; text: string; example: string };
const HELP: Record<string, Help> = {
  standard: {
    title: "Il tavolo normale del locale",
    text: "Quanti posti ha un tavolo singolo da voi. Serve all'app per capire quali tavoli grandi sono in realtà più tavoli accostati, e in quanti si possono staccare.",
    example: "Se i vostri tavoli sono da 4 e ne create uno da 6 coperti, l'app sa che sono due tavoli uniti: staccandoli tornano due tavoli da 4.",
  },
  unisci: {
    title: "Unire due tavoli",
    text: "Se arriva un gruppo che non entra in nessun tavolo, l'app ti propone di accostarne due o tre vicini e liberi.",
    example: "Arrivano in 6 e hai solo tavoli da 4: l'app dice «accosta il 3 e il 4».",
  },
  distanza: {
    title: "Quanto lontani possono essere",
    text: "Due tavoli si possono accostare solo se sono vicini. Qui decidi quanti centimetri di distanza accetti.",
    example: "Con 150 cm, due tavoli a un metro e mezzo si possono unire. Più in là no.",
  },
  slot: {
    title: "Ogni quanto si prenota",
    text: "Gli orari che l'app ti propone quando prendi una prenotazione al telefono.",
    example: "Con 15 minuti: 20:00, 20:15, 20:30. Con 30: solo 20:00 e 20:30.",
  },
  riassetto: {
    title: "Tempo per riapparecchiare",
    text: "Quanto serve per sparecchiare e rimettere a posto prima che si sieda il gruppo dopo. L'app lo tiene libero da solo.",
    example: "Con 15 minuti: se un tavolo si libera alle 21:00, il prossimo può sedersi dalle 21:15.",
  },
  ritardo: {
    title: "Quando segnalare un ritardo",
    text: "Dopo quanti minuti dall'orario prenotato l'app colora di arancione chi non è ancora arrivato.",
    example: "Prenotazione alle 20:00 e soglia 15: alle 20:15 diventa arancione.",
  },
  oltreora: {
    title: "Quando un tavolo è «da girare»",
    text: "Dopo quanto tempo un tavolo occupato diventa rosso, per ricordarti che è là da un pezzo.",
    example: "Con 60 minuti: chi si è seduto alle 20:00 diventa rosso alle 21:00.",
  },
  tieni: {
    title: "Quanto prima tenere il tavolo",
    text: "Quanto tempo prima dell'orario prenotato il tavolo smette di comparire fra quelli liberi, così nessuno ci fa sedere altri.",
    example: "Con 90 minuti: per una prenotazione alle 21:00, dalle 19:30 quel tavolo risulta impegnato.",
  },
  noshow: {
    title: "Quando proporre «non è venuto»",
    text: "Dopo quanto l'app ti propone di segnare la prenotazione come mancata. Non lo fa mai da sola: decidi tu.",
    example: "Con 15 minuti: alle 20:15 compare il pulsante per una prenotazione delle 20:00.",
  },
  pieno: {
    title: "Avviso sala piena",
    text: "A che percentuale di posti prenotati l'app ti avvisa che quella fascia oraria è carica. È solo un avviso: puoi prenotare lo stesso.",
    example: "Con 90%: su 100 coperti, l'avviso parte a 90 prenotati.",
  },
  durata: {
    title: "Quanto stanno a tavola",
    text: "Il tempo che l'app calcola per ogni gruppo, per capire quando il tavolo tornerà libero.",
    example: "Una coppia a cena: 90 minuti. Una tavolata di 10: due ore.",
  },
  orario: {
    title: "Orari del turno",
    text: "Da che ora a che ora si serve. Sono gli estremi della griglia nella pagina Piano.",
    example: "Cena dalle 19:00 alle 23:30.",
  },
};

function Num({ label, value, onChange, min = 0, max = 60, step = 5, suffix = "min", onInfo }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; suffix?: string;
  onInfo?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-snug">
        <span className="min-w-0 flex-1">{label}</span>
        {onInfo && (
          <button onClick={onInfo} aria-label={`Cosa vuol dire: ${label}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted/15 text-[12px] font-bold text-muted/70 active:scale-90">
            ?
          </button>
        )}
      </p>
      <div className="flex items-center justify-center gap-2">
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
  const tp = useTenantPath();
  const staff = useSession((state) => state.staff);
  const boot = useBootstrap();

  if (staff?.role !== "titolare") {
    return (
      <div className="px-4 pt-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-soon" />
        <p className="mt-3 font-bold">Solo il titolare tocca le impostazioni.</p>
        <Link href={tp("/altro")} className="mt-4 inline-block rounded-2xl bg-raised px-5 py-3 font-semibold">Torna ad Altro</Link>
      </div>
    );
  }
  if (!boot.data) return <div className="px-4 pt-6"><SkeletonRows n={6} /></div>;

  // Il componente figlio nasce solo quando i dati sono disponibili: non serve un
  // effetto che copi i dati della query nello stato locale.
  return <SettingsForm key={boot.data.restaurant.id} staff={staff} boot={boot.data} />;
}

function SettingsForm({ staff, boot }: { staff: StaffSession; boot: Bootstrap }) {
  const tp = useTenantPath();
  const qc = useQueryClient();
  const deviceTheme = useSession((s) => s.deviceTheme);
  const setDeviceTheme = useSession((s) => s.setDeviceTheme);
  const [settings, setSettings] = useState<Settings>(() => structuredClone(boot.settings));
  const [periods, setPeriods] = useState<PeriodDraft[]>(() =>
    boot.periods.map(({ id, name, startTime, endTime }) => ({ id, name, startTime, endTime })),
  );
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<Help | null>(null);

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
      await qc.invalidateQueries({ queryKey: ["bootstrap"] });
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
        <Link href={tp("/altro")} className="grid h-12 w-12 place-items-center rounded-2xl bg-raised active:scale-95" aria-label="Indietro">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-[24px] font-bold">Impostazioni</h1>
      </header>

      <p className="mt-4 text-sm font-bold uppercase tracking-wide text-muted">Colori dell&apos;app</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button key={t.id} onClick={() => setDeviceTheme(t.id)}
            className={`flex items-center gap-2.5 rounded-2xl border-2 p-2.5 text-left active:scale-[0.98] ${(deviceTheme ?? settings.theme) === t.id ? "border-brand bg-brand/10" : "border-line bg-surface"}`}>
            <span className="flex shrink-0 overflow-hidden rounded-lg">
              {t.swatch.map((c) => <span key={c} className="h-9 w-3.5" style={{ background: c }} />)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold">{t.label}</span>
              <span className="block truncate text-[11px] text-muted">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        La scelta vale solo per questo dispositivo: ogni tablet, telefono o iPad della sala può avere il suo tema.
        Il chiaro/scuro resta una scelta di ciascuno.
      </p>
      {deviceTheme && (
        <button onClick={() => setDeviceTheme(undefined)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-muted active:scale-[0.98]">
          Torna al tema del locale
        </button>
      )}

      <RoomsManager boot={boot} />

      <p className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Tavoli</p>
      <div className="mt-2 space-y-2">
        <Num label="Posti di un tavolo normale" value={settings.standardTableSeats ?? 4}
          onChange={(value) => setSettings({ ...settings, standardTableSeats: value })}
          min={2} max={8} step={1} suffix="posti" onInfo={() => setHelp(HELP.standard)} />

        <button onClick={() => setSettings({ ...settings, allowTableJoin: !settings.allowTableJoin })}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left active:scale-[0.99]">
          <span>
            <span className="block text-[15px] font-semibold">Unire due tavoli quando serve</span>
            <span className="block text-[13px] text-muted">Se un gruppo non entra da nessuna parte, l&apos;app propone di accostarne due vicini</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span onClick={(e) => { e.stopPropagation(); setHelp(HELP.unisci); }} role="button" tabIndex={-1}
              aria-label="Cosa vuol dire: unire due tavoli"
              className="grid h-6 w-6 place-items-center rounded-full bg-muted/15 text-[12px] font-bold text-muted/70 active:scale-90">?</span>
            <span className={`relative h-8 w-14 rounded-full transition-colors ${settings.allowTableJoin ? "bg-ok" : "bg-raised"}`}>
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-all ${settings.allowTableJoin ? "left-7" : "left-1"}`} />
            </span>
          </span>
        </button>
        {settings.allowTableJoin && (
          <Num label="Quanto lontani possono essere" value={settings.joinMaxGapCm ?? 150}
            onChange={(value) => setSettings({ ...settings, joinMaxGapCm: value })}
            min={20} max={500} step={10} suffix="cm" onInfo={() => setHelp(HELP.distanza)} />
        )}
      </div>

      <p className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Come funziona il servizio</p>
      <div className="mt-2 space-y-2">
        <Num label="Ogni quanto si prenota" value={settings.slotMinutes} onChange={(value) => setSettings({ ...settings, slotMinutes: value })} min={5} max={30} step={5} onInfo={() => setHelp(HELP.slot)} />
        <Num label="Tempo per riapparecchiare" value={settings.bufferMinutes} onChange={(value) => setSettings({ ...settings, bufferMinutes: value })} min={0} max={45} step={5} onInfo={() => setHelp(HELP.riassetto)} />
        <Num label="Segnala chi è in ritardo dopo" value={settings.lateThresholdMinutes} onChange={(value) => setSettings({ ...settings, lateThresholdMinutes: value })} min={5} max={30} step={5} onInfo={() => setHelp(HELP.ritardo)} />
        <Num label="Tavolo da girare dopo" value={settings.overtimeMinutes ?? 60} onChange={(value) => setSettings({ ...settings, overtimeMinutes: value })} min={30} max={180} step={15} onInfo={() => setHelp(HELP.oltreora)} />
        <Num label="Tieni libero il tavolo da" value={settings.reservationHoldMinutes ?? 90} onChange={(value) => setSettings({ ...settings, reservationHoldMinutes: value })} min={15} max={180} step={15} onInfo={() => setHelp(HELP.tieni)} />
        <Num label="Proponi «non è venuto» dopo" value={settings.noShowThresholdMinutes} onChange={(value) => setSettings({ ...settings, noShowThresholdMinutes: value })} min={5} max={45} step={5} onInfo={() => setHelp(HELP.noshow)} />
        <Num label="Avvisa quando la sala è piena al" value={settings.overbookingPct} onChange={(value) => setSettings({ ...settings, overbookingPct: value })} min={50} max={110} step={5} suffix="%" onInfo={() => setHelp(HELP.pieno)} />
      </div>

      {boot.periods.map((period) => {
        const key = period.name.toLowerCase();
        const duration = settings.durations[key] ?? settings.durations.cena;
        const draft = periods.find((item) => item.id === period.id) ?? period;
        return (
          <div key={period.id}>
            <p className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Quanto stanno a tavola · {period.name}</p>
            <div className="mt-2 space-y-2">
              <Num label="Gruppi fino a 6 persone" value={duration.base} onChange={(value) => setBand(key, "base", value)} min={30} max={150} step={15} onInfo={() => setHelp(HELP.durata)} />
              <Num label="Gruppi da 7 o 8 persone" value={duration.large} onChange={(value) => setBand(key, "large", value)} min={45} max={180} step={15} onInfo={() => setHelp(HELP.durata)} />
              <Num label="Tavolate da 9 in su" value={duration.xl} onChange={(value) => setBand(key, "xl", value)} min={60} max={240} step={15} onInfo={() => setHelp(HELP.durata)} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
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

      <Sheet open={!!help} onClose={() => setHelp(null)} title={help?.title ?? ""}>
        <div className="grid gap-3">
          <p className="text-[17px] leading-snug">{help?.text}</p>
          <p className="rounded-2xl bg-raised px-4 py-3 text-[15px] font-semibold">
            <span className="block text-[12px] font-bold uppercase tracking-wide text-muted">Esempio</span>
            {help?.example}
          </p>
          <Btn onClick={() => setHelp(null)}>Ho capito</Btn>
        </div>
      </Sheet>
    </div>
  );
}
