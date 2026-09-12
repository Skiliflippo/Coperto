"use client";
// ─────────────────────────────────────────────────────────────────────────────
// PRIMO AVVIO · database vuoto: si crea il ristorante e l'account del titolare.
// Subito dopo parte il percorso guidato della piantina (RoomWizard).
// Tre passi, nessun campo superfluo: nome locale → chi sei → PIN.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Delete, Store, User } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/store/session";
import { Btn } from "@/components/ui";
import type { StaffSession } from "@/lib/types";

export default function SetupPage() {
  const router = useRouter();
  const setStaff = useSession((s) => s.setStaff);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [restaurantName, setRestaurantName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Se l'app è già configurata questa pagina non deve esistere: si va al login.
  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/setup")
      .then((d) => { if (!d.needsSetup) router.replace("/login"); else setChecking(false); })
      .catch((e: unknown) => {
        setErr(e instanceof ApiError ? e.message : "Database non raggiungibile");
        setChecking(false);
      });
  }, [router]);

  const create = async () => {
    if (busy) return;
    if (pin !== confirmPin) { setErr("I due PIN non coincidono"); setConfirmPin(""); return; }
    setBusy(true);
    setErr("");
    try {
      const session = await api<StaffSession>("/api/setup", {
        method: "POST",
        body: { restaurantName, ownerName, pin },
      });
      setStaff(session);           // entra già come titolare
      router.replace("/sala");     // da qui parte il wizard della piantina
    } catch (error: unknown) {
      setErr(error instanceof ApiError ? error.message : "Configurazione non riuscita");
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="grid h-16 w-16 animate-pop place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand">C</div>
          <p className="text-sm font-semibold text-muted">Controllo la configurazione…</p>
        </div>
      </div>
    );
  }

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "x"];
  const activePin = step === 2 && pin.length === 4 ? confirmPin : pin;
  const setActivePin = (value: string) => {
    if (step === 2 && pin.length === 4) setConfirmPin(value);
    else setPin(value);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[env(safe-area-inset-bottom)] pt-[max(env(safe-area-inset-top),2rem)]">
      <div className="flex items-center gap-3 pb-6 pt-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand" : "bg-raised"}`} />
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand font-display text-2xl font-bold text-on-brand shadow-lg shadow-brand/30">C</div>
          <h1 className="mt-4 font-display text-[30px] font-bold leading-tight">Benvenuto in Coperto</h1>
          <p className="mt-2 text-muted">
            Due minuti per configurare il locale. Poi disegniamo la sala e si comincia a lavorare.
          </p>

          <label className="mt-8 block">
            <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-muted">
              <Store className="h-4 w-4" /> Nome del ristorante
            </span>
            <input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value.slice(0, 60))}
              placeholder="es. Osteria del Vicolo" autoFocus
              className="min-h-[60px] w-full rounded-2xl border border-line bg-surface px-4 text-lg font-semibold outline-none focus:border-brand" />
          </label>

          <div className="mt-6">
            <Btn size="xl" disabled={!restaurantName.trim()} onClick={() => setStep(1)}>
              Avanti <ArrowRight className="h-5 w-5" />
            </Btn>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="font-display text-[28px] font-bold leading-tight">Chi sei?</h1>
          <p className="mt-1.5 text-muted">
            Il tuo nome comparirà accanto alle azioni fatte in sala. Sarai il titolare:
            potrai aggiungere il resto del personale dopo.
          </p>

          <label className="mt-7 block">
            <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-muted">
              <User className="h-4 w-4" /> Il tuo nome
            </span>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value.slice(0, 20))}
              placeholder="es. Marco" autoFocus
              className="min-h-[60px] w-full rounded-2xl border border-line bg-surface px-4 text-lg font-semibold outline-none focus:border-brand" />
          </label>

          <div className="mt-6 grid gap-2">
            <Btn size="xl" disabled={!ownerName.trim()} onClick={() => { setPin(""); setConfirmPin(""); setStep(2); }}>
              Avanti <ArrowRight className="h-5 w-5" />
            </Btn>
            <Btn variant="ghost" onClick={() => setStep(0)}>Indietro</Btn>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="font-display text-[28px] font-bold leading-tight">
            {pin.length === 4 ? "Ripeti il PIN" : "Scegli un PIN"}
          </h1>
          <p className="mt-1.5 text-muted">
            {pin.length === 4
              ? "Solo per essere sicuri di non sbagliarlo."
              : "Quattro cifre per entrare in servizio, veloci da digitare con le mani occupate."}
          </p>

          <div className="mb-6 mt-8 flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-4 w-4 rounded-full transition-all ${activePin.length > i ? "scale-110 bg-brand" : "bg-raised"}`} />
            ))}
          </div>
          {err && <p className="mb-4 animate-pop text-center font-bold text-over">{err}</p>}

          <div className="mx-auto grid w-full max-w-[300px] grid-cols-3 gap-3">
            {digits.map((k, i) =>
              k === "" ? <div key={i} /> : k === "x" ? (
                <button key={i} aria-label="Cancella" disabled={busy}
                  onClick={() => { setErr(""); setActivePin(activePin.slice(0, -1)); }}
                  className="grid h-[72px] place-items-center rounded-3xl text-muted active:scale-95">
                  <Delete className="h-7 w-7" />
                </button>
              ) : (
                <button key={i} disabled={busy}
                  onClick={() => {
                    if (activePin.length >= 4) return;
                    setErr("");
                    setActivePin(activePin + k);
                  }}
                  className="h-[72px] rounded-3xl bg-surface text-3xl font-bold shadow-sm ring-1 ring-line active:scale-95 active:bg-raised">
                  {k}
                </button>
              ))}
          </div>

          <div className="mt-6 grid gap-2">
            <Btn size="xl" disabled={busy || pin.length !== 4 || confirmPin.length !== 4} onClick={create}>
              <Check className="h-5 w-5" /> Crea il locale
            </Btn>
            <Btn variant="ghost" onClick={() => { setPin(""); setConfirmPin(""); setErr(""); setStep(1); }}>
              Indietro
            </Btn>
          </div>
        </>
      )}

      <p className="mt-auto pb-6 pt-8 text-center text-[13px] text-muted">
        {restaurantName.trim() ? `${restaurantName.trim()} · configurazione iniziale` : "Configurazione iniziale"}
      </p>
    </div>
  );
}
