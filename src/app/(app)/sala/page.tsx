"use client";
// VISTA SALA — la schermata vissuta durante il servizio.
// Tutto a un tap: cercare un nome, sedere un walk-in, liberare un tavolo.
import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List as ListIcon, Map as MapIcon, Phone, Receipt, Search, Users, Move } from "lucide-react";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { activeSeatingByTable, liveState } from "@/lib/estimates";
import { nowMin, toMin, todayISO, mmssAgo } from "@/lib/time";
import { TABLE_STATE, fmtCovers } from "@/lib/meta";
import { Chip, Empty, Segmented, SkeletonRows } from "@/components/ui";
import { TableSheet } from "@/components/table-sheet";
import { CheckInSheet } from "@/components/checkin-sheet";
import { WalkInSheet } from "@/components/seat-flow";
import { usePending } from "@/components/toast";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import type { Reservation, Seating, TableLiveState, TableT } from "@/lib/types";

export default function SalaPage() {
  const boot = useBootstrap();
  const staff = useSession((s) => s.staff);
  const day = useDay(todayISO());
  const now = useNow(15_000);
  const pending = usePending((s) => s.keys);
  const [view, setView] = useState<"lista" | "mappa">("lista");
  const [q, setQ] = useState("");
  const [tableSel, setTableSel] = useState<TableT | null>(null);
  const [checkIn, setCheckIn] = useState<Reservation | null>(null);
  const [seatWait, setSeatWait] = useState<{ id: string; name: string } | null>(null);
  const [walkIn, setWalkIn] = useState(false);

  const derived = useMemo(() => {
    if (!boot.data || !day.data) return null;
    const byTable = activeSeatingByTable(day.data.seatings);
    const states = new Map<string, TableLiveState>();
    for (const t of boot.data.tables) {
      const st = liveState(t, byTable.get(t.id), now);
      // ottimismo "Libera": mostra subito "da pulire"
      const seat = byTable.get(t.id);
      states.set(t.id, seat && pending.has(`libera:${seat.id}`) ? "da_pulire" : st);
    }
    let freeT = 0, freeC = 0, busyT = 0, busyC = 0;
    for (const t of boot.data.tables) {
      const st = states.get(t.id);
      if (st === "libero") { freeT++; freeC += t.capacity; }
      if (st === "occupato" || st === "in_liberazione" || st === "oltre_tempo") { busyT++; busyC += byTable.get(t.id)?.partySize ?? 0; }
    }
    const waiting = day.data.waitlist.filter((w) => w.status === "in_attesa" || w.status === "avvisato");
    return { byTable, states, freeT, freeC, busyT, busyC, waiting };
  }, [boot.data, day.data, now, pending]);

  if (boot.isLoading || day.isLoading || !boot.data || !derived || !day.data) {
    return <div className="px-4 pt-6"><Header staff={staff?.name} /><SkeletonRows n={5} h={92} /></div>;
  }
  const { settings } = boot.data;
  const nMin = nowMin();
  const upcoming = day.data.reservations
    .filter((r) => r.status === "confermata")
    .filter((r) => { const d = nMin - toMin(r.time); return d <= 75 && d > -90; })
    .sort((a, b) => toMin(a.time) - toMin(b.time));
  const hits = q.trim().length >= 2
    ? day.data.reservations.filter((r) => r.status === "confermata" &&
        (r.guestName.toLowerCase().includes(q.toLowerCase()) || r.guestPhone.replace(/\s/g, "").includes(q.replace(/\s/g, "")))).slice(0, 5)
    : [];
  const waitHits = q.trim().length >= 2
    ? derived.waiting.filter((w) => w.name.toLowerCase().includes(q.toLowerCase())).slice(0, 3) : [];

  return (
    <div className="px-4 pb-4">
      <Header staff={staff?.name} />

      {/* Contatore fisso */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-ok/40 bg-ok/10 px-3 py-2.5 text-center">
          <p className="text-[22px] font-extrabold leading-none text-ok tabular-nums">{derived.freeT} <span className="text-sm font-bold">tavoli</span></p>
          <p className="mt-0.5 text-[13px] font-semibold text-ok">{derived.freeC} coperti liberi</p>
        </div>
        <div className="rounded-2xl border border-busy/40 bg-busy/10 px-3 py-2.5 text-center">
          <p className="text-[22px] font-extrabold leading-none text-busy tabular-nums">{derived.busyT} <span className="text-sm font-bold">tavoli</span></p>
          <p className="mt-0.5 text-[13px] font-semibold text-busy">{derived.busyC} coperti seduti</p>
        </div>
        <Link href="/attesa" className="rounded-2xl border border-soon/40 bg-soon/10 px-3 py-2.5 text-center active:scale-[0.98]">
          <p className="text-[22px] font-extrabold leading-none text-soon tabular-nums">{derived.waiting.length}</p>
          <p className="mt-0.5 text-[13px] font-semibold text-soon">in attesa</p>
        </Link>
      </div>

      {/* Ricerca check-in */}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Check-in: cerca un nome… (es. Ros)"
          className="min-h-[56px] w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-lg font-medium outline-none placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/25" />
      </div>
      {(hits.length > 0 || waitHits.length > 0) && (
        <div className="mt-2 grid gap-2">
          {hits.map((r) => {
            const late = nMin - toMin(r.time) > settings.lateThresholdMinutes;
            return (
              <button key={r.id} onClick={() => { setCheckIn(r); setQ(""); }}
                className={`flex min-h-[60px] items-center gap-3 rounded-2xl border-2 px-4 text-left active:scale-[0.98] ${late ? "border-soon/60 bg-soon/10" : "border-line bg-surface"}`}>
                <span className="font-display text-lg font-bold tabular-nums">{r.time}</span>
                <span className="min-w-0 flex-1 font-bold">{r.guestName} <span className="font-semibold text-muted">· {r.partySize} p.</span>
                  {late && <span className="ml-2 font-bold text-soon">in ritardo</span>}</span>
                <span className="font-bold text-brand">Siedi</span>
              </button>
            );
          })}
          {waitHits.map((w) => (
            <button key={w.id} onClick={() => { setSeatWait({ id: w.id, name: w.name }); setQ(""); }}
              className="flex min-h-[60px] items-center gap-3 rounded-2xl border-2 border-soon/40 bg-soon/10 px-4 text-left active:scale-[0.98]">
              <span className="font-bold">{w.name} <span className="font-semibold text-muted">· {w.partySize} p. · in lista d'attesa</span></span>
              <span className="ml-auto font-bold text-brand">Siedi</span>
            </button>
          ))}
        </div>
      )}

      {/* Walk-in gigante */}
      <button onClick={() => setWalkIn(true)}
        className="mt-3 flex min-h-[72px] w-full items-center justify-center gap-3 rounded-3xl bg-brand text-lg font-extrabold text-on-brand shadow-lg shadow-brand/25 active:scale-[0.98]">
        <Users className="h-7 w-7" /> Walk-in · Quanti siete?
      </button>

      {/* In arrivo */}
      {upcoming.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">In arrivo</p>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {upcoming.map((r) => {
              const late = nMin - toMin(r.time);
              const isLate = late > settings.lateThresholdMinutes;
              return (
                <button key={r.id} onClick={() => setCheckIn(r)}
                  className={`flex min-h-[60px] shrink-0 items-center gap-2.5 rounded-2xl border-2 px-4 active:scale-[0.97] ${isLate ? "border-soon/60 bg-soon/10 animate-pulse" : "border-line bg-surface"}`}>
                  <span className="font-display text-lg font-bold tabular-nums">{r.time}</span>
                  <span className="font-bold">{r.guestName}</span>
                  <span className="font-semibold text-muted">{r.partySize} p.</span>
                  {isLate && <span className="text-xs font-bold text-soon">+{late}′</span>}
                  {r.guestPhone && <Phone className="h-4 w-4 text-muted" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Toggle lista/mappa */}
      <div className="mt-4">
        <Segmented value={view} onChange={setView} options={[
          { value: "lista", label: "Lista", icon: <ListIcon className="h-5 w-5" /> },
          { value: "mappa", label: "Mappa", icon: <MapIcon className="h-5 w-5" /> },
        ]} />
      </div>

      {view === "lista" ? (
        <ListView rooms={boot.data.rooms} tables={boot.data.tables} states={derived.states} byTable={derived.byTable} now={now} onPick={setTableSel} />
      ) : (
        <MapView boot={boot.data} states={derived.states} byTable={derived.byTable} now={now} onPick={setTableSel} />
      )}

      <TableSheet table={tableSel} onClose={() => setTableSel(null)} />
      <CheckInSheet res={checkIn} onClose={() => setCheckIn(null)} />
      <WalkInSheet open={walkIn || !!seatWait} onClose={() => { setWalkIn(false); setSeatWait(null); }}
        defaultName={seatWait?.name} waitlistId={seatWait?.id} />
    </div>
  );
}

function Header({ staff }: { staff?: string }) {
  return (
    <header className="flex items-end justify-between pt-[calc(env(safe-area-inset-top)+14px)]">
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-brand">Coperto</p>
        <h1 className="font-display text-[28px] font-bold leading-tight">Sala · stasera</h1>
      </div>
      <p className="pb-1 pr-16 text-sm font-semibold text-muted">{staff}</p>
    </header>
  );
}

function stateOf(seat: Seating | undefined, st: TableLiveState, now: number) {
  if (!seat) return null;
  const mins = mmssAgo(seat.seatedAt, now);
  return (
    <>
      <p className="truncate text-sm font-bold">{seat.name || "Walk-in"} · {seat.partySize} p.</p>
      <p className={`text-[13px] font-semibold tabular-nums ${st === "oltre_tempo" ? "text-over" : st === "in_liberazione" ? "text-soon" : "text-muted"}`}>
        {mins}′ {st === "oltre_tempo" ? "oltre" : <>(libera {new Date(seat.expectedEndAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })})</>}
      </p>
    </>
  );
}

function ListView({ rooms, tables, states, byTable, now, onPick }: {
  rooms: { id: string; name: string }[]; tables: TableT[];
  states: Map<string, TableLiveState>; byTable: Map<string, Seating>; now: number;
  onPick: (t: TableT) => void;
}) {
  return (
    <div className="mt-4 space-y-5">
      {rooms.map((room) => {
        const ts = tables.filter((t) => t.roomId === room.id);
        if (!ts.length) return null;
        const free = ts.filter((t) => states.get(t.id) === "libero").length;
        return (
          <section key={room.id}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[15px] font-bold uppercase tracking-wide text-muted">{room.name}</h2>
              <p className="text-[13px] font-semibold text-muted">{free}/{ts.length} liberi</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {ts.map((t) => {
                const st = states.get(t.id)!;
                const seat = byTable.get(t.id);
                const meta = TABLE_STATE[st];
                return (
                  <button key={t.id} onClick={() => onPick(t)}
                    className={`relative flex min-h-[96px] flex-col justify-between rounded-2xl border-2 bg-surface p-3 text-left transition-transform active:scale-[0.97] ${meta.card}`}>
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-display text-[26px] font-extrabold leading-none">{t.label}</span>
                      <span className="flex items-center gap-1.5">
                        {seat?.billRequested && <Receipt className="h-4 w-4 text-soon" />}
                        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot} ${st === "occupato" || st === "in_liberazione" ? "live-pulse" : ""}`} />
                      </span>
                    </div>
                    {seat ? stateOf(seat, st, now) : (
                      <p className={`text-[13px] font-bold ${meta.text}`}>{meta.label} · {fmtCovers(t.capacity)}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MapView({ boot, states, byTable, now, onPick }: {
  boot: any; states: Map<string, TableLiveState>; byTable: Map<string, Seating>; now: number;
  onPick: (t: TableT) => void;
}) {
  const [roomId, setRoomId] = useState<string>(boot.rooms[0]?.id);
  const [edit, setEdit] = useState(false);
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const qc = useQueryClient();
  const ts = boot.tables.filter((t: TableT) => t.roomId === roomId);

  const drag = (e: React.PointerEvent, t: TableT) => {
    if (!edit) return;
    const wrap = (e.currentTarget.closest("[data-map]") as HTMLElement)!;
    const rect = wrap.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const x = Math.min(94, Math.max(6, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(90, Math.max(8, ((ev.clientY - rect.top) / rect.height) * 100));
      const el = e.currentTarget as HTMLElement;
      el.style.left = `${x}%`; el.style.top = `${y}%`;
      (el as any)._x = x; (el as any)._y = y;
    };
    const up = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const el = e.currentTarget as any;
      if (typeof el._x === "number") {
        await api(`/api/tables/${t.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "position", x: el._x, y: el._y } });
        qc.invalidateQueries({ queryKey: ["bootstrap", rid] });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="mt-4">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {boot.rooms.map((r: any) => (
          <button key={r.id} onClick={() => setRoomId(r.id)}
            className={`min-h-[48px] shrink-0 rounded-2xl px-4 font-semibold active:scale-95 ${roomId === r.id ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}>
            {r.name}
          </button>
        ))}
        <button onClick={() => setEdit((v) => !v)}
          className={`ml-auto flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl px-4 font-semibold active:scale-95 ${edit ? "bg-soon text-white" : "bg-raised text-muted"}`}>
          <Move className="h-4 w-4" /> {edit ? "Fine" : "Modifica mappa"}
        </button>
      </div>
      <div data-map className="relative mt-3 h-[380px] touch-none overflow-hidden rounded-3xl border border-line bg-raised/50">
        {edit && <p className="absolute left-3 top-3 z-10 rounded-xl bg-surface px-3 py-1.5 text-[13px] font-bold text-soon shadow">Trascina i tavoli per sistemare la mappa</p>}
        {ts.map((t: TableT) => {
          const st = states.get(t.id)!;
          const seat = byTable.get(t.id);
          const meta = TABLE_STATE[st];
          const size = t.capacity <= 2 ? 62 : t.capacity <= 4 ? 74 : t.capacity <= 6 ? 86 : 108;
          return (
            <button key={t.id} onPointerDown={(e) => drag(e, t)} onClick={() => !edit && onPick(t)}
              className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border-2 bg-surface font-display font-extrabold shadow-sm transition-transform active:scale-95 ${meta.card} ${edit ? "border-dashed !border-soon" : ""}`}
              style={{ left: `${t.x}%`, top: `${t.y}%`, width: size, height: size, fontSize: t.capacity <= 2 ? 20 : 24, touchAction: "none" }}>
              <span className="text-center leading-none">
                {t.label}
                <span className={`mx-auto mt-1 block h-2 w-2 rounded-full ${meta.dot}`} />
                {seat && <span className="mt-0.5 block font-sans text-[11px] font-bold text-muted tabular-nums">{seat.partySize}p</span>}
              </span>
            </button>
          );
        })}
        {!ts.length && <Empty icon={<LayoutGrid className="h-6 w-6" />} title="Nessun tavolo in questa sala" />}
      </div>
    </div>
  );
}
