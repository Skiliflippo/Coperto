"use client";
// Toast + pattern "Annulla per 10 secondi": l'azione distruttiva viene programmata,
// la UI mostra subito lo stato come fatto (pending), Annulla ferma tutto. Niente popup.
import { create } from "zustand";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";

type Tone = "info" | "ok" | "warn" | "err";
export type ToastItem = {
  id: number; title: string; msg?: string; tone: Tone;
  actionLabel?: string; onAction?: () => void; barMs?: number;
};
type Store = { toasts: ToastItem[]; push: (t: Omit<ToastItem, "id">) => number; dismiss: (id: number) => void };
let seq = 1;
export const useToasts = create<Store>((set) => ({
  toasts: [],
  push: (t) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    if (!t.barMs) setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4200);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
export const toast = (t: Omit<ToastItem, "id">) => useToasts.getState().push(t);

// Registro delle azioni in attesa di commit (per il rendering ottimista)
type Pending = { keys: Set<string>; add: (k: string) => void; remove: (k: string) => void };
export const usePending = create<Pending>((set) => ({
  keys: new Set(),
  add: (k) => set((s) => ({ keys: new Set(s.keys).add(k) })),
  remove: (k) => set((s) => { const n = new Set(s.keys); n.delete(k); return { keys: n }; }),
}));

export function scheduleUndo(key: string, title: string, commit: () => Promise<void> | void) {
  const { add, remove } = usePending.getState();
  add(key);
  const timer = setTimeout(async () => {
    remove(key);
    useToasts.getState().dismiss(id);
    try { await commit(); } catch (e: any) { toast({ title: e?.message ?? "Operazione non riuscita", tone: "err" }); }
  }, 10_000);
  const id = useToasts.getState().push({
    title, tone: "warn", barMs: 10_000,
    actionLabel: "Annulla",
    onAction: () => { clearTimeout(timer); remove(key); useToasts.getState().dismiss(id); },
  });
}

const ICONS: Record<Tone, typeof Info> = { info: Info, ok: CheckCircle2, warn: TriangleAlert, err: TriangleAlert };
const TONE_CLS: Record<Tone, string> = {
  info: "border-line", ok: "border-ok/50", warn: "border-soon/60", err: "border-over/60",
};
const TONE_TXT: Record<Tone, string> = { info: "text-ink", ok: "text-ok", warn: "text-soon", err: "text-over" };

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="no-print fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[70] flex flex-col gap-2 pointer-events-none sm:left-auto sm:right-4 sm:w-[380px]">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div key={t.id} className={`pointer-events-auto animate-pop overflow-hidden rounded-2xl border bg-surface shadow-xl ${TONE_CLS[t.tone]}`}>
            <div className="flex items-center gap-3 px-4 py-3">
              <Icon className={`h-5 w-5 shrink-0 ${TONE_TXT[t.tone]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-snug">{t.title}</p>
                {t.msg && <p className="text-[13px] text-muted leading-snug">{t.msg}</p>}
              </div>
              {t.actionLabel && (
                <button onClick={t.onAction}
                  className="shrink-0 rounded-xl border-2 border-brand px-4 font-bold text-brand active:scale-95"
                  style={{ minHeight: 48 }}>
                  {t.actionLabel}
                </button>
              )}
              {!t.actionLabel && (
                <button onClick={() => dismiss(t.id)} className="shrink-0 rounded-lg p-2 text-muted" aria-label="Chiudi"><X className="h-4 w-4" /></button>
              )}
            </div>
            {t.barMs != null && <div className="undo-bar h-1 bg-soon" style={{ animationDuration: `${t.barMs}ms` }} />}
          </div>
        );
      })}
    </div>
  );
}
