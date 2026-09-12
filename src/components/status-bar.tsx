"use client";
// Legenda di sala: una riga di testo piccola, senza contenitore né sfondo.
// Sta sotto la mappa e dice l'essenziale: quanti tavoli in ciascuno stato.
import type { ReactNode } from "react";

export type Tally = {
  freeT: number; freeC: number;
  busyT: number; busyC: number;
  overT: number; heldT: number;
};

export function StatusBar({ counts, children }: { counts: Tally; children?: ReactNode }) {
  const items = [
    { dot: "bg-ok", value: counts.freeT, label: "liberi", hint: `${counts.freeC} coperti` },
    { dot: "bg-soon", value: counts.heldT, label: "prenotati" },
    { dot: "bg-busy", value: counts.busyT, label: "occupati", hint: `${counts.busyC} coperti` },
    { dot: "bg-over", value: counts.overT, label: "oltre l'ora" },
  ].filter((item) => item.value > 0 || item.label === "liberi");

  return (
    <p className="no-scrollbar flex items-center gap-x-2.5 gap-y-1 overflow-x-auto px-1 text-[11px] leading-none text-muted">
      {items.map((item, index) => (
        <span key={item.label} className="flex shrink-0 items-center gap-1">
          <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${item.dot}`} />
          <b className="font-bold tabular-nums">{item.value}</b>
          <span className="font-medium">{item.label}</span>
          {item.hint && <span className="hidden font-normal opacity-60 sm:inline">({item.hint})</span>}
          {index < items.length - 1 && <span className="ml-0.5 opacity-30">·</span>}
        </span>
      ))}
      {children}
    </p>
  );
}
