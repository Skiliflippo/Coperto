"use client";
// Primitive UI da sala: target ≥56px, icone SEMPRE con etichetta, feedback a pressione.
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

type BtnVariant = "primary" | "soft" | "danger" | "ok" | "ghost";
const VARIANTS: Record<BtnVariant, string> = {
  primary: "bg-brand text-on-brand shadow-sm",
  soft: "bg-raised text-ink",
  danger: "bg-over/15 text-over border-2 border-over/50",
  ok: "bg-ok text-white",
  ghost: "text-muted",
};
export function Btn({ children, variant = "primary", onClick, disabled, className = "", size = "lg", type = "button" }: {
  children: ReactNode; variant?: BtnVariant; onClick?: () => void; disabled?: boolean;
  className?: string; size?: "md" | "lg" | "xl"; type?: "button" | "submit";
}) {
  const h = size === "xl" ? "min-h-[72px] text-lg px-6" : size === "lg" ? "min-h-[56px] px-5" : "min-h-[48px] px-4 text-[15px]";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex w-full items-center justify-center gap-2.5 rounded-2xl font-semibold transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 ${h} ${VARIANTS[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Sheet({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-[60]">
      <div className="absolute inset-0 animate-fade bg-black/45" onClick={onClose} />
      <div className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border-t border-line bg-surface shadow-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1 truncate text-[17px] font-bold leading-tight">{title}</div>
          <button onClick={onClose} aria-label="Chiudi"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-raised text-muted active:scale-95">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3.5 pb-[calc(env(safe-area-inset-bottom)+16px)]">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; icon?: ReactNode }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-2xl bg-raised p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[15px] font-semibold transition-all active:scale-[0.97] ${value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 20, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string;
}) {
  return (
    <div>
      {label && <div className="mb-2 text-sm font-semibold text-muted">{label}</div>}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="Uno in meno"
          className="grid h-16 w-16 place-items-center rounded-2xl bg-raised text-3xl font-bold active:scale-95">−</button>
        <div className="w-20 text-center font-display text-5xl font-bold tabular-nums">{value}</div>
        <button onClick={() => onChange(Math.min(max, value + 1))} aria-label="Uno in più"
          className="grid h-16 w-16 place-items-center rounded-2xl bg-raised text-3xl font-bold active:scale-95">+</button>
      </div>
    </div>
  );
}

export function Chip({ children, cls = "" }: { children: ReactNode; cls?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold leading-none ${cls}`}>
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className={`min-h-[56px] w-full rounded-2xl border border-line bg-bg px-4 font-medium outline-none placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/30 ${props.className ?? ""}`} />
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function SkeletonRows({ n = 4, h = 72 }: { n?: number; h?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="skeleton rounded-2xl" style={{ height: h }} />)}
    </div>
  );
}
