"use client";
// IL PIANO — la timeline che uccide la lista cartacea.
// Asse verticale = tempo (slot configurabili), colonne = tavoli + accorpamenti.
// Drag & drop, conflitti evidenziati, Auto-sistema con motivazioni spiegate.
import { useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ListPlus, Printer, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useBootstrap, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { durationFor, freeTargetsAt, periodFor } from "@/lib/estimates";
import { overlaps, toHHMM, toMin, todayISO } from "@/lib/time";
import { Btn, Sheet } from "@/components/ui";
import { toast } from "@/components/toast";
import type { AssignPlan } from "@/lib/autoassign";
import type { Bootstrap, DayData, Reservation } from "@/lib/types";

const ROW_H = 26;
const colKey = (kind: "table" | "combo", id: string | null) => (id ? `${kind}:${id}` : null);

export function Piano({ date, day, onTap }: { date: string; day: DayData; onTap: (r: Reservation) => void }) {
  const boot = useBootstrap();
  const me = useSession((s) => s.staff?.name) ?? "";
  const rid = useSession((s) => s.staff?.restaurantId);
  const qc = useQueryClient();
  const isToday = date === todayISO();
  const nMin = useNow(30_000);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [dragRes, setDragRes] = useState<Reservation | null>(null);
  const [assignRes, setAssignRes] = useState<Reservation | null>(null);
  const [plan, setPlan] = useState<AssignPlan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const justDragged = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  if (!boot.data) return <div className="skeleton mt-3 h-72 rounded-3xl" />;
  const bootData: Bootstrap = boot.data;
  // Senza turni configurati la timeline non ha assi: meglio dirlo che crashare.
  if (!bootData.periods.length) {
    return (
      <div className="mt-4 rounded-3xl border border-dashed border-line px-6 py-10 text-center">
        <p className="font-bold">Nessun turno configurato</p>
        <p className="mt-1 text-sm text-muted">Il Piano ha bisogno degli orari di pranzo e cena. Impostali in Altro → Impostazioni.</p>
      </div>
    );
  }
  const period = bootData.periods.find((p) => p.id === periodId) ?? bootData.periods[0];
  const { settings } = bootData;
  const startMin = toMin(period.startTime);
  const slotCount = Math.ceil((toMin(period.endTime) - startMin) / settings.slotMinutes);

  const confermate = day.reservations.filter((r) => r.status === "confermata" || r.status === "seduta");
  const inPeriod = confermate.filter((r) => {
    const t = toMin(r.time);
    return t + durationFor(r.partySize, period.name, settings) > startMin && t < toMin(period.endTime) + 60;
  });
  const unassigned = inPeriod.filter((r) => r.status === "confermata" && !r.assignedTableId && !r.assignedComboId);
  const assigned = inPeriod.filter((r) => r.assignedTableId || r.assignedComboId);
  const blocksByCol = new Map<string, Reservation[]>();
  for (const r of assigned) {
    const key = r.assignedTableId ? colKey("table", r.assignedTableId) : colKey("combo", r.assignedComboId);
    if (key) { const a = blocksByCol.get(key) ?? []; a.push(r); blocksByCol.set(key, a); }
  }

  // Overbooking: coperti per fascia vs capienza totale (soglia configurabile)
  const totalCap = bootData.tables.filter((t) => t.state !== "fuori_servizio").reduce((a, t) => a + t.capacity, 0);
  const slotLoad = new Map<number, number>();
  for (const r of day.reservations.filter((x) => x.status === "confermata" || x.status === "seduta")) {
    const s = Math.floor(toMin(r.time) / settings.slotMinutes) * settings.slotMinutes;
    slotLoad.set(s, (slotLoad.get(s) ?? 0) + r.partySize);
  }
  const pct = (totalCap * settings.overbookingPct) / 100;
  const overSlots = [...slotLoad.entries()].filter(([s, c]) => c >= pct && s >= startMin && s <= toMin(period.endTime));
  const isOver = (m: number) => (slotLoad.get(Math.floor(m / settings.slotMinutes) * settings.slotMinutes) ?? 0) >= pct;

  // Conflitti: due prenotazioni sullo stesso tavolo con intervalli (durata+buffer) sovrapposti
  const conflicts = (() => {
    const perTable = new Map<string, { id: string; a: number; b: number }[]>();
    for (const r of assigned) {
      const a = toMin(r.time), b = a + durationFor(r.partySize, period.name, settings) + settings.bufferMinutes;
      const ids = r.assignedTableId ? [r.assignedTableId] : bootData.combos.find((c) => c.id === r.assignedComboId)?.tableIds ?? [];
      for (const tid of ids) { const arr = perTable.get(tid) ?? []; arr.push({ id: r.id, a, b }); perTable.set(tid, arr); }
    }
    const bad = new Set<string>();
    for (const arr of perTable.values())
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++)
          if (overlaps(arr[i].a, arr[i].b, arr[j].a, arr[j].b)) { bad.add(arr[i].id); bad.add(arr[j].id); }
    return bad;
  })();

  const patchAssign = async (res: Reservation, patch: { tableId: string | null; comboId: string | null; time?: string; label?: string }) => {
    try {
      await api(`/api/reservations/${res.id}`, {
        method: "PATCH",
        body: { restaurantId: rid, staffName: me, action: "assign", tableId: patch.tableId, comboId: patch.comboId, time: patch.time, label: patch.label },
      });
      await qc.invalidateQueries({ queryKey: ["day", rid, date] });
    } catch (e: any) { toast({ title: e.message, tone: "err" }); }
  };

  const onDragStart = (e: DragStartEvent) => setDragRes(e.active.data.current?.res ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    justDragged.current = true;
    queueMicrotask(() => { justDragged.current = false; });
    setDragRes(null);
    const res = e.active.data.current?.res as Reservation | undefined;
    if (!res || !e.over) return;
    if (String(e.over.id) === "rail") {
      if (res.assignedTableId || res.assignedComboId) patchAssign(res, { tableId: null, comboId: null });
      return;
    }
    const [kind, id] = String(e.over.id).split(":");
    const overRect = e.over.rect;
    const translated = e.active.rect.current.translated;
    const top = translated ? translated.top - overRect.top : 0;
    const dur = durationFor(res.partySize, period.name, settings);
    const maxIdx = Math.max(0, Math.round((toMin(period.endTime) - startMin - dur) / settings.slotMinutes));
    const idx = Math.min(maxIdx, Math.max(0, Math.round(top / ROW_H)));
    const newTime = toHHMM(startMin + idx * settings.slotMinutes);
    const samePlace = (kind === "table" && res.assignedTableId === id) || (kind === "combo" && res.assignedComboId === id);
    if (samePlace && newTime === res.time) return;
    const label = kind === "table" ? bootData.tables.find((t) => t.id === id)?.label : bootData.combos.find((c) => c.id === id)?.label;
    patchAssign(res, { tableId: kind === "table" ? id : null, comboId: kind === "combo" ? id : null, time: newTime, label });
  };

  const runAuto = async () => {
    setPlanBusy(true); setPlanOpen(true); setPlan(null);
    try {
      const p = await api<AssignPlan>("/api/autoassign", { method: "POST", body: { action: "preview", restaurantId: rid, date, periodId: period.id, staffName: me } });
      setPlan(p);
    } catch (e: any) { toast({ title: e.message, tone: "err" }); setPlanOpen(false); }
    setPlanBusy(false);
  };
  const applyPlan = async () => {
    if (!plan) return;
    setPlanBusy(true);
    try {
      const proposals = plan.proposals.map((p) => ({ reservationId: p.reservationId, kind: p.target.kind, id2: p.target.kind === "table" ? p.target.table.id : p.target.combo.id }));
      await api("/api/autoassign", { method: "POST", body: { action: "apply", restaurantId: rid, date, periodId: period.id, staffName: me, proposals } });
      await qc.invalidateQueries({ queryKey: ["day", rid, date] });
      toast({ title: `${proposals.length} prenotazioni sistemate`, msg: "Il manuale ha sempre la priorità: sposta pure a mano.", tone: "ok" });
      setPlanOpen(false); setPlan(null);
    } catch (e: any) { toast({ title: e.message, tone: "err" }); }
    setPlanBusy(false);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          {bootData.periods.map((p) => (
            <button key={p.id} onClick={() => setPeriodId(p.id)}
              className={`min-h-[48px] rounded-2xl px-4 font-semibold active:scale-95 ${p.id === period.id ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}>
              {p.name} <span className="text-sm opacity-70">{p.startTime}–{p.endTime}</span>
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <button onClick={() => window.print()} className="flex min-h-[48px] items-center gap-2 rounded-2xl bg-raised px-4 font-semibold text-muted active:scale-95 no-print">
              <Printer className="h-4 w-4" /> Stampa
            </button>
            <button onClick={runAuto} disabled={!unassigned.length}
              className="flex min-h-[48px] items-center gap-2 rounded-2xl bg-ink px-4 font-bold text-bg active:scale-95 disabled:opacity-40 no-print">
              <Zap className="h-4 w-4 text-soon" /> Auto-sistema {unassigned.length > 0 && <span className="rounded-full bg-soon px-1.5 text-xs text-ink">{unassigned.length}</span>}
            </button>
          </div>
        </div>

        {overSlots.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {overSlots.sort((a, b) => a[0] - b[0]).map(([s, c]) => (
              <span key={s} className="rounded-full border border-soon/50 bg-soon/10 px-2.5 py-1 text-xs font-bold text-soon">{toHHMM(s)}: {c}/{totalCap} coperti</span>
            ))}
          </div>
        )}

        <Rail count={unassigned.length}>
          {unassigned.map((r) => (
            <RailChip key={r.id} res={r} lateMin={isToday ? nMin - toMin(r.time) : 0} lateThr={settings.lateThresholdMinutes}
              onTap={() => { if (!justDragged.current) setAssignRes(r); }} />
          ))}
          {!unassigned.length && <p className="px-2 py-3 text-sm font-semibold text-ok">Tutto sistemato per il {period.name.toLowerCase()}.</p>}
        </Rail>

        {bootData.rooms.map((room) => {
          const cols = [
            ...bootData.tables.filter((t) => t.roomId === room.id).map((t) => ({ kind: "table" as const, id: t.id, label: t.label, cap: t.capacity, oos: t.state === "fuori_servizio" })),
            ...bootData.combos.filter((c) => c.roomId === room.id).map((c) => ({ kind: "combo" as const, id: c.id, label: c.label, cap: c.capacity, oos: false })),
          ];
          if (!cols.length) return null;
          return (
            <section key={room.id} className="mt-5">
              <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-muted">{room.name}</p>
              <div className="flex overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="w-[46px] shrink-0 border-r border-line">
                  <div className="h-[44px] border-b border-line" />
                  {Array.from({ length: slotCount }).map((_, i) => {
                    const m = startMin + i * settings.slotMinutes;
                    return (
                      <div key={i} style={{ height: ROW_H }}
                        className={`pr-1 text-right text-[11px] font-bold leading-none tabular-nums ${m % 60 === 0 ? "pt-1.5" : m % 30 === 0 ? "pt-1.5 opacity-60 text-[10px]" : ""} ${isOver(m) ? "bg-soon/15 text-soon" : "text-muted"}`}>
                        {m % 60 === 0 ? toHHMM(m) : m % 30 === 0 ? toHHMM(m) : ""}
                      </div>
                    );
                  })}
                </div>
                <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(44px,1fr))` }}>
                  {cols.map((c) => {
                    const key = colKey(c.kind, c.id)!;
                    return (
                      <Column key={key} k={key} label={c.label} cap={c.cap} oos={c.oos} height={slotCount * ROW_H} rows={slotCount}>
                        {(blocksByCol.get(key) ?? []).map((r) => (
                          <Block key={r.id} res={r} boot={bootData} periodStart={startMin} periodName={period.name}
                            conflict={conflicts.has(r.id)}
                            late={isToday && r.status === "confermata" && nMin - toMin(r.time) > settings.lateThresholdMinutes}
                            seated={r.status === "seduta"}
                            onTap={() => { if (!justDragged.current) onTap(r); }} />
                        ))}
                      </Column>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragRes && (
          <div className="rounded-xl border-2 border-brand bg-brand px-3 py-2 font-bold text-on-brand shadow-2xl">{dragRes.guestName} · {dragRes.partySize}p · {dragRes.time}</div>
        )}
      </DragOverlay>

      <AssignSheet res={assignRes} date={date} onClose={() => setAssignRes(null)} />

      <Sheet open={planOpen} onClose={() => { setPlanOpen(false); setPlan(null); }} wide
        title={<span className="flex items-center gap-2"><Zap className="h-5 w-5 text-soon" /> Auto-sistema · proposta ({period.name})</span>}>
        {planBusy && !plan && <div className="skeleton h-40 rounded-2xl" />}
        {plan && (
          <div className="grid gap-2.5">
            <p className="text-sm font-semibold text-muted">L&apos;algoritmo propone, tu decidi. Gruppi grandi nei tavoli grandi, {settings.bufferMinutes}′ di riassetto tra un turno e l&apos;altro.</p>
            {plan.proposals.map((p) => (
              <div key={p.reservationId} className="flex items-start gap-3 rounded-2xl border border-ok/40 bg-ok/10 p-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
                <div>
                  <p className="font-bold">{p.name} · {p.partySize} p. · {p.time} → {p.target.kind === "table" ? `Tavolo ${p.target.table.label}` : `Accorpati ${p.target.combo.label}`}</p>
                  <p className="text-[13px] font-medium text-muted">{p.reason}</p>
                </div>
              </div>
            ))}
            {plan.skipped.map((sk) => (
              <div key={sk.reservationId} className="flex items-start gap-3 rounded-2xl border border-soon/40 bg-soon/10 p-3">
                <ListPlus className="mt-0.5 h-5 w-5 shrink-0 text-soon" />
                <div>
                  <p className="font-bold">{sk.name} · {sk.partySize} p. · {sk.time} → da fare a mano</p>
                  <p className="text-[13px] font-medium text-muted">{sk.reason}</p>
                </div>
              </div>
            ))}
            {!plan.proposals.length && !plan.skipped.length && <p className="font-semibold text-ok">Nulla da sistemare: è già tutto assegnato.</p>}
            {plan.proposals.length > 0 && (
              <Btn size="xl" disabled={planBusy} onClick={applyPlan}><Check className="h-6 w-6" /> Applico {plan.proposals.length} assegnazioni?</Btn>
            )}
            <Btn variant="ghost" onClick={() => { setPlanOpen(false); setPlan(null); }}>No, lascio com&apos;è</Btn>
          </div>
        )}
      </Sheet>
    </DndContext>
  );
}

function Rail({ children, count }: { children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: "rail" });
  return (
    <div ref={setNodeRef} className={`mt-3 rounded-2xl border-2 border-dashed p-2 transition-colors ${isOver ? "border-brand bg-brand/5" : "border-soon/50"}`}>
      <p className="px-2 pt-1 text-[12px] font-bold uppercase tracking-wide text-soon">Da sistemare {count > 0 && `(${count})`} · trascina sul piano o tocca per assegnare</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto p-1">{children}</div>
    </div>
  );
}

function RailChip({ res, onTap, lateMin, lateThr }: { res: Reservation; onTap: () => void; lateMin: number; lateThr: number }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `rail-${res.id}`, data: { res } });
  const late = lateMin > lateThr;
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} onClick={onTap}
      style={{ touchAction: "none", opacity: isDragging ? 0.3 : 1 }}
      className={`flex min-h-[56px] shrink-0 items-center gap-2 rounded-xl border-2 px-3 active:scale-[0.97] ${late ? "border-soon bg-soon/15" : "border-line bg-surface"}`}>
      <span className="font-display font-bold tabular-nums">{res.time}</span>
      <span className="font-bold">{res.guestName}</span>
      <span className="rounded-full bg-raised px-2 py-0.5 text-[13px] font-bold">{res.partySize}p</span>
    </button>
  );
}

