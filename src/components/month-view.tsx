"use client";
// VISTA CALENDARIO — il mese a colpo d'occhio: quante prenotazioni e quanti coperti
// per giorno. Serve al titolare per vedere dove si concentra il lavoro e quali
// serate sono ancora vuote. Un tocco su un giorno lo apre in Elenco.
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { todayISO } from "@/lib/time";
import { monthMatrix } from "@/components/date-picker";
import { SkeletonRows } from "@/components/ui";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const DOW = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
type DayCount = { date: string; reservations: number; covers: number };

export function MonthView({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const rid = useSession((s) => s.staff?.restaurantId);
  const [cursor, setCursor] = useState(() => new Date(date + "T12:00:00"));
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;

  const q = useQuery({
    queryKey: ["month", rid, from],
    queryFn: () => api<{ days: DayCount[] }>(`/api/month?rid=${rid}&from=${from}&to=${to}`),
    enabled: !!rid,
  });

  const byDate = useMemo(() => new Map((q.data?.days ?? []).map((d) => [d.date, d])), [q.data]);
  const cells = monthMatrix(year, month);
  const today = todayISO();
  const peak = Math.max(1, ...(q.data?.days ?? []).map((d) => d.covers));
  const monthCovers = (q.data?.days ?? []).reduce((a, d) => a + d.covers, 0);
  const monthRes = (q.data?.days ?? []).reduce((a, d) => a + d.reservations, 0);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-raised active:scale-95" aria-label="Mese prima"><ChevronLeft className="h-5 w-5" /></button>
        <div className="text-center">
          <p className="font-display text-[19px] font-bold capitalize leading-tight">{MESI[month]} {year}</p>
          <p className="text-[12px] font-semibold text-muted">{monthRes} prenotazioni · {monthCovers} coperti</p>
        </div>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-raised active:scale-95" aria-label="Mese dopo"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {q.isLoading ? <div className="mt-3"><SkeletonRows n={5} h={56} /></div> : (
        <>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {DOW.map((d) => <span key={d} className="grid h-6 place-items-center text-[11px] font-bold uppercase text-muted">{d}</span>)}
            {cells.map((iso, i) => {
              if (!iso) return <span key={i} />;
              const c = byDate.get(iso);
              const isToday = iso === today;
              const past = iso < today;
              const load = c ? c.covers / peak : 0;
              return (
                <button key={iso} onClick={() => onPick(iso)}
                  className={`relative flex min-h-[62px] flex-col items-center justify-start gap-1 rounded-xl border p-1 pt-1.5 active:scale-95
                    ${iso === date ? "border-brand bg-brand/10" : isToday ? "border-brand/50" : "border-line"} ${past ? "opacity-55" : ""}`}>
                  <span className={`text-[13px] font-extrabold tabular-nums ${isToday ? "text-brand" : ""}`}>{Number(iso.slice(-2))}</span>
                  {c && c.reservations > 0 ? (
                    <>
                      <span className="text-[12px] font-bold leading-none">{c.covers}<span className="text-[9px] font-semibold text-muted">p</span></span>
                      <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(12, load * 100)}%` }} />
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] font-semibold text-muted/60">—</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[12px] text-muted">La barra mostra quanto è pieno il giorno rispetto al più carico del mese.</p>
        </>
      )}
    </div>
  );
}
