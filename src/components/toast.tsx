"use client";
// Toast + pattern "Annulla per 10 secondi": l'azione viene eseguita SUBITO —
// in sala non si aspetta — e per 10 secondi resta la possibilità di rimediare.
// Annulla esegue l'operazione inversa. Niente popup di conferma.
import { create } from "zustand";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

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

/**
 * Esegue l'azione immediatamente e mostra per 10 secondi la possibilità di
 * annullarla. `undo` è l'operazione inversa (riaprire un tavolo, riportare una
 * prenotazione a confermata…), eseguita solo se l'operatore tocca "Annulla".
 */
export async function runWithUndo(
  title: string,
  action: () => Promise<void> | void,
  undo: () => Promise<void> | void,
) {
  try {
    await action();
  } catch (e: any) {
    toast({ title: e?.message ?? "Operazione non riuscita", tone: "err" });
    return;
  }
  let undone = false;
  const id = useToasts.getState().push({
    title, tone: "warn", barMs: 10_000,
    actionLabel: "Annulla",
    onAction: async () => {
      if (undone) return;
      undone = true;
      useToasts.getState().dismiss(id);
      try {
        await undo();
        toast({ title: "Annullato", tone: "ok" });
      } catch (e: any) {
        toast({ title: e?.message ?? "Non è stato possibile annullare", tone: "err" });
      }
    },
  });
  setTimeout(() => useToasts.getState().dismiss(id), 10_000);
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
    <div className="no-print fixed inset-x-3 top-[calc(env(safe-area-inset-top)+8px)] z-[210] flex max-h-[90dvh] flex-col gap-2 overflow-y-auto overscroll-contain pointer-events-none sm:left-auto sm:right-4 sm:w-[380px]">
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
