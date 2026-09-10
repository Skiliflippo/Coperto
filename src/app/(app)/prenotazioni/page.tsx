"use client";
// PRENOTAZIONI — il quaderno digitale. Elenco o Piano, navigazione per giorno.
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, ListTodo, Phone, Plus, Rows3, LayoutGrid, UserX, Trash2, Armchair, Clock } from "lucide-react";
import { useBootstrap, useDay } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { api } from "@/lib/api";
import { addDays, dayLabel, nowMin, relDay, toMin, todayISO } from "@/lib/time";
import { RES_STATUS } from "@/lib/meta";
import { Btn, Chip, Empty, Segmented, Sheet, SkeletonRows } from "@/components/ui";
import { ReservationFormSheet } from "@/components/reservation-form";
import { Piano, AssignSheet } from "@/components/piano";
import { CheckInSheet } from "@/components/checkin-sheet";
import { scheduleUndo } from "@/components/toast";
import type { Reservation, ResStatus } from "@/lib/types";

function statusOf(r: Reservation, isToday: boolean, lateThr: number): keyof typeof RES_STATUS {
  if (r.status !== "confermata") return r.status;
  if (isToday && nowMin() - toMin(r.time) > lateThr) return "in_ritardo";
  return r.assignedTableId || r.assignedComboId ? "sistemata" : "da_sistemare";
}

export default function PrenotazioniPage() {
  return <Suspense fallback={<div className="px-4 pt-6"><SkeletonRows n={4} /></div>}><Inner /></Suspense>;
}

