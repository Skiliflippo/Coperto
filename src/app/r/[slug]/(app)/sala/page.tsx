"use client";
// VISTA SALA — la schermata vissuta durante il servizio.
// Massimo spazio alla mappa: intestazione ridotta a data/ora, toggle a icona.
import { useMemo, useState } from "react";
import { List as ListIcon, Map as MapIcon, Phone, Users } from "lucide-react";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { computeTableStatuses, type TableStatus } from "@/lib/estimates";
import { nowMin, toMin, todayISO } from "@/lib/time";
import { TABLE_STATE } from "@/lib/meta";
import { SkeletonRows } from "@/components/ui";
import { TableSheet } from "@/components/table-sheet";
import { CheckInSheet } from "@/components/checkin-sheet";
import { WalkInSheet } from "@/components/seat-flow";
import { FloorView } from "@/components/floor-view";
import { useSplitMergePrompt } from "@/lib/use-split-prompt";
import { StatusBar, type Tally } from "@/components/status-bar";
import { RoomTabs, useActiveRoom } from "@/components/room-tabs";
import type { Reservation, TableT } from "@/lib/types";

export default function SalaPage() {
  const boot = useBootstrap();
  const staff = useSession((s) => s.staff);
  const day = useDay(todayISO());
  const now = useNow(15_000);
  const [view, setView] = useState<"mappa" | "lista">("mappa");
  const [tableSel, setTableSel] = useState<TableT | null>(null);
  const [checkIn, setCheckIn] = useState<Reservation | null>(null);
  const [walkIn, setWalkIn] = useState(false);

  const derived = useMemo(() => {
    if (!boot.data || !day.data) return null;
    const statuses = computeTableStatuses({
      tables: boot.data.tables, combos: boot.data.combos,
      seatings: day.data.seatings, reservations: day.data.reservations,
      settings: boot.data.settings, nowMs: now, nowMinOfDay: nowMin(),
    });
    let freeT = 0, freeC = 0, busyT = 0, busyC = 0, overT = 0, heldT = 0;
    for (const t of boot.data.tables) {
      const st = statuses.get(t.id);
      if (!st) continue;
      if (st.state === "libero") { freeT++; freeC += t.capacity; }
      if (st.state === "prenotato") heldT++;
      if (st.state === "occupato" || st.state === "oltre_tempo") { busyT++; busyC += st.seating?.partySize ?? 0; }
      if (st.state === "oltre_tempo") overT++;
    }
    return { statuses, freeT, freeC, busyT, busyC, overT, heldT };
  }, [boot.data, day.data, now]);

  // Quando l'ultima parte di un tavolo staccato si libera, propone di riunirlo.
  useSplitMergePrompt({
    tables: boot.data?.tables ?? [],
    statuses: derived?.statuses ?? new Map(),
    enabled: !!derived,
  });

  if (boot.isLoading || day.isLoading || !boot.data || !derived || !day.data) {
    return <div className="px-3 pt-6"><Clock now={now} /><div className="mt-3"><SkeletonRows n={4} h={92} /></div></div>;
  }
  const { settings } = boot.data;
  const nMin = nowMin();
  const upcoming = day.data.reservations
    .filter((r) => r.status === "confermata")
    .filter((r) => { const d = nMin - toMin(r.time); return d <= 75 && d > -90; })
    .sort((a, b) => toMin(a.time) - toMin(b.time));

  return (
    // Colonna a tutta altezza: la mappa prende tutto lo spazio che avanza,
    // così sotto non resta la fascia vuota che c'era con un'altezza fissa.
    <div className="flex h-[calc(100dvh-72px-env(safe-area-inset-bottom))] flex-col px-3 pb-1">
      <Clock now={now} staff={staff?.name} />

      {/* Walk-in */}
      <button onClick={() => setWalkIn(true)}
        className="mt-2 flex min-h-[64px] w-full items-center justify-center gap-3 rounded-3xl bg-brand text-lg font-extrabold text-on-brand shadow-lg shadow-brand/25 active:scale-[0.98]">
        <Users className="h-6 w-6" /> Quanti siete?
      </button>

      {/* In arrivo */}
      {upcoming.length > 0 && (
        <div className="no-scrollbar -mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
          {upcoming.map((r) => {
            const late = nMin - toMin(r.time);
            const isLate = late > settings.lateThresholdMinutes;
            return (
              <button key={r.id} onClick={() => setCheckIn(r)}
                className={`flex min-h-[56px] shrink-0 items-center gap-2.5 rounded-2xl border-2 px-3.5 active:scale-[0.97] ${isLate ? "border-soon/60 bg-soon/10" : "border-line bg-surface"}`}>
                <span className="font-display text-[17px] font-bold tabular-nums">{r.time}</span>
                <span className="font-bold">{r.guestName}</span>
                <span className="text-sm font-semibold text-muted">{r.partySize}p</span>
                {isLate && <span className="text-xs font-bold text-soon">+{late}′</span>}
                {r.guestPhone && <Phone className="h-3.5 w-3.5 text-muted" />}
              </button>
            );
          })}
        </div>
      )}

      {view === "mappa" ? (
        <FloorView boot={boot.data} statuses={derived.statuses} onPick={setTableSel}
          viewToggle={<ViewToggle view={view} setView={setView} />} />
      ) : (
        <ListView boot={boot.data} statuses={derived.statuses} onPick={setTableSel} counts={derived}
          viewToggle={<ViewToggle view={view} setView={setView} />} />
      )}

      <TableSheet table={tableSel} onClose={() => setTableSel(null)} />
      <CheckInSheet res={checkIn} onClose={() => setCheckIn(null)} />
      <WalkInSheet open={walkIn} onClose={() => setWalkIn(false)} />
    </div>
  );
}

