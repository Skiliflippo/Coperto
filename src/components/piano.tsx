"use client";
// IL PIANO — la timeline che uccide la lista cartacea.
// Asse verticale = tempo (slot configurabili), colonne = tavoli + accorpamenti.
// Drag & drop, conflitti evidenziati, Auto-sistema con motivazioni spiegate.
import { useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ListPlus, Printer, Scissors, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useBootstrap, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { durationFor, freeTargetsAt, periodFor } from "@/lib/estimates";
import { overlaps, toHHMM, toMin, todayISO } from "@/lib/time";
import { Btn, Sheet } from "@/components/ui";
import { toast } from "@/components/toast";
import { findJoinProposals } from "@/lib/join";
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
  // anteprima stile calendario: mostra in quale colonna e su quali slot finirebbe
  const [preview, setPreview] = useState<{ col: string; top: number; height: number; time: string } | null>(null);
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
  // I gruppi che non entrano in nessun tavolo singolo sono i più difficili da
  // sistemare: vanno in cima al rail, con un segnale esplicito.
  const biggestTable = Math.max(0, ...bootData.tables.map((t) => Math.max(t.capacity, t.maxCapacity || 0)));
  const biggestCombo = Math.max(0, ...bootData.combos.map((c) => c.capacity));
  const needsJoin = (r: Reservation) => r.partySize > Math.max(biggestTable, biggestCombo);
  // Capienza totale della sala: oltre questa soglia nessun accorpamento salva la serata.
  const roomSeats = bootData.tables
    .filter((t) => t.state !== "fuori_servizio")
    .reduce((a, t) => a + Math.max(t.capacity, t.maxCapacity || 0), 0);
  const unassigned = inPeriod
    .filter((r) => r.status === "confermata" && !r.assignedTableId && !r.assignedComboId)
    .sort((a, b) => Number(needsJoin(b)) - Number(needsJoin(a)) || b.partySize - a.partySize || toMin(a.time) - toMin(b.time));
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
    const key = ["day", rid, date];
    const prev = qc.getQueryData<DayData>(key);
    // Ottimistico: il blocco si sposta e l'ora cambia all'istante, senza aspettare
    // la risposta del server. In caso di errore si ripristina lo stato precedente.
    qc.setQueryData<DayData>(key, (old) => old && ({
      ...old,
      reservations: old.reservations.map((r) => (r.id === res.id
        ? { ...r, assignedTableId: patch.tableId, assignedComboId: patch.comboId, time: patch.time ?? r.time }
        : r)),
    }));
    try {
      await api(`/api/reservations/${res.id}`, {
        method: "PATCH",
        body: { restaurantId: rid, staffName: me, action: "assign", tableId: patch.tableId, comboId: patch.comboId, time: patch.time, label: patch.label },
      });
      qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      if (prev) qc.setQueryData(key, prev);
      toast({ title: e.message, tone: "err" });
    }
  };

  // Dove finirebbe il blocco: colonna + slot iniziale, dalla posizione corrente.
  const dropTarget = (e: DragMoveEvent | DragEndEvent) => {
    const res = e.active.data.current?.res as Reservation | undefined;
    if (!res || !e.over) return null;
    const key = String(e.over.id);
    if (key === "rail") return { rail: true as const, res };
    const [kind, id] = key.split(":");
    const top = (e.active.rect.current.translated?.top ?? 0) - e.over.rect.top;
    const dur = durationFor(res.partySize, period.name, settings);
    const maxIdx = Math.max(0, Math.round((toMin(period.endTime) - startMin - dur) / settings.slotMinutes));
    const idx = Math.min(maxIdx, Math.max(0, Math.round(top / ROW_H)));
    return {
      rail: false as const, res, kind, id, idx,
      time: toHHMM(startMin + idx * settings.slotMinutes),
      slots: Math.max(2, Math.round(dur / settings.slotMinutes)),
      colKey: key,
    };
  };

  const onDragStart = (e: DragStartEvent) => setDragRes(e.active.data.current?.res ?? null);

  const onDragMove = (e: DragMoveEvent) => {
    const t = dropTarget(e);
    if (!t || t.rail) { setPreview(null); return; }
    setPreview((prev) =>
      prev && prev.col === t.colKey && prev.time === t.time
        ? prev
        : { col: t.colKey, top: t.idx * ROW_H, height: t.slots * ROW_H, time: t.time });
  };
  const onDragEnd = (e: DragEndEvent) => {
    justDragged.current = true;
    queueMicrotask(() => { justDragged.current = false; });
    setDragRes(null);
    setPreview(null);
    const t = dropTarget(e);
    if (!t) return;
    if (t.rail) {
      if (t.res.assignedTableId || t.res.assignedComboId) patchAssign(t.res, { tableId: null, comboId: null });
      return;
    }
    const samePlace = (t.kind === "table" && t.res.assignedTableId === t.id) || (t.kind === "combo" && t.res.assignedComboId === t.id);
    if (samePlace && t.time === t.res.time) return;
    const label = t.kind === "table"
      ? bootData.tables.find((x) => x.id === t.id)?.label
      : bootData.combos.find((c) => c.id === t.id)?.label;
    patchAssign(t.res, { tableId: t.kind === "table" ? t.id : null, comboId: t.kind === "combo" ? t.id : null, time: t.time, label });
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
      const proposals = plan.proposals.map((p) => ({
        reservationId: p.reservationId,
        kind: p.target.kind === "combo" ? "combo" : "table",
        id2: p.target.kind === "table" ? p.target.table.id
          : p.target.kind === "combo" ? p.target.combo.id
          : p.target.tables[0].id,
        joinedTableIds: p.target.kind === "join" ? p.target.tables.slice(1).map((t) => t.id) : [],
      }));
      await api("/api/autoassign", { method: "POST", body: { action: "apply", restaurantId: rid, date, periodId: period.id, staffName: me, proposals } });
      await qc.invalidateQueries({ queryKey: ["day", rid, date] });
      toast({ title: `${proposals.length} prenotazioni sistemate`, msg: "Il manuale ha sempre la priorità: sposta pure a mano.", tone: "ok" });
      setPlanOpen(false); setPlan(null);
    } catch (e: any) { toast({ title: e.message, tone: "err" }); }
    setPlanBusy(false);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => { setDragRes(null); setPreview(null); }}>
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

        {(() => {
          // CASI DA CONTROLLARE: quelli che in una serata piena fanno perdere tempo.
          const tooBig = unassigned.filter((r) => r.partySize > roomSeats);
          const toJoin = unassigned.filter((r) => needsJoin(r) && r.partySize <= roomSeats);
          const lastMinute = isToday
            ? unassigned.filter((r) => toMin(r.time) - nMin <= 30 && nMin - toMin(r.time) < 90)
            : [];
          const items = [
            tooBig.length && { k: "big", cls: "border-over/50 bg-over/10 text-over",
              txt: `${tooBig.length} oltre la capienza della sala (${roomSeats} coperti)` },
            toJoin.length && { k: "join", cls: "border-brand/50 bg-brand/10 text-brand",
              txt: `${toJoin.length} da accorpare: non entrano in un tavolo solo` },
            lastMinute.length && { k: "now", cls: "border-soon/50 bg-soon/10 text-soon",
              txt: `${lastMinute.length} in arrivo entro mezz'ora, ancora senza tavolo` },
            conflicts.size && { k: "cfl", cls: "border-over/50 bg-over/10 text-over",
              txt: `${conflicts.size} sullo stesso tavolo nello stesso momento` },
          ].filter(Boolean) as { k: string; cls: string; txt: string }[];
          if (!items.length) return null;
          return (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {items.map((i) => (
                <span key={i.k} className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${i.cls}`}>{i.txt}</span>
              ))}
            </div>
          );
        })()}

        <Rail count={unassigned.length}>
          {unassigned.map((r) => (
            <RailChip key={r.id} res={r} needsJoin={needsJoin(r)} lateMin={isToday ? nMin - toMin(r.time) : 0} lateThr={settings.lateThresholdMinutes}
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
              {/* Scorre in orizzontale quando i tavoli sono tanti; la colonna
                  degli orari resta agganciata a sinistra per non perdere il riferimento. */}
              <div className="no-scrollbar flex overflow-x-auto rounded-2xl border border-line bg-surface">
                <div className="sticky left-0 z-30 w-[46px] shrink-0 border-r border-line bg-surface">
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
                {/* Larghezza proporzionale ai posti: un tavolo da 8 occupa più spazio
                    di un due-posti, come sulla mappa. Compressa, non lineare: con la
                    proporzione pura un tavolone mangerebbe mezzo schermo. */}
                <div className="grid flex-1"
                  style={{
                    gridTemplateColumns: cols
                      .map((c) => `minmax(${Math.round(Math.min(96, 46 + Math.max(0, c.cap - 2) * 7))}px, 1fr)`)
                      .join(" "),
                  }}>
                  {cols.map((c) => {
                    const key = colKey(c.kind, c.id)!;
                    return (
                      <Column key={key} k={key} label={c.label} cap={c.cap} oos={c.oos} height={slotCount * ROW_H} rows={slotCount}
                        preview={preview?.col === key ? preview : null}>
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
            <p className="text-sm font-semibold text-muted">{settings.bufferMinutes}′ di riassetto tra un turno e l&apos;altro.</p>
            {plan.proposals.map((p) => (
              <div key={p.reservationId} className="flex items-start gap-3 rounded-2xl border border-ok/40 bg-ok/10 p-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
                <div>
                  <p className="font-bold">{p.name} · {p.partySize} p. · {p.time} → {p.target.kind === "table" ? `Tavolo ${p.target.table.label}` : p.target.kind === "combo" ? `Accorpati ${p.target.combo.label}` : `Accosta ${p.target.label}`}</p>
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

function RailChip({ res, onTap, lateMin, lateThr, needsJoin }: {
  res: Reservation; onTap: () => void; lateMin: number; lateThr: number; needsJoin?: boolean;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `rail-${res.id}`, data: { res } });
  const late = lateMin > lateThr;
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} onClick={onTap}
      style={{ touchAction: "none", opacity: isDragging ? 0.3 : 1 }}
      className={`flex min-h-[56px] shrink-0 items-center gap-2 rounded-xl border-2 px-3 active:scale-[0.97] ${needsJoin ? "border-brand bg-brand/10" : late ? "border-soon bg-soon/15" : "border-line bg-surface"}`}>
      <span className="font-display font-bold tabular-nums">{res.time}</span>
      <span className="font-bold">{res.guestName}</span>
      <span className="rounded-full bg-raised px-2 py-0.5 text-[13px] font-bold">{res.partySize}p</span>
      {needsJoin && <span className="text-[11px] font-bold text-brand">serve accorpare</span>}
    </button>
  );
}

function Column({ k, label, cap, oos, height, rows, preview, children }: {
  k: string; label: string; cap: number; oos: boolean; height: number; rows: number;
  preview?: { top: number; height: number; time: string } | null;
  children?: React.ReactNode;
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
        {preview && (
          <div className="pointer-events-none absolute inset-x-0.5 z-20 rounded-lg border-2 border-dashed border-brand bg-brand/20"
            style={{ top: preview.top, height: preview.height }}>
            <span className="absolute -top-1 left-1 rounded bg-brand px-1 font-sans text-[10px] font-bold leading-tight text-on-brand">
              {preview.time}
            </span>
          </div>
        )}
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
      <span className="block text-[11px] font-semibold opacity-80">
        {res.partySize}p · {res.time.slice(0, 5)}
        {(res.joinedTableIds?.length ?? 0) > 0 && ` · +${res.joinedTableIds.length}`}
        {conflict ? " · conflitto" : ""}
      </span>
    </button>
  );
}

// Assegnazione rapida: tocca una prenotazione "da sistemare", scegli il tavolo.
// Se il gruppo non entra in nessun tavolo singolo, propone di accostarne due o più
// (stesso calcolo della vista Sala), così anche dal Piano si può sistemare un tavolata.
export function AssignSheet({ res, date, onClose }: { res: Reservation | null; date: string; onClose: () => void }) {
  const boot = useBootstrap();
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const qc = useQueryClient();
  const reservations = qc.getQueryData<DayData>(["day", rid, date])?.reservations ?? [];
  if (!res || !boot.data) return null;
  const b = boot.data;
  const period = periodFor(toMin(res.time), b.periods);
  const dur = durationFor(res.partySize, period?.name ?? null, b.settings);
  const busyAtTime = reservations.filter((r) =>
    r.id !== res.id && (r.status === "confermata" || r.status === "seduta") &&
    (r.assignedTableId || r.assignedComboId));
  const { tables, combos } = freeTargetsAt({
    timeMin: toMin(res.time), party: res.partySize, dur, buf: b.settings.bufferMinutes,
    tables: b.tables, combos: b.combos, assigned: busyAtTime,
    durFor: (p) => durationFor(p, period?.name ?? null, b.settings),
  });
  const roomName = (roomId: string) => b.rooms.find((r) => r.id === roomId)?.name ?? "";
  const preferred = res.preferredRoomId;

  type Opt = {
    key: string; label: string; sub: string;
    tableId: string | null; comboId: string | null; joined: string[];
    waste: number; pref: boolean;
    splitTableId?: string;   // da staccare prima di assegnare
  };
  const opts: Opt[] = [
    ...tables.map((t) => ({
      key: t.id, label: `Tavolo ${t.label}`, sub: `${Math.max(t.capacity, t.maxCapacity)} posti · ${roomName(t.roomId)}`,
      tableId: t.id, comboId: null, joined: [], waste: Math.max(t.capacity, t.maxCapacity) - res.partySize,
      pref: !!preferred && t.roomId === preferred,
    })),
    ...combos.map((c) => ({
      key: c.id, label: `Accorpati ${c.label}`, sub: `${c.capacity} posti · ${roomName(c.roomId)}`,
      tableId: null, comboId: c.id, joined: [], waste: c.capacity - res.partySize,
      pref: !!preferred && c.roomId === preferred,
    })),
  ];

  // STACCARE UN TAVOLONE: se per questa prenotazione useremmo un tavolo molto più
  // grande del necessario, si propone di separarlo. Le altre parti restano libere
  // per gli altri gruppi della serata.
  const stdSeats = b.settings.standardTableSeats ?? 4;
  const bestWaste = opts.length ? Math.min(...opts.map((o) => o.waste)) : Infinity;
  if (bestWaste >= stdSeats && stdSeats >= res.partySize) {
    for (const t of b.tables.filter((x) => x.splitInto >= 2 && tables.some((f) => f.id === x.id))) {
      opts.push({
        key: `split-${t.id}`, label: `Stacca il tavolo ${t.label}`,
        sub: `Diventa ${t.splitInto} tavoli da ${stdSeats}: ne resta libero ${t.splitInto - 1} per altri`,
        tableId: null, comboId: null, joined: [], splitTableId: t.id,
        waste: stdSeats - res.partySize, pref: !!preferred && t.roomId === preferred,
      });
    }
  }

  // Accorpamento al volo: solo se non basta un tavolo singolo. Si valutano i tavoli
  // liberi in quella fascia oraria, non lo stato "adesso".
  if (!opts.length && b.settings.allowTableJoin) {
    const freeNow = freeTargetsAt({
      timeMin: toMin(res.time), party: 1, dur, buf: b.settings.bufferMinutes,
      tables: b.tables, combos: [], assigned: busyAtTime,
      durFor: (p) => durationFor(p, period?.name ?? null, b.settings),
    }).tables;
    for (const j of findJoinProposals({
      party: res.partySize, tables: freeNow, maxGapCm: b.settings.joinMaxGapCm ?? 150,
    })) {
      opts.push({
        key: j.label, label: `Accosta ${j.label}`, sub: j.reason,
        tableId: j.tableIds[0], comboId: null, joined: j.tableIds.slice(1),
        waste: j.waste, pref: !!preferred && j.tables.every((t) => t.roomId === preferred),
      });
    }
  }
  // prima la sala richiesta dal cliente, poi chi spreca meno posti
  opts.sort((x, y) => Number(y.pref) - Number(x.pref) || x.waste - y.waste);

  const pick = async (o: Opt) => {
    let tableId = o.tableId;
    if (o.splitTableId) {
      // si stacca davvero il tavolo, poi si assegna la prenotazione a una parte
      const r = await api<{ parts: { id: string; capacity: number }[] }>(
        `/api/tables/${o.splitTableId}/split`,
        { method: "POST", body: { restaurantId: rid, staffName: me } },
      );
      const part = r.parts.find((x) => x.capacity >= res.partySize) ?? r.parts[0];
      tableId = part.id;
      await qc.invalidateQueries({ queryKey: ["bootstrap"] });
    }
    await api(`/api/reservations/${res.id}`, {
      method: "PATCH",
      body: {
        restaurantId: rid, staffName: me, action: "assign",
        tableId, comboId: o.comboId, joinedTableIds: o.joined,
        label: o.label.replace("Tavolo ", "").replace("Accorpati ", "").replace("Accosta ", "").replace("Stacca il tavolo ", ""),
      },
    });
    await qc.invalidateQueries({ queryKey: ["day", rid, date] });
    onClose();
  };

  return (
    <Sheet open={!!res} onClose={onClose}
      title={<span>Sistema <span className="text-brand">{res.guestName}</span> · {res.partySize} p. alle {res.time} · occupa ~{dur}′</span>}>
      {preferred && (
        <p className="mb-2 text-[13px] font-semibold text-soon">Ha chiesto: {roomName(preferred)}</p>
      )}
      {opts.length ? (
        <div className="grid gap-2">
          {opts.map((o) => (
            <button key={o.key} onClick={() => pick(o)}
              className={`flex min-h-[60px] items-center gap-3 rounded-2xl border-2 px-4 text-left active:scale-[0.98] ${
                o.splitTableId ? "border-busy/40 bg-busy/10" : o.joined.length ? "border-soon/50 bg-soon/10" : "border-ok/40 bg-ok/10"}`}>
              <span className={`grid h-10 shrink-0 place-items-center rounded-xl px-2 font-display text-sm font-bold text-white ${
                o.splitTableId ? "bg-busy" : o.joined.length ? "bg-soon text-ink" : "bg-ok"}`}>
                {o.splitTableId
                  ? <Scissors className="h-4 w-4" />
                  : o.label.replace("Tavolo ", "").replace("Accorpati ", "").replace("Accosta ", "")}
              </span>
              <span className="min-w-0 flex-1 font-bold">
                {o.label}
                <span className="block truncate text-[13px] font-medium text-muted">{o.sub}</span>
              </span>
              {o.pref && <span className="shrink-0 text-[11px] font-bold text-soon">sala giusta</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-soon/50 bg-soon/10 p-4 text-center font-semibold text-soon">
          Nessun tavolo libero per {res.partySize} persone alle {res.time}. Sposta l&apos;orario o libera un accorpamento.
        </p>
      )}
    </Sheet>
  );
}