function Column({ k, label, cap, oos, height, rows, children }: {
  k: string; label: string; cap: number; oos: boolean; height: number; rows: number; children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: k });
  return (
    <div className={`border-r border-line last:border-r-0 ${oos ? "bg-raised/50" : ""}`}>
      <div className={`flex h-[44px] flex-col items-center justify-center border-b border-line ${oos ? "opacity-40" : ""}`}>
        <p className="text-[15px] font-extrabold leading-none">{label}</p>
        <p className="mt-0.5 text-[11px] font-semibold text-muted">{cap}p{oos ? " · F.S." : ""}</p>
      </div>
      <div ref={setNodeRef} className={`relative ${isOver ? "bg-brand/10" : ""}`} style={{ height }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ height: ROW_H }} className={`border-b ${i % 4 === 3 ? "border-line" : "border-line/50"}`} />
        ))}
        {children}
      </div>
    </div>
  );
}

function Block({ res, boot, periodStart, periodName, conflict, late, seated, onTap }: {
  res: Reservation; boot: Bootstrap; periodStart: number; periodName: string;
  conflict: boolean; late: boolean; seated: boolean; onTap: () => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `block-${res.id}`, data: { res } });
  const dur = durationFor(res.partySize, periodName, boot.settings);
  const top = Math.max(0, ((toMin(res.time) - periodStart) / boot.settings.slotMinutes) * ROW_H);
  const height = Math.max(ROW_H * 2 - 4, (dur / boot.settings.slotMinutes) * ROW_H - 4);
  const cls = seated ? "border-ok/60 bg-ok/15"
    : conflict ? "border-over bg-over/15"
    : late ? "border-brand bg-brand/15 live-pulse"
    : "border-busy/60 bg-busy/15";
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} onClick={onTap}
      className={`absolute inset-x-0.5 z-10 overflow-hidden rounded-lg border-2 px-1 py-0.5 text-left leading-tight ${cls}`}
      style={{ top, height, touchAction: "none", opacity: isDragging ? 0.25 : 1 }}>
      <span className="block truncate text-[12px] font-bold">{res.guestName}</span>
      <span className="block text-[11px] font-semibold opacity-80">{res.partySize}p · {res.time.slice(0, 5)}{conflict ? " · conflitto" : ""}</span>
    </button>
  );
}

