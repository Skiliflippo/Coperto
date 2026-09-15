"use client";
// ─────────────────────────────────────────────────────────────────────────────
// AREA SVILUPPATORE · registra un nuovo cliente e genera il suo indirizzo.
// Non è collegata da nessun menu dell'app: ci si arriva solo conoscendo /admin,
// e senza la password del server non si vede nulla.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Store } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Btn, Field, Input, SkeletonRows } from "@/components/ui";

type Row = {
  id: string; name: string; slug: string;
  onboarded: boolean; createdAt: string; staff: number; tables: number;
};

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [pin, setPin] = useState("");
  const [created, setCreated] = useState<{ name: string; slug: string; pin: string } | null>(null);
  const [copied, setCopied] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const linkFor = (slug: string) => `${origin}/r/${slug}/login`;

  const load = async (pwd: string) => {
    setBusy(true); setErr("");
    try {
      const d = await api<{ restaurants: Row[] }>("/api/admin", { method: "POST", body: { password: pwd, action: "list" } });
      setRows(d.restaurants);
      setUnlocked(true);
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : "Accesso non riuscito");
    }
    setBusy(false);
  };

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const d = await api<{ restaurant: { name: string; slug: string } }>("/api/admin", {
        method: "POST",
        body: { password, action: "create", restaurantName: name, ownerName: owner, pin },
      });
      setCreated({ name: d.restaurant.name, slug: d.restaurant.slug, pin });
      setName(""); setOwner(""); setPin("");
      await load(password);
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : "Creazione non riuscita");
    }
    setBusy(false);
  };

  const copy = async (text: string, key: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };

  if (!unlocked) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-sm place-items-center px-6">
        <div className="w-full">
          <h1 className="font-display text-2xl font-bold">Area sviluppatore</h1>
          <p className="mt-1.5 text-sm text-muted">Gestione dei ristoranti registrati.</p>
          <form className="mt-6 grid gap-3" onSubmit={(e) => { e.preventDefault(); load(password); }}>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            {err && <p className="font-semibold text-over">{err}</p>}
            <Btn size="xl" type="submit" disabled={busy || !password}>
              <KeyRound className="h-5 w-5" /> Entra
            </Btn>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-10">
      <h1 className="font-display text-[28px] font-bold">Ristoranti</h1>
      <p className="mt-1 text-sm text-muted">{rows.length} registrati su questo server.</p>

      {created && (
        <div className="mt-5 rounded-3xl border-2 border-ok/50 bg-ok/10 p-4">
          <p className="font-bold text-ok">{created.name} è pronto</p>
          <p className="mt-1 text-sm text-muted">
            Dai al ristoratore questo <b className="text-ink">codice locale</b> e il PIN <b className="text-ink">{created.pin}</b>.
            Il codice serve per entrare dalla pagina iniziale.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-surface px-3 py-3">
            <code className="flex-1 font-display text-2xl font-extrabold tracking-[0.18em]">{created.slug}</code>
            <button onClick={() => copy(created.slug, "code")}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ok px-3 text-sm font-bold text-white active:scale-95">
              {copied === "code" ? "Copiato" : "Copia"}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-surface px-3 py-2.5 text-[13px] font-semibold">
              {linkFor(created.slug)}
            </code>
            <button onClick={() => copy(linkFor(created.slug), "new")}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ok px-3 text-sm font-bold text-white active:scale-95">
              {copied === "new" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === "new" ? "Copiato" : "Copia"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-3xl border border-line bg-surface p-4">
        <p className="flex items-center gap-2 font-bold"><Plus className="h-4 w-4" /> Nuovo cliente</p>
        <div className="mt-3 grid gap-3">
          <Field label="Nome del ristorante">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Pizzeria Mario" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome del titolare">
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="es. Mario" />
            </Field>
            <Field label="PIN a 4 cifre">
              <Input value={pin} inputMode="numeric" placeholder="1234"
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </Field>
          </div>
          <p className="text-[13px] text-muted">Il codice locale viene generato automaticamente alla creazione.</p>
          {err && <p className="font-semibold text-over">{err}</p>}
          <Btn size="xl" disabled={busy || !name.trim() || !owner.trim() || pin.length !== 4} onClick={create}>
            <Store className="h-5 w-5" /> Registra e genera il link
          </Btn>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {busy && !rows.length && <SkeletonRows n={3} h={72} />}
        {rows.map((r) => (
          <div key={r.id} className="rounded-2xl border border-line bg-surface p-3.5">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-bold">{r.name}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${r.onboarded ? "bg-ok/15 text-ok" : "bg-soon/15 text-soon"}`}>
                {r.onboarded ? "attivo" : "da configurare"}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] text-muted">{r.staff} in organico · {r.tables} tavoli</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-raised px-2.5 py-1.5 text-[12px] font-semibold tracking-wide">{r.slug}</code>
              <button onClick={() => copy(linkFor(r.slug), r.id)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-muted active:scale-95"
                aria-label={`Copia link di ${r.name}`} title={linkFor(r.slug)}>
                {copied === r.id ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
