"use client";
// Check-in: il momento in cui prenotazione e realtà si incontrano.
// Gestisce le deviazioni classiche: ritardo, anticipo, coperti diversi — ognuna con un tap.
import { useMemo, useState } from "react";
import { Phone, UserX, Check, ArrowLeftRight, TriangleAlert, PhoneOutgoing, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { computeTableStatuses } from "@/lib/estimates";
import { nowMin, toMin, todayISO } from "@/lib/time";
import { Btn, Sheet, Chip } from "@/components/ui";
import { scheduleUndo } from "@/components/toast";
import { PartyGrid, SuggestedTables, useSeat } from "@/components/seat-flow";
import type { Reservation } from "@/lib/types";

export function CheckInSheet({ res, onClose }: { res: Reservation | null; onClose: () => void }) {
  const boot = useBootstrap();
  const day = useDay(todayISO());
  const now = useNow(10_000);
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const qc = useQueryClient();
  const seat = useSeat();
  const [party, setParty] = useState<number | null>(null);
  const [changeTable, setChangeTable] = useState(false);
  const [picked, setPicked] = useState<{ tableIds: string[]; tableLabel: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const p = party ?? res?.partySize ?? 2;
  const info = useMemo(() => {
    if (!res || !boot.data) return null;
    const table = boot.data.tables.find((t) => t.id === res.assignedTableId);
    const combo = boot.data.combos.find((c) => c.id === res.assignedComboId);
    return { table, combo };
  }, [res, boot.data]);

  if (!res || !boot.data || !day.data) return null;
  const lateMin = nowMin() - toMin(res.time);
  const isLate = lateMin > boot.data.settings.lateThresholdMinutes;
  const isEarly = lateMin < -boot.data.settings.lateThresholdMinutes;

  // stato del tavolo assegnato: se è ancora occupato lo diciamo subito
  let assignedState: string | null = null;
  if (info?.table && !picked) {
    const statuses = computeTableStatuses({
      tables: boot.data.tables, combos: boot.data.combos,
      seatings: day.data.seatings, reservations: day.data.reservations,
      settings: boot.data.settings, nowMs: now, nowMinOfDay: nowMin(),
    });
    const st = statuses.get(info.table.id)?.state ?? "libero";
    assignedState = st === "prenotato" ? "libero" : st;   // tenuto per questa prenotazione
  }
  const target = picked ?? (info?.table ? { tableIds: [info.table.id], tableLabel: info.table.label } : info?.combo ? { tableIds: info.combo.tableIds, tableLabel: info.combo.label } : null);
  const targetCap = picked ? null : info?.table?.capacity ?? info?.combo?.capacity ?? null;

  const doSeat = async () => {
    if (!target || busy) return;
    setBusy(true);
    const ok = await seat({ ...target, partySize: p, name: res.guestName, reservationId: res.id, note: res.notes });
    setBusy(false);
    if (ok) { setParty(null); setPicked(null); setChangeTable(false); onClose(); }
  };
  const markNoShow = () => scheduleUndo(`noshow:${res.id}`, `${res.guestName} segnato no-show`, () =>
    api(`/api/reservations/${res.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "status", status: "no_show" } })
      .then(() => qc.invalidateQueries({ queryKey: ["day", rid] })));
  return (
    <Sheet open={!!res} onClose={() => { setParty(null); setPicked(null); setChangeTable(false); onClose(); }}
      title={<span>Check-in · <span className="text-brand">{res.guestName}</span> <span className="text-sm font-medium text-muted">prenotato alle {res.time}</span></span>}>
      <div className="grid gap-4">

        {/* Deviazione: in ritardo */}
        {isLate && (
          <div className="rounded-2xl border-2 border-soon/60 bg-soon/10 p-3.5">
            <p className="flex items-center gap-2 font-bold text-soon"><TriangleAlert className="h-5 w-5" /> In ritardo di {lateMin} min</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {res.guestPhone && (
                <a href={`tel:${res.guestPhone.replace(/\s/g, "")}`} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-raised font-semibold active:scale-[0.97]">
                  <PhoneOutgoing className="h-5 w-5" /> Chiama
                </a>
              )}
              <button onClick={markNoShow} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-over/15 font-semibold text-over active:scale-[0.97]">
                <UserX className="h-5 w-5" /> No-show
              </button>
            </div>
          </div>
        )}
        {isEarly && (
          <div className="rounded-2xl border border-busy/40 bg-busy/10 p-3 text-sm font-semibold text-busy">
            In anticipo di {-lateMin} min: se il tavolo è libero siedi pure.
          </div>
        )}

        {/* Coperti reali */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted">
            Quanti sono davvero? <span className="text-ink">(prenotati {res.partySize})</span>
          </p>
          <PartyGrid value={p} onChange={setParty} />
          {/* Anomalia: più coperti del previsto */}
          {targetCap != null && p > targetCap && (
            <p className="mt-2 rounded-xl bg-over/10 px-3 py-2 text-sm font-semibold text-over">
              In {p} non ci state al tavolo {target?.tableLabel} ({targetCap} posti). Cambia tavolo qui sotto.
            </p>
          )}
          {/* Anomalia: molti meno coperti → libera un tavolo grande */}
          {!picked && info?.table && info.table.capacity >= 6 && p <= info.table.capacity - 3 && (
            <button onClick={() => setChangeTable(true)}
              className="mt-2 flex w-full items-start gap-2 rounded-xl border border-busy/40 bg-busy/10 px-3 py-2.5 text-left text-sm font-semibold text-busy active:scale-[0.98]">
              <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0" />
              Con {p} persone basta un tavolo piccolo: il {info.table.label} ({info.table.capacity} posti) resta libero per un gruppo grande. Spostare?
            </button>
          )}
        </div>

        {/* Tavolo */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted">Tavolo</p>
          {!changeTable && target ? (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-raised p-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface font-display text-lg font-bold">{target.tableLabel}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-tight">Tavolo {target.tableLabel}</p>
                {assignedState && assignedState !== "libero" && (
                  <p className="text-[13px] font-semibold text-soon">Ancora occupato: siedili più tardi o cambia tavolo</p>
                )}
              </div>
              <button onClick={() => setChangeTable(true)} className="rounded-xl border-2 border-line bg-surface px-3 font-semibold text-muted active:scale-95" style={{ minHeight: 48 }}>Cambia</button>
            </div>
          ) : (
            <>
              <SuggestedTables party={p} forReservationId={res.id} onPick={(t) => { setPicked(t); setChangeTable(false); }} />
              {picked && (
                <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-ok"><CheckCircle2 className="h-4 w-4" /> Scelto tavolo {picked.tableLabel}</p>
              )}
            </>
          )}
        </div>

        {res.notes && <p className="rounded-xl bg-raised px-3 py-2 text-sm text-muted">Note: {res.notes}</p>}

        <Btn size="xl" disabled={!target || (targetCap != null && p > targetCap)} onClick={doSeat}>
          <Check className="h-6 w-6" /> Siedi {p} al tavolo {target?.tableLabel ?? "—"}
        </Btn>
        {res.guestPhone && !isLate && (
          <a href={`tel:${res.guestPhone.replace(/\s/g, "")}`} className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-raised font-semibold active:scale-[0.97]">
            <Phone className="h-5 w-5" /> Chiama {res.guestPhone}
          </a>
        )}
      </div>
    </Sheet>
  );
}
