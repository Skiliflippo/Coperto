"use client";
// ─────────────────────────────────────────────────────────────────────────────
// EDITOR PIANTINA · full-screen, stile Figma/Miro ma con le parole della sala.
// Performance: durante il trascinamento si scrive su element.style (nessun
// re-render per frame); lo stato React si aggiorna al rilascio, con snap a griglia.
// Vincolo: tavoli, muri e arredi restano SEMPRE dentro il perimetro della sala.
// Accesso: solo il titolare.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check, CircleDot, MousePointer2, RectangleHorizontal, Redo2, RotateCw,
  Square, Trash2, Undo2, Wallpaper, X, ZoomIn, ZoomOut, Blocks, Spline, Maximize2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { toast } from "@/components/toast";
import { useViewport } from "@/lib/use-viewport";
import {
  DECOR_PRESETS, aabb, blockedSides, boxInsideRoom, boxesOverlap, clamp, clampPointToRoom,
  elementBox, iconFromLabel, normalizeLayout, polygonOf, rectPolygon,
  snapBoxToWalls, snapTo, suggestShape, tableGeometry, uid,
  type Box, type DecorIcon, type FloorElement, type RoomLayout, type TableShape,
} from "@/lib/floor";
import { ElementNode, GridBackdrop, RoomShell, TableNode, type TableNodeData } from "@/components/floor-shapes";
import type { Bootstrap, Room, TableT } from "@/lib/types";

const STEP = 25;                       // aggancio: mezza cella = 25 cm
const PANEL_H = 150;                   // ingombro del pannello proprietà
const snapG = (v: number) => snapTo(v, STEP);
type Tool = "select" | "table" | "wall" | "decor" | "perimetro";
type Sel = { kind: "table" | "element"; id: string } | null;
type Draft = { layout: RoomLayout; tables: TableNodeData[]; deleted: string[] };