function Inner() {
  const boot = useBootstrap();
  const me = useSession((s) => s.staff?.name) ?? "";
  const rid = useSession((s) => s.staff?.restaurantId);
  const qc = useQueryClient();
  const params = useSearchParams();
  const [date, setDate] = useState(params.get("date") ?? todayISO());
  const day = useDay(date);
  const [view, setView] = useState<"elenco" | "piano">("elenco");
  const [formOpen, setFormOpen] = useState(false);
  const [sel, setSel] = useState<Reservation | null>(null);
  const [assign, setAssign] = useState<Reservation | null>(null);
  const [checkin, setCheckin] = useState<Reservation | null>(null);
  const [datePick, setDatePick] = useState(false);

  const isToday = date === todayISO();
  const isPast = date < todayISO();

  const grouped = useMemo(() => {
    if (!day.data) return null;
    const rs = day.data.reservations;
    const active = rs.filter((r) => r.status === "confermata" || r.status === "seduta");
    const closed = rs.filter((r) => r.status === "no_show" || r.status === "cancellata");
    const covers = active.filter((r) => r.status === "confermata").reduce((a, r) => a + r.partySize, 0);
    const daSistemare = active.filter((r) => r.status === "confermata" && !r.assignedTableId && !r.assignedComboId).length;
    return { active, closed, covers, daSistemare };
  }, [day.data]);

  if (boot.isLoading || !boot.data) return <div className="px-4 pt-6"><SkeletonRows n={4} h={88} /></div>;
  const lateThr = boot.data.settings?.lateThresholdMinutes ?? 15;

  const tableLabel = (r: Reservation) => {
    if (r.assignedTableId) return `Tav. ${boot.data.tables.find((t) => t.id === r.assignedTableId)?.label ?? "?"}`;
    if (r.assignedComboId) return `Acc. ${boot.data.combos.find((c) => c.id === r.assignedComboId)?.label ?? "?"}`;
    return null;
  };

  return (
    <div className="px-4 pb-6">
      <header className="pt-[calc(env(safe-area-inset-top)+14px)] no-print">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">Coperto</p>
        <h1 className="font-display text-[28px] font-bold leading-tight">Prenotazioni</h1>
      </header>

      {/* Navigazione giorno */}
      <div className="mt-2 flex items-center gap-2 no-print">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Giorno prima" className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-raised active:scale-95"><ChevronLeft className="h-6 w-6" /></button>
        <button onClick={() => setDatePick(true)} className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3 py-2 text-center active:scale-[0.98]">
          <p className="truncate text-lg font-extrabold">{relDay(date)}</p>
          <p className="text-[13px] font-semibold text-muted">{date !== todayISO() && relDay(date) !== dayLabel(date) ? `${dayLabel(date)} · ` : ""}Tocca per il calendario</p>
        </button>
        <button onClick={() => setDate(addDays(date, 1))} aria-label="Giorno dopo" className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-raised active:scale-95"><ChevronRight className="h-6 w-6" /></button>
      </div>
      {datePick && (
        <div className="mt-2 rounded-2xl border border-line bg-surface p-3 no-print">
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value || todayISO()); setDatePick(false); }}
            className="min-h-[52px] w-full rounded-xl border border-line bg-bg px-3 font-display text-lg font-bold outline-none focus:border-brand" />
        </div>
      )}

      {/* Riepilogo giorno */}
      {grouped && (
        <div className="mt-3 flex flex-wrap gap-1.5 no-print">
          <Chip cls="bg-raised border-line">{grouped.active.filter((r) => r.status === "confermata").length} prenotazioni</Chip>
          <Chip cls="bg-raised border-line">{grouped.covers} coperti</Chip>
          {grouped.daSistemare > 0 && <Chip cls={RES_STATUS.da_sistemare.cls}>{grouped.daSistemare} da sistemare</Chip>}
          {isPast && <Chip cls="bg-raised border-line text-muted">Giorno passato</Chip>}
          {!isToday && !isPast && <Chip cls="bg-busy/15 text-busy border-busy/40">Giorno futuro: pianifica in anticipo</Chip>}
        </div>
      )}

      <div className="mt-3 no-print">
        <Segmented value={view} onChange={setView} options={[
          { value: "elenco", label: "Elenco", icon: <Rows3 className="h-5 w-5" /> },
          { value: "piano", label: "Piano", icon: <LayoutGrid className="h-5 w-5" /> },
        ]} />
      </div>

      {day.isLoading || !day.data || !grouped ? (
        <div className="mt-4"><SkeletonRows n={5} h={72} /></div>
      ) : view === "elenco" ? (
        <div className="mt-4 space-y-2 no-print">
          {!grouped.active.length && !grouped.closed.length && (
            <Empty icon={<ListTodo className="h-6 w-6" />} title={`Nessuna prenotazione per ${relDay(date).toLowerCase()}`} hint="Tocca + per rispondere alla prossima telefonata." />
          )}
          {[...grouped.active, ...grouped.closed].map((r) => {
            const st = statusOf(r, isToday, lateThr);
            const meta = RES_STATUS[st];
            const tbl = tableLabel(r);
            const closed = r.status === "no_show" || r.status === "cancellata";
            return (
              <button key={r.id} onClick={() => setSel(r)} disabled={closed}
                className={`flex min-h-[68px] w-full items-center gap-3 rounded-2xl border bg-surface px-4 text-left active:scale-[0.98] ${closed ? "opacity-50" : "border-line"}`}>
                <span className="w-[62px] shrink-0 text-center">
                  <span className="block font-display text-[22px] font-extrabold leading-none tabular-nums">{r.time}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-lg font-bold">{r.guestName}</span>
                    <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[13px] font-bold">{r.partySizeActual ?? r.partySize}p{r.partySizeActual != null && r.partySizeActual !== r.partySize ? ` (da ${r.partySize})` : ""}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-muted">
                    {tbl && <span>{tbl}</span>}
                    {r.notes && <span className="truncate">· {r.notes}</span>}
                    <span className="truncate">· inserita da {r.createdBy || "—"}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <Chip cls={meta.cls}>{meta.label}</Chip>
                  {r.guestPhone && (
                    <a href={`tel:${r.guestPhone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}
                      className="grid h-9 w-9 place-items-center rounded-xl bg-raised text-busy" aria-label="Chiama">
                      <Phone className="h-4 w-4" />
                    </a>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Piano date={date} day={day.data} onTap={setSel} />
      )}

      {/* Area di stampa: la "lista cartacea" di transizione */}
      {grouped && <div className="print-area hidden">
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{boot.data.restaurant.name} — Prenotazioni {dayLabel(date)}</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Ora", "Nome", "Coperti", "Tavolo", "Telefono", "Note"].map((h) => (
            <th key={h} style={{ textAlign: "left", borderBottom: "2px solid #000", padding: "4px 6px", fontSize: 13 }}>{h}</th>))}</tr></thead>
          <tbody>
            {[...grouped.active].sort((a, b) => a.time.localeCompare(b.time)).map((r) => (
              <tr key={r.id}>
                <td style={{ borderBottom: "1px solid #999", padding: "5px 6px", fontWeight: 800 }}>{r.time}</td>
                <td style={{ borderBottom: "1px solid #999", padding: "5px 6px", fontWeight: 700 }}>{r.guestName}{r.status === "seduta" ? " ✓" : ""}</td>
                <td style={{ borderBottom: "1px solid #999", padding: "5px 6px" }}>{r.partySizeActual ?? r.partySize}</td>
                <td style={{ borderBottom: "1px solid #999", padding: "5px 6px" }}>{tableLabel(r) ?? "—"}</td>
                <td style={{ borderBottom: "1px solid #999", padding: "5px 6px" }}>{r.guestPhone}</td>
                <td style={{ borderBottom: "1px solid #999", padding: "5px 6px" }}>{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      <button onClick={() => setFormOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+92px)] right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-on-brand shadow-xl shadow-brand/40 active:scale-95 no-print sm:right-[max(1rem,calc(50%-30rem))]"
        aria-label="Nuova prenotazione">
        <Plus className="h-8 w-8" />
      </button>

      <ReservationFormSheet open={formOpen} onClose={() => setFormOpen(false)} defaultDate={date} />
      <ResSheet res={sel} date={date} onClose={() => setSel(null)}
        onAssign={(r) => { setSel(null); setAssign(r); }}
        onCheckin={(r) => { setSel(null); setCheckin(r); }} />
      <AssignSheet res={assign} date={date} onClose={() => setAssign(null)} />
      <CheckInSheet res={checkin} onClose={() => setCheckin(null)} />
    </div>
  );
}

// Dettaglio prenotazione: modifiche rapide + azioni di stato.
function ResSheet({ res, date, onClose, onAssign, onCheckin }: {
  res: Reservation | null; date: string; onClose: () => void;
  onAssign: (r: Reservation) => void; onCheckin: (r: Reservation) => void;
}) {
  const boot = useBootstrap();
  const me = useSession((s) => s.staff?.name) ?? "";
  const rid = useSession((s) => s.staff?.restaurantId);
  const qc = useQueryClient();
  const isToday = date === todayISO();
  const isFuture = date > todayISO();

  if (!res || !boot.data) return null;
  const tbl = res.assignedTableId ? boot.data.tables.find((t) => t.id === res.assignedTableId)?.label
    : res.assignedComboId ? `${boot.data.combos.find((c) => c.id === res.assignedComboId)?.label} (acc.)` : null;

  const patch = async (body: Record<string, unknown>) => {
    await api(`/api/reservations/${res.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, ...body } });
    await qc.invalidateQueries({ queryKey: ["day", rid] });
    onClose();
  };
  const shift = (min: number) => {
    const [h, m] = res.time.split(":").map(Number);
    const t = h * 60 + m + min;
    patch({ time: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` });
  };

  return (
    <Sheet open={!!res} onClose={onClose}
      title={<span>{res.guestName} · {res.partySize} p. · {res.time}{tbl ? ` · Tav. ${tbl}` : ""}</span>}>
      <div className="grid gap-3">
        {isToday && res.status === "confermata" && (
          <Btn size="xl" onClick={() => onCheckin(res)}><Armchair className="h-6 w-6" /> Check-in · Siedi ora</Btn>
        )}
        {res.status === "confermata" && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Btn variant="soft" onClick={() => shift(-15)}><Clock className="h-5 w-5" /> −15′</Btn>
              <Btn variant="soft" onClick={() => shift(15)}><Clock className="h-5 w-5" /> +15′</Btn>
              <Btn variant="soft" onClick={() => onAssign(res)}><Armchair className="h-5 w-5" /> Tavolo</Btn>
            </div>
            {res.guestPhone && (
              <a href={`tel:${res.guestPhone.replace(/\s/g, "")}`} className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-raised font-semibold active:scale-[0.97]">
                <Phone className="h-5 w-5" /> Chiama {res.guestPhone}
              </a>
            )}
          </>
        )}
        {res.notes && <p className="rounded-xl bg-raised px-3 py-2 text-sm text-muted">Note: {res.notes}</p>}
        <p className="text-[13px] font-medium text-muted">
          Inserita da {res.createdBy || "—"} · {new Date(res.createdAt).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {res.partySizeActual != null && res.partySizeActual !== res.partySize && <> · Seduti in {res.partySizeActual} (prenotati {res.partySize})</>}
        </p>
        {res.status === "confermata" && !isFuture && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Btn variant="danger" onClick={() => {
              scheduleUndo(`noshow:${res.id}`, `${res.guestName} segnato no-show`, () =>
                api(`/api/reservations/${res.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "status", status: "no_show" } })
                  .then(() => qc.invalidateQueries({ queryKey: ["day", rid] })));
              onClose();
            }}><UserX className="h-5 w-5" /> No-show</Btn>
            <Btn variant="danger" onClick={() => {
              scheduleUndo(`canc:${res.id}`, `${res.guestName} cancellato`, () =>
                api(`/api/reservations/${res.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "status", status: "cancellata" } })
                  .then(() => qc.invalidateQueries({ queryKey: ["day", rid] })));
              onClose();
            }}><Trash2 className="h-5 w-5" /> Cancella</Btn>
          </div>
        )}
        {res.status === "no_show" && <Chip cls={RES_STATUS.no_show.cls}>No-show registrato nelle statistiche</Chip>}
      </div>
    </Sheet>
  );
}
