"use client";
// Navigazione per giorno: frecce, e un tocco sulla data apre il calendario.
// Un solo tocco per scegliere il giorno, e "Oggi" per tornare al servizio corrente.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, CornerUpLeft } from "lucide-react";
import { addDays, dayLabel, relDay, todayISO } from "@/lib/time";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const DOW = ["L", "M", "M", "G", "V", "S", "D"];

export function monthMatrix(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const shift = (first.getDay() + 6) % 7;             // settimana che inizia di lunedì
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(shift).fill(null);
  for (let d = 1; d <= days; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function DayNav({ date, onChange, counts }: {
  date: string; onChange: (d: string) => void;
  counts?: Map<string, { res: number; covers: number }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = todayISO();
  const [cursor, setCursor] = useState(() => new Date(date + "T12:00:00"));

  const toggleCalendar = () => {
    if (!open) setCursor(new Date(date + "T12:00:00"));
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [open]);

  const cells = monthMatrix(cursor.getFullYear(), cursor.getMonth());

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(addDays(date, -1))} aria-label="Giorno prima"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-raised active:scale-95"><ChevronLeft className="h-5 w-5" /></button>

        <button onClick={toggleCalendar}
          className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border bg-surface px-3 py-2 active:scale-[0.98] ${open ? "border-brand" : "border-line"}`}>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-extrabold leading-tight">{relDay(date)}</span>
            <span className="block truncate text-[12px] font-semibold text-muted">{dayLabel(date)}</span>
          </span>
        </button>

        {date !== today && (
          <button onClick={() => onChange(today)} aria-label="Torna a oggi" title="Oggi"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand active:scale-95">
            <CornerUpLeft className="h-5 w-5" />
          </button>
        )}
        <button onClick={() => onChange(addDays(date, 1))} aria-label="Giorno dopo"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-raised active:scale-95"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {open && (
        <div className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-[min(94vw,360px)] -translate-x-1/2 rounded-3xl border border-line bg-surface p-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="grid h-10 w-10 place-items-center rounded-xl bg-raised active:scale-95" aria-label="Mese prima"><ChevronLeft className="h-4 w-4" /></button>
            <p className="font-display text-[17px] font-bold capitalize">{MESI[cursor.getMonth()]} {cursor.getFullYear()}</p>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="grid h-10 w-10 place-items-center rounded-xl bg-raised active:scale-95" aria-label="Mese dopo"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {DOW.map((d, i) => <span key={i} className="grid h-6 place-items-center text-[11px] font-bold text-muted">{d}</span>)}
            {cells.map((iso, i) => {
              if (!iso) return <span key={i} />;
              const isToday = iso === today;
              const active = iso === date;
              const c = counts?.get(iso);
              return (
                <button key={iso} onClick={() => { onChange(iso); setOpen(false); }}
                  className={`relative grid h-11 place-items-center rounded-xl text-[15px] font-bold active:scale-95
                    ${active ? "bg-brand text-on-brand" : isToday ? "bg-brand/15 text-brand" : "bg-raised/60"}`}>
                  {Number(iso.slice(-2))}
                  {c && c.res > 0 && !active && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-busy" />
                  )}
                </button>
              );
            })}
          </div>
          <button onClick={() => { onChange(today); setOpen(false); }}
            className="mt-2 min-h-[44px] w-full rounded-2xl bg-raised text-[15px] font-bold active:scale-95">Vai a oggi</button>
        </div>
      )}
    </div>
  );
}