export function FloorEditor({ boot, roomId, onClose }: { boot: Bootstrap; roomId: string; onClose: () => void }) {
  const staff = useSession((s) => s.staff);
  const qc = useQueryClient();
  const room: Room = boot.rooms.find((r) => r.id === roomId) ?? boot.rooms[0];

  const initial = useMemo<Draft>(() => ({
    layout: normalizeLayout(room.layout),
    tables: boot.tables.filter((t) => t.roomId === room.id).map(toNode),
    deleted: [],
  }), [room, boot.tables]);

  const [draft, setDraft] = useState<Draft>(initial);
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [newShape, setNewShape] = useState<TableShape>("square");
  const [decorPick, setDecorPick] = useState(false);
  const [newDecor, setNewDecor] = useState<DecorIcon>("bancone");
  const [sel, setSel] = useState<Sel>(null);
  const [saving, setSaving] = useState(false);
  const [rubber, setRubber] = useState<FloorElement | null>(null);
  const [rubberBad, setRubberBad] = useState(false);
  const [badId, setBadId] = useState<string | null>(null);      // oggetto in posizione non valida
  const [confirmClose, setConfirmClose] = useState(false);

  const { ref, vp, fit, zoomBy, toWorld, isPanning, bind, revealRect, cancelPan } =
    useViewport(draft.layout.w, draft.layout.h, { padding: 80 });
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const dirty = past.length > 0;
  const poly = polygonOf(draft.layout);

  // Ingombri di tutto ciò che occupa spazio: serve a evitare sovrapposizioni.
  const tableBox = (t: TableNodeData): Box => aabb(t.x, t.y, t.width, t.height, t.rotation);
  const allBoxes = useCallback((exceptId?: string): Box[] => [
    ...draft.tables.filter((t) => t.id !== exceptId).map(tableBox),
    ...draft.layout.elements.filter((e) => e.id !== exceptId).map(elementBox),
  ], [draft]);
  const boxFits = (b: Box, exceptId?: string) =>
    boxInsideRoom(b, poly) && !allBoxes(exceptId).some((o) => boxesOverlap(b, o));

  const commit = useCallback((fn: (d: Draft) => Draft) => {
    setDraft((cur) => { setPast((p) => [...p.slice(-40), cur]); setFuture([]); return fn(cur); });
  }, []);
  const undo = () => setPast((p) => {
    if (!p.length) return p;
    setFuture((f) => [draft, ...f].slice(0, 40));
    setDraft(p[p.length - 1]);
    return p.slice(0, -1);
  });
  const redo = () => setFuture((f) => {
    if (!f.length) return f;
    setPast((p) => [...p, draft]);
    setDraft(f[0]);
    return f.slice(1);
  });

  const selTable = sel?.kind === "table" ? draft.tables.find((t) => t.id === sel.id) ?? null : null;
  const selEl = sel?.kind === "element" ? draft.layout.elements.find((e) => e.id === sel.id) ?? null : null;

  // Cambiando strumento si chiude sempre la selezione precedente: niente pannelli
  // che restano appesi mentre stai facendo altro.
  const pickTool = (t: Tool) => { setTool(t); setSel(null); setDecorPick(false); };

  // Quando selezioni qualcosa, la vista si sposta per non lasciarlo sotto il pannello.
  useEffect(() => {
    if (!sel) return;
    const box = selTable
      ? { x: selTable.x - selTable.width / 2, y: selTable.y - selTable.height / 2, w: selTable.width, h: selTable.height }
      : selEl ? { x: selEl.x, y: selEl.y, w: selEl.w, h: selEl.h } : null;
    if (box) revealRect(box, PANEL_H);
  }, [sel, selTable?.id, selEl?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trascinamento: DOM diretto, commit al rilascio, vincolo dentro la sala ──
  const dragNode = (e: React.PointerEvent, id: string, kind: "table" | "element") => {
    if (tool !== "select") return;
    e.stopPropagation();
    cancelPan();
    setSel({ kind, id });
    const node = nodeRefs.current.get(id);
    if (!node) return;
    const start = toWorld(e.clientX, e.clientY);
    const item = kind === "table"
      ? draft.tables.find((t) => t.id === id)!
      : draft.layout.elements.find((x) => x.id === id)!;
    const base = { x: item.x, y: item.y };
    const size = kind === "table"
      ? { w: (item as TableNodeData).width, h: (item as TableNodeData).height }
      : { w: (item as FloorElement).w, h: (item as FloorElement).h };
    const others = allBoxes(id);
    let last = base;
    let ok = true;
    let moved = false;

    // topLeft del riquadro a partire dalla posizione "logica" dell'oggetto
    const boxAt = (x: number, y: number): Box => kind === "table"
      ? aabb(x, y, size.w, size.h, item.rotation)
      : (item.rotation ? aabb(x + size.w / 2, y + size.h / 2, size.w, size.h, item.rotation) : { x, y, w: size.w, h: size.h });

    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      let nx = snapG(base.x + (p.x - start.x));
      let ny = snapG(base.y + (p.y - start.y));
      // MAGNETE: se un lato passa vicino a un muro o a un altro oggetto, ci si appoggia a filo
      const raw = boxAt(nx, ny);
      const snapped = snapBoxToWalls(raw, poly, others);
      nx += snapped.x - raw.x;
      ny += snapped.y - raw.y;
      const box = boxAt(nx, ny);
      ok = boxFits(box, id);
      setBadId(ok ? null : id);
      moved = true;
      last = { x: nx, y: ny };
      const dx = kind === "table" ? nx - size.w / 2 : nx;
      const dy = kind === "table" ? ny - size.h / 2 : ny;
      node.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${item.rotation}deg)`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBadId(null);
      if (!moved) return;
      if (!ok) {
        // rimette l'oggetto dov'era e spiega perché
        const dx = kind === "table" ? base.x - size.w / 2 : base.x;
        const dy = kind === "table" ? base.y - size.h / 2 : base.y;
        node.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${item.rotation}deg)`;
        toast({
          title: "Qui non ci sta",
          msg: boxInsideRoom(boxAt(last.x, last.y), poly) ? "C'è già un altro oggetto in quel punto." : "Deve restare dentro i muri della sala.",
          tone: "warn",
        });
        return;
      }
      commit((d) => kind === "table"
        ? { ...d, tables: d.tables.map((t) => (t.id === id ? { ...t, x: last.x, y: last.y } : t)) }
        : { ...d, layout: { ...d.layout, elements: d.layout.elements.map((x) => (x.id === id ? { ...x, x: last.x, y: last.y } : x)) } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── Ridimensionamento muri/arredi dai bordi ────────────────────────────────
  const resizeEl = (e: React.PointerEvent, el: FloorElement, hx: -1 | 0 | 1, hy: -1 | 0 | 1) => {
    e.stopPropagation();
    cancelPan();
    const node = nodeRefs.current.get(el.id);
    if (!node) return;
    const start = toWorld(e.clientX, e.clientY);
    let box = { x: el.x, y: el.y, w: el.w, h: el.h };
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.x, dy = p.y - start.y;
      let { x, y, w, h } = { x: el.x, y: el.y, w: el.w, h: el.h };
      if (hx === 1) w = Math.max(15, snapG(el.w + dx));
      if (hx === -1) { const nx = snapG(el.x + dx); w = Math.max(15, el.w + (el.x - nx)); x = nx; }
      if (hy === 1) h = Math.max(15, snapG(el.h + dy));
      if (hy === -1) { const ny = snapG(el.y + dy); h = Math.max(15, el.h + (el.y - ny)); y = ny; }
      const cand: Box = el.rotation ? aabb(x + w / 2, y + h / 2, w, h, el.rotation) : { x, y, w, h };
      const fits = boxFits(cand, el.id);
      setBadId(fits ? null : el.id);
      if (!fits) return;                       // non si ridimensiona dentro un muro o sopra un altro oggetto
      box = { x, y, w, h };
      node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${el.rotation}deg)`;
      node.style.width = `${w}px`;
      node.style.height = `${h}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBadId(null);
      commit((d) => ({ ...d, layout: { ...d.layout, elements: d.layout.elements.map((x) => (x.id === el.id ? { ...x, ...box } : x)) } }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── Perimetro: trascina un angolo (anche obliquo), doppio tap per aggiungerlo ──
  const dragCorner = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    cancelPan();
    const boxes = allBoxes();
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const np = { x: Math.max(0, snapG(p.x)), y: Math.max(0, snapG(p.y)) };
      setDraft((d) => {
        const pts = polygonOf(d.layout).map((q, i) => (i === index ? np : q));
        // il muro si ferma al contatto: se lascerebbe fuori un tavolo o un arredo, non si muove
        if (boxes.some((b) => !boxInsideRoom(b, pts))) return d;
        return { ...d, layout: { ...d.layout, polygon: pts } };
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // ricalcola il riquadro contenitore e registra un solo passo di undo
      setDraft((d) => {
        const pts = polygonOf(d.layout);
        const w = Math.max(400, Math.ceil(Math.max(...pts.map((p) => p.x)) / 50) * 50);
        const h = Math.max(400, Math.ceil(Math.max(...pts.map((p) => p.y)) / 50) * 50);
        setPast((prev) => [...prev.slice(-40), draft]);
        return { ...d, layout: { ...d.layout, w, h, polygon: pts } };
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const addCorner = (index: number) => {
    const pts = polygonOf(draft.layout);
    const a = pts[index], b = pts[(index + 1) % pts.length];
    const mid = { x: snapG((a.x + b.x) / 2), y: snapG((a.y + b.y) / 2) };
    commit((d) => ({ ...d, layout: { ...d.layout, polygon: [...pts.slice(0, index + 1), mid, ...pts.slice(index + 1)] } }));
  };
  const removeCorner = (index: number) => {
    const pts = polygonOf(draft.layout);
    if (pts.length <= 3) { toast({ title: "Servono almeno tre angoli", tone: "warn" }); return; }
    commit((d) => ({ ...d, layout: { ...d.layout, polygon: pts.filter((_, i) => i !== index) } }));
  };

  // ── Sfondo: pan · piazza tavolo · disegna muro/arredo ──────────────────────
  const onCanvasDown = (e: React.PointerEvent) => {
    if (tool === "select" || tool === "perimetro") { setSel(null); bind.onPointerDown(e); return; }

    if (tool === "table") {
      const p = toWorld(e.clientX, e.clientY);
      const cap = newShape === "round" ? 2 : newShape === "square" ? 4 : 6;
      const g = tableGeometry(cap, newShape);
      const safe = clampPointToRoom(p, poly);
      const box: Box = { x: safe.x - g.width / 2, y: safe.y - g.height / 2, w: g.width, h: g.height };
      if (!boxInsideRoom(box, poly)) {
        toast({ title: "Qui non ci sta", msg: "Il tavolo deve stare dentro i muri della sala.", tone: "warn" });
        return;
      }
      if (allBoxes().some((o) => boxesOverlap(box, o))) {
        toast({ title: "C'è già un oggetto qui", msg: "Scegli un punto libero della sala.", tone: "warn" });
        return;
      }
      const id = uid();
      commit((d) => ({
        ...d,
        tables: [...d.tables, {
          id, label: String(nextLabel(boot, d)), capacity: cap, maxCapacity: cap, shape: newShape,
          x: snapG(safe.x), y: snapG(safe.y), width: g.width, height: g.height, rotation: 0,
        }],
      }));
      setSel({ kind: "table", id });
      setTool("select");
      return;
    }

    // muro / arredo: si disegna trascinando
    const s0 = toWorld(e.clientX, e.clientY);
    const kind = tool as "wall" | "decor";
    let box: FloorElement | null = null;
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const x = snapG(Math.min(s0.x, p.x)), y = snapG(Math.min(s0.y, p.y));
      let w = snapG(Math.abs(p.x - s0.x)), h = snapG(Math.abs(p.y - s0.y));
      if (kind === "wall") { if (h < 60) h = 18; if (w < 60) w = 18; }  // muri sottili e dritti
      box = { id: "rubber", kind, x, y, w: Math.max(w, 18), h: Math.max(h, 18), rotation: 0, label: "" };
      setRubber(box);
      setRubberBad(!boxFits({ x: box.x, y: box.y, w: box.w, h: box.h }));
    };
    // NB: la creazione avviene QUI, fuori da qualsiasi updater di stato.
    // Prima era dentro setRubber(...) e React poteva eseguirla due volte,
    // creando due arredi sovrapposti.
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setRubber(null);
      setRubberBad(false);
      setTool("select");
      const b = box;
      if (!b || b.w * b.h < 900) return;
      const bx: Box = { x: b.x, y: b.y, w: b.w, h: b.h };
      if (!boxInsideRoom(bx, poly)) {
        toast({ title: kind === "wall" ? "Il muro esce dalla sala" : "L'arredo esce dalla sala", msg: "Va disegnato dentro il perimetro: riprova.", tone: "warn" });
        return;
      }
      if (allBoxes().some((o) => boxesOverlap(bx, o))) {
        toast({ title: "C'è già qualcosa qui", msg: "Non si possono sovrapporre due oggetti.", tone: "warn" });
        return;
      }
      const preset = DECOR_PRESETS.find((d) => d.icon === newDecor);
      const el: FloorElement = {
        ...b, id: uid(),
        label: kind === "decor" ? preset?.label ?? "Arredo" : "",
        icon: kind === "decor" ? newDecor : undefined,
      };
      commit((d) => ({ ...d, layout: { ...d.layout, elements: [...d.layout.elements, el] } }));
      setSel({ kind: "element", id: el.id });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const patchTable = (id: string, p: Partial<TableNodeData>) =>
    commit((d) => ({ ...d, tables: d.tables.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  const patchEl = (id: string, p: Partial<FloorElement>) =>
    commit((d) => ({ ...d, layout: { ...d.layout, elements: d.layout.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) } }));
  const removeSel = useCallback(() => {
    if (!sel) return;
    if (sel.kind === "table") {
      commit((d) => ({
        ...d,
        tables: d.tables.filter((t) => t.id !== sel.id),
        deleted: boot.tables.some((t) => t.id === sel.id) ? [...d.deleted, sel.id] : d.deleted,
      }));
    } else {
      commit((d) => ({ ...d, layout: { ...d.layout, elements: d.layout.elements.filter((e) => e.id !== sel.id) } }));
    }
    setSel(null);
  }, [sel, commit, boot.tables]);

  const setCapacity = (t: TableNodeData, cap: number) => {
    const c = clamp(cap, 1, 20);
    const shape = suggestShape(c, t.shape);
    patchTable(t.id, { capacity: c, maxCapacity: Math.max(c, t.maxCapacity ?? c), shape, ...tableGeometry(c, shape) });
  };
  const setMaxCapacity = (t: TableNodeData, max: number) =>
    patchTable(t.id, { maxCapacity: clamp(max, t.capacity, 24) });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") { sel ? setSel(null) : tool !== "select" ? setTool("select") : onClose(); }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); removeSel(); }
      if (e.key.toLowerCase() === "v") pickTool("select");
      if (e.key.toLowerCase() === "t") pickTool("table");
      if (e.key.toLowerCase() === "m") pickTool("wall");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      const nudge = e.shiftKey ? STEP * 4 : STEP;
      const dir: Record<string, [number, number]> = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge] };
      if (sel && dir[e.key]) {
        e.preventDefault();
        const [dx, dy] = dir[e.key];
        if (sel.kind === "table") { const t = draft.tables.find((x) => x.id === sel.id)!; patchTable(t.id, { x: t.x + dx, y: t.y + dy }); }
        else { const el = draft.layout.elements.find((x) => x.id === sel.id)!; patchEl(el.id, { x: el.x + dx, y: el.y + dy }); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/rooms/${room.id}/floor`, {
        method: "PUT",
        body: { staffId: staff?.id, staffName: staff?.name, layout: draft.layout, tables: draft.tables, deleted: draft.deleted },
      });
      await qc.invalidateQueries({ queryKey: ["bootstrap", staff?.restaurantId] });
      toast({ title: `Piantina di ${room.name} salvata`, msg: "Visibile subito su tutti i dispositivi.", tone: "ok" });
      onClose();
    } catch (e: any) {
      toast({ title: e.message ?? "Salvataggio non riuscito", tone: "err" });
    }
    setSaving(false);
  };
  const tryClose = () => { if (dirty) setConfirmClose(true); else onClose(); };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5" style={{ paddingTop: "max(env(safe-area-inset-top), 10px)" }}>
        <button onClick={tryClose} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-raised active:scale-95" aria-label="Chiudi editor">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold leading-tight">Piantina · {room.name}</p>
          <p className="text-[12px] font-semibold text-muted">
            {draft.tables.length} tavoli · {draft.tables.reduce((a, t) => a + t.capacity, 0)} coperti
            {dirty && <span className="ml-1.5 text-brand">· non salvata</span>}
          </p>
        </div>
        <button onClick={undo} disabled={!past.length} className="grid h-12 w-12 place-items-center rounded-2xl bg-raised disabled:opacity-30 active:scale-95" aria-label="Annulla"><Undo2 className="h-5 w-5" /></button>
        <button onClick={redo} disabled={!future.length} className="hidden h-12 w-12 place-items-center rounded-2xl bg-raised disabled:opacity-30 active:scale-95 sm:grid" aria-label="Ripeti"><Redo2 className="h-5 w-5" /></button>
        <button onClick={save} disabled={saving} className="flex h-12 items-center gap-2 rounded-2xl bg-brand px-5 font-bold text-on-brand shadow active:scale-95 disabled:opacity-50">
          <Check className="h-5 w-5" /> Salva
        </button>
      </div>

      <div ref={ref} {...bind} onPointerDown={onCanvasDown}
        className={`relative flex-1 touch-none overflow-hidden bg-bg ${tool === "select" ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-crosshair"}`}>
        <GridBackdrop vp={vp} strong />
        <div className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate3d(${vp.panX}px, ${vp.panY}px, 0) scale(${vp.zoom})` }}>
          <RoomShell w={draft.layout.w} h={draft.layout.h} polygon={draft.layout.polygon} />

          {draft.layout.elements.map((el) => (
            <ElementNode key={el.id} el={el} editable invalid={badId === el.id} selected={sel?.kind === "element" && sel.id === el.id}
              ref={(n) => { if (n) nodeRefs.current.set(el.id, n); }}
              onPointerDown={(e) => dragNode(e, el.id, "element")}>
              {sel?.kind === "element" && sel.id === el.id && tool === "select" && (
                ([[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const).map(([hx, hy]) => (
                  <span key={`${hx}${hy}`} onPointerDown={(e) => resizeEl(e, el, hx, hy)}
                    className="absolute rounded-full border-[3px] border-brand bg-surface"
                    style={{
                      width: 26 / vp.zoom, height: 26 / vp.zoom,
                      left: `calc(${hx === -1 ? "0%" : hx === 1 ? "100%" : "50%"} - ${13 / vp.zoom}px)`,
                      top: `calc(${hy === -1 ? "0%" : hy === 1 ? "100%" : "50%"} - ${13 / vp.zoom}px)`,
                      cursor: hx === 0 ? "ns-resize" : hy === 0 ? "ew-resize" : hx === hy ? "nwse-resize" : "nesw-resize",
                    }} />
                ))
              )}
            </ElementNode>
          ))}
          {rubber && <ElementNode el={rubber} selected={!rubberBad} invalid={rubberBad} />}

          {draft.tables.map((t) => (
            <TableNode key={t.id} t={t} tone="border-busy/50"
              sub={`${t.capacity}${(t.maxCapacity ?? t.capacity) > t.capacity ? `-${t.maxCapacity}` : ""}p`}
              invalid={badId === t.id}
              blocked={blockedSides(tableBox(t), poly, allBoxes(t.id))}
              selected={sel?.kind === "table" && sel.id === t.id}
              ref={(n) => { if (n) nodeRefs.current.set(t.id, n); }}
              onPointerDown={(e) => dragNode(e, t.id, "table")} />
          ))}

          {/* maniglie del perimetro: qui nascono i muri obliqui */}
          {tool === "perimetro" && poly.map((p, i) => {
            const next = poly[(i + 1) % poly.length];
            const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
            const r = 30 / vp.zoom;
            return (
              <div key={i}>
                <span onPointerDown={(e) => dragCorner(e, i)} onDoubleClick={() => removeCorner(i)}
                  className="absolute cursor-move rounded-full border-[4px] border-brand bg-surface shadow"
                  style={{ width: r, height: r, left: p.x - r / 2, top: p.y - r / 2 }} />
                <span onPointerDown={(e) => { e.stopPropagation(); addCorner(i); }}
                  className="absolute grid cursor-copy place-items-center rounded-full bg-brand/85 text-on-brand"
                  style={{ width: r * 0.8, height: r * 0.8, left: mid.x - r * 0.4, top: mid.y - r * 0.4, fontSize: r * 0.5 }}>
                  +
                </span>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-4 right-3 flex flex-col gap-1.5" style={{ bottom: sel ? PANEL_H + 16 : 16 }}>
          <button onClick={() => zoomBy(1.25)} className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-lg ring-1 ring-line active:scale-95" aria-label="Ingrandisci"><ZoomIn className="h-5 w-5" /></button>
          <button onClick={() => zoomBy(0.8)} className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-lg ring-1 ring-line active:scale-95" aria-label="Riduci"><ZoomOut className="h-5 w-5" /></button>
          <button onClick={fit} className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-lg ring-1 ring-line active:scale-95" aria-label="Adatta"><Maximize2 className="h-5 w-5" /></button>
        </div>

        {tool !== "select" && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-2xl bg-ink px-4 py-2 text-center text-[13px] font-bold text-bg shadow-lg">
            {tool === "table" ? "Tocca dove mettere il tavolo"
              : tool === "wall" ? "Trascina per tracciare il muro"
              : tool === "decor" ? `Trascina per disegnare: ${DECOR_PRESETS.find((d) => d.icon === newDecor)?.label}`
              : "Trascina gli angoli · + aggiunge un angolo · doppio tap lo toglie"}
          </div>
        )}
      </div>

      {/* Scelta arredo: compare sopra la toolbar, si chiude da sola dopo la scelta */}
      {decorPick && (
        <div className="absolute inset-x-0 z-20 flex justify-center px-3" style={{ bottom: `calc(env(safe-area-inset-bottom) + ${sel ? PANEL_H + 84 : 84}px)` }}>
          <div className="grid max-w-md grid-cols-4 gap-1.5 rounded-3xl border border-line bg-surface p-2 shadow-2xl">
            {DECOR_PRESETS.map((d) => (
              <button key={d.icon} onClick={() => { setNewDecor(d.icon); setTool("decor"); setDecorPick(false); setSel(null); }}
                className={`min-h-[52px] rounded-2xl px-2 text-[12px] font-bold active:scale-95 ${newDecor === d.icon && tool === "decor" ? "bg-brand text-on-brand" : "bg-raised"}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TOOLBAR */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-3"
        style={{ bottom: `calc(env(safe-area-inset-bottom) + ${sel ? PANEL_H + 14 : 16}px)` }}>
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-3xl border border-line bg-surface/95 p-1.5 shadow-2xl backdrop-blur">
          <ToolBtn active={tool === "select"} onClick={() => pickTool("select")} icon={<MousePointer2 className="h-5 w-5" />} label="Sposta" />
          <div className="flex items-center gap-1 rounded-2xl bg-raised/60 p-1">
            {([["round", <CircleDot key="a" className="h-4 w-4" />], ["square", <Square key="b" className="h-4 w-4" />], ["rect", <RectangleHorizontal key="c" className="h-4 w-4" />]] as const).map(([sh, ic]) => (
              <button key={sh} onClick={() => { setNewShape(sh as TableShape); pickTool("table"); }}
                className={`grid h-11 w-11 place-items-center rounded-xl active:scale-95 ${tool === "table" && newShape === sh ? "bg-brand text-on-brand" : "bg-surface"}`}
                aria-label={`Tavolo ${sh === "round" ? "tondo" : sh === "square" ? "quadrato" : "rettangolare"}`}>
                {ic}
              </button>
            ))}
          </div>
          <ToolBtn active={tool === "wall"} onClick={() => pickTool("wall")} icon={<Wallpaper className="h-5 w-5" />} label="Muro" />
          <ToolBtn active={tool === "decor"} onClick={() => { setSel(null); setDecorPick((v) => !v); }} icon={<Blocks className="h-5 w-5" />} label="Arredo" />
          <ToolBtn active={tool === "perimetro"} onClick={() => pickTool("perimetro")} icon={<Spline className="h-5 w-5" />} label="Sala" />
        </div>
      </div>

      {/* PANNELLO PROPRIETÀ · compatto, largo quanto serve, non un rettangolone */}
      {selTable && (
        <ContextPanel onClose={() => setSel(null)} title={`Tavolo ${selTable.label}`}
          subtitle={`${selTable.capacity}${(selTable.maxCapacity ?? selTable.capacity) > selTable.capacity ? `-${selTable.maxCapacity}` : ""} coperti · ${Math.round(selTable.width)}×${Math.round(selTable.height)} cm`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={selTable.label} onChange={(e) => patchTable(selTable.id, { label: e.target.value.slice(0, 6) })}
              className="h-12 w-16 rounded-xl border border-line bg-bg text-center font-display text-lg font-extrabold outline-none focus:border-brand" aria-label="Numero tavolo" />
            <Spin label="Coperti" value={selTable.capacity} onMinus={() => setCapacity(selTable, selTable.capacity - 1)} onPlus={() => setCapacity(selTable, selTable.capacity + 1)} />
            <Spin label="Max sedie" value={selTable.maxCapacity ?? selTable.capacity}
              onMinus={() => setMaxCapacity(selTable, (selTable.maxCapacity ?? selTable.capacity) - 1)}
              onPlus={() => setMaxCapacity(selTable, (selTable.maxCapacity ?? selTable.capacity) + 1)} />
            <button onClick={() => patchTable(selTable.id, { rotation: selTable.rotation + 90 })}
              className="flex h-12 items-center gap-1 rounded-xl bg-raised px-3 text-sm font-bold active:scale-95"><RotateCw className="h-4 w-4" />90°</button>
            {([["round", "Tondo"], ["square", "Quadr."], ["rect", "Rett."]] as const).map(([sh, lb]) => (
              <button key={sh} onClick={() => patchTable(selTable.id, { shape: sh, ...tableGeometry(selTable.capacity, sh) })}
                className={`h-12 rounded-xl px-3 text-sm font-bold active:scale-95 ${selTable.shape === sh ? "bg-brand text-on-brand" : "bg-raised"}`}>{lb}</button>
            ))}
            <button onClick={removeSel} className="grid h-12 w-12 place-items-center rounded-xl bg-over/15 text-over active:scale-95" aria-label="Elimina tavolo"><Trash2 className="h-5 w-5" /></button>
          </div>
        </ContextPanel>
      )}

      {confirmClose && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl">
            <p className="font-display text-xl font-bold">Uscire senza salvare?</p>
            <p className="mt-1 text-sm text-muted">Le modifiche alla piantina andranno perse.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmClose(false)} className="min-h-[52px] rounded-2xl bg-raised font-bold active:scale-95">Continua</button>
              <button onClick={onClose} className="min-h-[52px] rounded-2xl bg-over/15 font-bold text-over active:scale-95">Esci</button>
            </div>
            <button onClick={() => { setConfirmClose(false); void save(); }}
              className="mt-2 min-h-[52px] w-full rounded-2xl bg-brand font-bold text-on-brand active:scale-95">Salva ed esci</button>
          </div>
        </div>
      )}

      {selEl && (
        <ContextPanel onClose={() => setSel(null)} title={selEl.kind === "wall" ? "Muro" : "Arredo"}
          subtitle={`${Math.round(selEl.w)}×${Math.round(selEl.h)} cm · trascina i pallini per ridimensionare`}>
          <div className="flex flex-wrap items-center gap-1.5">
            {selEl.kind === "decor" && (
              <>
                <input value={selEl.label}
                  onChange={(e) => patchEl(selEl.id, { label: e.target.value.slice(0, 20), icon: iconFromLabel(e.target.value, selEl.icon) })}
                  placeholder="Bancone, Cucina…"
                  className="h-12 min-w-[140px] flex-1 rounded-xl border border-line bg-bg px-3 font-semibold outline-none focus:border-brand" />
                <select value={selEl.icon ?? "generico"} onChange={(e) => patchEl(selEl.id, { icon: e.target.value as DecorIcon })}
                  className="h-12 rounded-xl border border-line bg-bg px-2 text-sm font-bold outline-none focus:border-brand">
                  {DECOR_PRESETS.map((d) => <option key={d.icon} value={d.icon}>{d.label}</option>)}
                  <option value="generico">Altro</option>
                </select>
              </>
            )}
            <button onClick={() => patchEl(selEl.id, { rotation: selEl.rotation + 45 })}
              className="flex h-12 items-center gap-1 rounded-xl bg-raised px-3 text-sm font-bold active:scale-95"><RotateCw className="h-4 w-4" />45°</button>
            <button onClick={() => patchEl(selEl.id, { w: selEl.h, h: selEl.w })}
              className="h-12 rounded-xl bg-raised px-3 text-sm font-bold active:scale-95">Gira</button>
            <button onClick={removeSel} className="grid h-12 w-12 place-items-center rounded-xl bg-over/15 text-over active:scale-95" aria-label="Elimina"><Trash2 className="h-5 w-5" /></button>
          </div>
        </ContextPanel>
      )}
    </div>
  );
}

function Spin({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex h-12 items-center gap-1 rounded-xl bg-raised px-1.5">
      <button onClick={onMinus} className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg font-bold active:scale-95">−</button>
      <span className="min-w-[46px] text-center leading-none">
        <span className="block font-display text-lg font-extrabold tabular-nums">{value}</span>
        <span className="block text-[10px] font-bold text-muted">{label}</span>
      </span>
      <button onClick={onPlus} className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg font-bold active:scale-95">+</button>
    </div>
  );
}

function ToolBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex h-12 min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl px-2.5 active:scale-95 ${active ? "bg-ink text-bg" : "text-muted"}`}>
      {icon}<span className="text-[10px] font-bold leading-none">{label}</span>
    </button>
  );
}

// Scheda proprietà: una card centrata, non una fascia che copre mezzo schermo.
function ContextPanel({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <div className="pointer-events-auto w-full max-w-xl animate-sheet-up rounded-3xl border border-line bg-surface/97 p-3 shadow-2xl backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight">{title}</p>
            {subtitle && <p className="truncate text-[12px] font-medium text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl bg-raised text-muted active:scale-95" aria-label="Chiudi"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const toNode = (t: TableT): TableNodeData => ({
  id: t.id, label: t.label, capacity: t.capacity, maxCapacity: Math.max(t.capacity, t.maxCapacity || 0),
  shape: t.shape, x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation,
});

function nextLabel(boot: Bootstrap, draft: Draft): number {
  const used = new Set<number>();
  for (const t of boot.tables) if (!draft.deleted.includes(t.id)) used.add(Number(t.label) || 0);
  for (const t of draft.tables) used.add(Number(t.label) || 0);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export { rectPolygon };