// Assegnazione rapida: tocca una prenotazione "da sistemare", scegli il tavolo.
export function AssignSheet({ res, date, onClose }: { res: Reservation | null; date: string; onClose: () => void }) {
  const boot = useBootstrap();
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const qc = useQueryClient();
  const day = { resId: res?.id }; // placeholder riferimento
  void day;
  const reservations = useQueryClient().getQueryData<DayData>(["day", rid, date])?.reservations ?? [];
  if (!res || !boot.data) return null;
  const b = boot.data;
  const period = periodFor(toMin(res.time), b.periods);
  const dur = durationFor(res.partySize, period?.name ?? null, b.settings);
  const { tables, combos } = freeTargetsAt({
    timeMin: toMin(res.time), party: res.partySize, dur, buf: b.settings.bufferMinutes,
    tables: b.tables, combos: b.combos,
    assigned: reservations.filter((r) => r.id !== res.id && (r.status === "confermata" || r.status === "seduta") && (r.assignedTableId || r.assignedComboId)),
    durFor: (p) => durationFor(p, period?.name ?? null, b.settings),
  });
  const opts = [
    ...tables.map((t) => ({ label: `Tavolo ${t.label}`, sub: `${t.capacity} posti · ${b.rooms.find((r2) => r2.id === t.roomId)?.name}`, id: t.id, kind: "table" as const })),
    ...combos.map((c) => ({ label: `Accorpati ${c.label}`, sub: `${c.capacity} posti · ${b.rooms.find((r2) => r2.id === c.roomId)?.name}`, id: c.id, kind: "combo" as const })),
  ].sort((x, y) => Number(x.sub) - Number(y.sub));

  const pick = async (o: (typeof opts)[number]) => {
    await api(`/api/reservations/${res.id}`, {
      method: "PATCH",
      body: { restaurantId: rid, staffName: me, action: "assign", tableId: o.kind === "table" ? o.id : null, comboId: o.kind === "combo" ? o.id : null, label: o.label.replace("Tavolo ", "") },
    });
    await qc.invalidateQueries({ queryKey: ["day", rid, date] });
    onClose();
  };

  return (
    <Sheet open={!!res} onClose={onClose} title={<span>Sistema <span className="text-brand">{res.guestName}</span> · {res.partySize} p. alle {res.time} · occupa ~{dur}′</span>}>
      {opts.length ? (
        <div className="grid gap-2">
          {opts.map((o) => (
            <button key={o.id} onClick={() => pick(o)}
              className="flex min-h-[60px] items-center gap-3 rounded-2xl border-2 border-ok/40 bg-ok/10 px-4 text-left active:scale-[0.98]">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-ok font-display text-sm font-bold text-white">{o.label.replace("Tavolo ", "").replace("Accorpati ", "")}</span>
              <span className="flex-1 font-bold">{o.label}<span className="block text-[13px] font-medium text-muted">{o.sub}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-soon/50 bg-soon/10 p-4 text-center font-semibold text-soon">
          Nessun tavolo libero per {res.partySize} persone alle {res.time}. Sposta l&apos;orario o valuta un accorpamento già occupato.
        </p>
      )}
    </Sheet>
  );
}
