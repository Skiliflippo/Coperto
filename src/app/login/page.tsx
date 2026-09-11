"use client";
// Accesso semplificato: UN account per ristorante, staff con PIN a 4 cifre.
// Il PIN serve a tracciare chi fa cosa, non a bloccare.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Delete } from "lucide-react";
import { useSession } from "@/store/session";
import { api, ApiError } from "@/lib/api";
import type { StaffSession } from "@/lib/types";

type StaffLite = { id: string; name: string; role: string; color: string };

export default function LoginPage() {
  const [list, setList] = useState<StaffLite[]>([]);
  const [restName, setRestName] = useState("");
  const [sel, setSel] = useState<StaffLite | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const setStaff = useSession((s) => s.setStaff);
  const staff = useSession((s) => s.staff);
  const router = useRouter();

  useEffect(() => { if (staff) router.replace("/sala"); }, [staff, router]);
  useEffect(() => {
    api<{ restaurantName: string; staff: StaffLite[] }>("/api/staff")
      .then((d) => { setRestName(d.restaurantName); setList(d.staff); })
      .catch(() => setErr("Server non raggiungibile. Riprova tra poco."));
  }, []);

  const submitPin = async (completePin: string) => {
    if (!sel || completePin.length !== 4 || busy) return;
    setBusy(true);
    try {
      const session = await api<StaffSession>("/api/login", {
        method: "POST",
        body: { staffId: sel.id, pin: completePin },
      });
      setStaff(session);
      router.replace("/sala");
    } catch (error: unknown) {
      setErr(error instanceof ApiError ? error.message : "Accesso non riuscito");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const addDigit = (digit: string) => {
    if (pin.length >= 4 || busy) return;
    setErr("");
    const nextPin = pin + digit;
    setPin(nextPin);
    if (nextPin.length === 4) void submitPin(nextPin);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[env(safe-area-inset-bottom)] pt-[max(env(safe-area-inset-top),2rem)]">
      <div className="flex flex-col items-center gap-2 pb-8 pt-4">
        <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand shadow-lg shadow-brand/30">C</div>
        <h1 className="font-display text-3xl font-bold">Coperto</h1>
        <p className="font-semibold text-muted">{restName || "La tua sala, in tasca"}</p>
      </div>

      {!sel ? (
        <>
          <p className="mb-3 text-center text-sm font-bold uppercase tracking-wide text-muted">Chi sei?</p>
          <div className="grid gap-3">
            {list.map((p) => (
              <button key={p.id} onClick={() => { setSel(p); setErr(""); }}
                className="flex min-h-[72px] items-center gap-4 rounded-3xl border border-line bg-surface px-5 text-left active:scale-[0.98]">
                <span className="grid h-12 w-12 place-items-center rounded-full text-lg font-bold text-white" style={{ background: p.color }}>
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1">
                  <span className="block text-lg font-bold">{p.name}</span>
                  <span className="text-sm font-medium text-muted">{p.role === "titolare" ? "Titolare" : "Staff di sala"}</span>
                </span>
              </button>
            ))}
            {!list.length && !err && <div className="skeleton h-[72px] rounded-3xl" />}
            {err && <p className="text-center font-semibold text-over">{err}</p>}
          </div>
          <p className="mt-auto pb-6 pt-8 text-center text-sm text-muted">Demo: Marco PIN 1234 · Sara 1111 · Luca 2222</p>
        </>
      ) : (
        <>
          <button onClick={() => { setSel(null); setPin(""); setErr(""); }}
            className="mx-auto mb-6 flex min-h-[56px] items-center gap-3 rounded-full border border-line bg-surface px-5 active:scale-[0.97]">
            <span className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white" style={{ background: sel.color }}>
              {sel.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="font-bold">{sel.name}</span>
            <span className="text-sm font-semibold text-muted">cambia</span>
          </button>
          <div className="mb-6 flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-4 w-4 rounded-full transition-all ${pin.length > i ? "scale-110 bg-brand" : "bg-raised"} ${err ? "bg-over/40" : ""}`} />
            ))}
          </div>
          {err && <p className="mb-4 animate-pop text-center font-bold text-over">{err}</p>}
          <div className="mx-auto grid w-full max-w-[300px] grid-cols-3 gap-3">
            {["1","2","3","4","5","6","7","8","9","","0","x"].map((k, i) =>
              k === "" ? <div key={i} /> : k === "x" ? (
                <button key={i} aria-label="Cancella" disabled={busy} onClick={() => setPin((p) => p.slice(0, -1))}
                  className="grid h-[72px] place-items-center rounded-3xl text-muted active:scale-95">
                  <Delete className="h-7 w-7" />
                </button>
              ) : (
                <button key={i} disabled={busy} onClick={() => addDigit(k)}
                  className="h-[72px] rounded-3xl bg-surface text-3xl font-bold shadow-sm ring-1 ring-line active:scale-95 active:bg-raised">
                  {k}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
