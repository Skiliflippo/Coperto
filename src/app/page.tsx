"use client";
// ─────────────────────────────────────────────────────────────────────────────
// PORTALE DI ACCESSO · la root non sceglie più il primo record del database.
// Ogni ristorante entra soltanto dal proprio codice/slug.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Store } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/store/session";

// Il campo accetta il codice locale alfanumerico (es. K7MQ2XRQ4T).
function normalizeSlug(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export default function Home() {
  const router = useRouter();
  const rememberedSlug = useSession((s) => s.rememberedSlug);
  const hydrated = useSession((s) => s.hydrated);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Locale già memorizzato su questo dispositivo: si riapre direttamente,
  // senza chiedere di nuovo il codice.
  useEffect(() => {
    if (!hydrated || !rememberedSlug) return;
    router.replace(`/r/${rememberedSlug}`);
  }, [hydrated, rememberedSlug, router]);

  const go = async () => {
    const slug = normalizeSlug(value);
    if (!slug) {
      setError("Inserisci il codice del tuo locale.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api<{ exists: true; slug: string; name: string }>(
        `/api/tenant?slug=${encodeURIComponent(slug)}`,
      );
      router.push(`/r/${result.slug}/login`);
    } catch (caught: unknown) {
      const message = caught instanceof ApiError
        ? caught.message
        : "Non riesco a verificare il codice. Riprova tra poco.";
      setError(message);
      setLoading(false);
    }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-12">
      {/* Fondo leggero: il portale resta neutro e adatto a qualsiasi tema cliente. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_5%,var(--brand-soft),transparent_42%)] opacity-70" />

      <section className="relative w-full max-w-md rounded-[32px] border border-line bg-surface/90 p-6 shadow-2xl backdrop-blur sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-brand font-display text-3xl font-bold text-on-brand shadow-lg shadow-brand/25">
            C
          </div>
          <h1 className="mt-4 font-display text-[34px] font-bold leading-none tracking-tight">Coperto</h1>
          <p className="mt-2 text-sm font-medium text-muted">Gestione sala e prenotazioni</p>
        </div>

        <form className="mt-8" onSubmit={(event) => { event.preventDefault(); void go(); }}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-muted">
              Codice locale
            </span>
            <div className={`flex min-h-[60px] items-center gap-3 rounded-2xl border bg-bg px-4 transition-colors ${
              error ? "border-over" : "border-line focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
            }`}>
              <Store className="h-5 w-5 shrink-0 text-muted" />
              <input
                value={value}
                onChange={(event) => { setValue(event.target.value); setError(""); }}
                placeholder="Codice a 10 caratteri"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold outline-none placeholder:font-normal placeholder:text-muted/60"
              />
            </div>
          </label>

          <p className={`mt-2 min-h-5 text-sm font-semibold ${error ? "text-over" : "text-muted"}`} role="alert">
            {error || "Lo trovi nel messaggio di attivazione."}
          </p>

          <button type="submit" disabled={loading || !value.trim()}
            className="mt-4 flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-[17px] font-bold text-on-brand shadow-lg shadow-brand/20 active:scale-[0.98] disabled:opacity-40">
            {loading ? "Controllo…" : "Vai al locale"}
            {!loading && <ArrowRight className="h-5 w-5" />}
          </button>
        </form>
      </section>
    </main>
  );
}