// Intestazione minima: giorno, ora viva e chi è in turno. Niente titoli decorativi.
function Clock({ now, staff }: { now: number; staff?: string }) {
  const d = new Date(now);
  return (
    <header className="flex items-baseline gap-2 pt-[calc(env(safe-area-inset-top)+10px)]">
      <span className="font-display text-[22px] font-extrabold leading-none tabular-nums">
        {d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="text-[13px] font-semibold capitalize text-muted">
        {d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "short" })}
      </span>
      {staff && <span className="ml-auto pr-16 text-[13px] font-semibold text-muted">{staff}</span>}
    </header>
  );
}

// Toggle mappa/lista: una sola icona, quella della vista in cui puoi passare.
export function ViewToggle({ view, setView }: { view: "mappa" | "lista"; setView: (v: "mappa" | "lista") => void }) {
  const next = view === "mappa" ? "lista" : "mappa";
  return (
    <button onClick={() => setView(next)} aria-label={`Passa alla vista ${next}`} title={`Vista ${next}`}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-raised text-muted active:scale-95">
      {view === "mappa" ? <ListIcon className="h-5 w-5" /> : <MapIcon className="h-5 w-5" />}
    </button>
  );
}

function ListView({ boot, statuses, onPick, viewToggle, counts }: {
  boot: NonNullable<ReturnType<typeof useBootstrap>["data"]>;
  statuses: Map<string, TableStatus>;
  onPick: (t: TableT) => void;
  viewToggle: React.ReactNode;
  counts: Tally;
}) {
  const [roomId, setRoomId] = useActiveRoom(boot.rooms);
  const tables = boot.tables.filter((t) => t.roomId === roomId);
  return (
    <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
      <RoomTabs rooms={boot.rooms} active={roomId} onPick={setRoomId} right={viewToggle} />
      <div className="mt-1.5"><StatusBar counts={counts} /></div>
      <div className="no-scrollbar mt-2.5 grid min-h-0 flex-1 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
        {tables.map((t) => {
          const st = statuses.get(t.id);
          const meta = TABLE_STATE[st?.state ?? "libero"];
          return (
            <button key={t.id} onClick={() => onPick(t)}
              className={`flex h-[62px] flex-col justify-between rounded-xl border bg-surface px-2 py-1.5 text-left active:scale-[0.97] ${meta.card}`}>
              <span className="flex items-start justify-between gap-1">
                <span className="font-display text-[17px] font-extrabold leading-none">{t.label}</span>
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              </span>
              {st?.seating ? (
                <span className="block leading-tight">
                  <span className="block truncate text-[11px] font-bold">{st.seating.name || "Walk-in"}</span>
                  <span className={`block text-[10px] font-semibold tabular-nums ${st.state === "oltre_tempo" ? "text-over" : "text-muted"}`}>
                    {st.seating.partySize}p · {st.minutesSeated}′
                  </span>
                </span>
              ) : st?.state === "prenotato" ? (
                <span className="block truncate text-[10px] font-bold leading-tight text-soon">
                  {st.reservation?.time} {st.reservation?.guestName}
                </span>
              ) : (
                <span className={`block text-[10px] font-bold leading-tight ${meta.text}`}>{meta.label} · {t.capacity}p</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
