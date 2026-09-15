"use client";
// ─────────────────────────────────────────────────────────────────────────────
// EDITOR PIANTINA · full-screen, stile Figma/Miro ma con le parole della sala.
// Performance ottimizzata per tablet:
// - Pan/zoom via GPU transform diretta + rAF (nessun re-render per frame)
// - Drag tavoli/muri via element.style (nessun re-render per frame)
// - liveWalls e badIds throttled via rAF per evitare re-render continui
// - PointerEvents unificati con capture, touch-action: none, overscroll: none
// - will-change + translate3d + backface-visibility per accelerazione hardware
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check, CircleDot, MousePointer2, RectangleHorizontal, Redo2, RotateCw,
  Square, Trash2, Undo2, Wallpaper, X, ZoomIn, ZoomOut, Blocks, Spline, Maximize2,
  Scissors, Link2, Unlink,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { toast } from "@/components/toast";
import { useViewport } from "@/lib/use-viewport";
import {
  DECOR_PRESETS, DECOR_TONES, MAX_ROOM_CM, aabb, boxInsideRoom, boxesOverlap, clamp, clampPointToRoom, computeRoomSeats,
  suggestedSplitParts,
  polygonBounds,
  elementBox, iconFromLabel, normalizeLayout, polygonOf, rectPolygon,
  shapeForCapacity, snapBoxToWalls, snapTo, snapWallEndpoint, tableGeometry,
  tableLengthUnits, tableUnits, uid, unitTableSide, wallFromEndpoints, wallInsideRoom, wallLine,
  type Box, type DecorIcon, type DecorTone, type FloorElement, type Point, type RoomLayout, type TableShape,
} from "@/lib/floor";
import { ElementNode, GridBackdrop, PerimeterOverlay, RoomShell, TableNode, WallLayer, type TableNodeData } from "@/components/floor-shapes";
import type { Bootstrap, Room, TableT } from "@/lib/types";

const STEP = 25;
const PANEL_H = 108;
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
  const [selIds, setSelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [rubber, setRubber] = useState<FloorElement | null>(null);
  const [rubberBad, setRubberBad] = useState(false);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [liveWalls, setLiveWalls] = useState<Record<string, Partial<FloorElement>>>({});
  const [badIds, setBadIds] = useState<string[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);

  // rAF batching per liveWalls e badIds — evita re-render ad ogni pixel su tablet
  const pendingWalls = useRef<Record<string, Partial<FloorElement>> | null>(null);
  const pendingBad = useRef<string[] | null>(null);
  const wallsRaf = useRef<number>(0);
  const badRaf = useRef<number>(0);

  const scheduleWalls = useCallback((walls: Record<string, Partial<FloorElement>>) => {
    pendingWalls.current = walls;
    if (wallsRaf.current) return;
    wallsRaf.current = requestAnimationFrame(() => {
      wallsRaf.current = 0;
      if (pendingWalls.current) {
        setLiveWalls(pendingWalls.current);
        pendingWalls.current = null;
      }
    });
  }, []);

  const scheduleBad = useCallback((bad: string[]) => {
    pendingBad.current = bad;
    if (badRaf.current) return;
    badRaf.current = requestAnimationFrame(() => {
      badRaf.current = 0;
      if (pendingBad.current) {
        // Solo se cambiato, per evitare re-render inutili
        setBadIds((prev) => {
          const next = pendingBad.current!;
          if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev;
          return next;
        });
        pendingBad.current = null;
      }
    });
  }, []);

  const bounds = useMemo(() => polygonBounds(polygonOf(draft.layout)), [draft.layout]);
  const { ref, contentRef, gridRef, vp, fit, zoomBy, toWorld, isPanning, bind, revealRect, cancelPan, holdFit } =
    useViewport(draft.layout.w, draft.layout.h, {
      padding: 90, bounds,
    });
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const dirty = past.length > 0;
  const poly = polygonOf(draft.layout);
  const visibleElements = draft.layout.elements.map((element) =>
    liveWalls[element.id] ? { ...element, ...liveWalls[element.id] } : element,
  );
  const std = boot.settings.standardTableSeats ?? 4;
  const seatsByTable = useMemo(
    () => computeRoomSeats(draft.tables, poly, draft.layout.elements.map(elementBox)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.tables, draft.layout],
  );

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

  const sel: Sel = selIds.length === 1
    ? { kind: draft.tables.some((t) => t.id === selIds[0]) ? "table" : "element", id: selIds[0] }
    : null;
  const selTable = sel?.kind === "table" ? draft.tables.find((t) => t.id === sel.id) ?? null : null;
  const selEl = sel?.kind === "element" ? draft.layout.elements.find((e) => e.id === sel.id) ?? null : null;

  const invalidIds = useMemo(() => {
    const roomPoly = polygonOf(draft.layout);
    const items = [
      ...draft.tables.map((t) => ({ id: t.id, type: "table" as const, box: aabb(t.x, t.y, t.width, t.height, t.rotation) })),
      ...draft.layout.elements.map((e) => ({ id: e.id, type: e.kind, box: elementBox(e) })),
    ];
    const bad = new Set<string>();
    for (const it of items) {
      if (it.type === "wall") {
        const wall = draft.layout.elements.find((e) => e.id === it.id);
        if (wall && !wallInsideRoom(wall, roomPoly)) bad.add(it.id);
      } else if (!boxInsideRoom(it.box, roomPoly)) bad.add(it.id);
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (!boxesOverlap(items[i].box, items[j].box)) continue;
        const a = items[i], b = items[j];
        if ((a.type === "wall" && b.type !== "table") || (b.type === "wall" && a.type !== "table")) continue;
        bad.add(a.id); bad.add(b.id);
      }
    }
    return bad;
  }, [draft]);

  const isBad = (id: string) => badIds.includes(id) || invalidIds.has(id);

  const moveSelection = useCallback((ids: string[], dx: number, dy: number) => {
    if (!ids.length) return;
    commit((d) => ({
      ...d,
      tables: d.tables.map((t) => (ids.includes(t.id) ? { ...t, x: snapG(t.x + dx), y: snapG(t.y + dy) } : t)),
      layout: {
        ...d.layout,
        elements: d.layout.elements.map((e) => {
          if (!ids.includes(e.id)) return e;
          return e.kind === "wall"
            ? { ...e, x: e.x + snapG(dx), y: e.y + snapG(dy) }
            : { ...e, x: snapG(e.x + dx), y: snapG(e.y + dy) };
        }),
      },
    }));
  }, [commit]);

  const pickTool = (t: Tool) => { setTool(t); setSelIds([]); setDecorPick(false); };

  useEffect(() => {
    if (!sel) return;
    const box = selTable
      ? aabb(selTable.x, selTable.y, selTable.width, selTable.height, selTable.rotation)
      : selEl ? elementBox(selEl) : null;
    if (box) revealRect(box, PANEL_H + 80);
  }, [sel, selTable?.id, selEl?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trascinamento ottimizzato per tablet ──────────────────────────────────
  // Scrive direttamente su element.style, liveWalls/badIds throttled via rAF
  const dragNode = (e: React.PointerEvent, id: string) => {
    if (tool !== "select") return;
    e.stopPropagation();
    cancelPan();
    // Pointer capture per ricevere move anche fuori dal nodo (essenziale su touch)
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
      return;
    }
    const group = selIds.includes(id) && selIds.length > 1 ? selIds : [id];
    setSelIds(group);

    const start = toWorld(e.clientX, e.clientY);
    const items = group
      .map((gid) => {
        const table = draft.tables.find((t) => t.id === gid);
        if (table) return {
          id: gid, kind: "table" as const, type: "table" as const, isWall: false,
          x: table.x, y: table.y, w: table.width, h: table.height, rotation: table.rotation,
        };
        const el = draft.layout.elements.find((x) => x.id === gid);
        return el ? {
          id: gid, kind: "element" as const, type: el.kind, isWall: el.kind === "wall",
          x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation,
        } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!items.length) return;

    const otherItems = [
      ...draft.tables.filter((t) => !group.includes(t.id)).map((t) => ({ type: "table" as const, box: tableBox(t) })),
      ...draft.layout.elements.filter((el) => !group.includes(el.id)).map((el) => ({ type: el.kind, box: elementBox(el) })),
    ];
    const others = otherItems.map((x) => x.box);
    const single = items.length === 1 ? items[0] : null;
    const boxAt = (it: typeof items[number], x: number, y: number): Box => it.kind === "table"
      ? aabb(x, y, it.w, it.h, it.rotation)
      : (it.rotation ? aabb(x + it.w / 2, y + it.h / 2, it.w, it.h, it.rotation) : { x, y, w: it.w, h: it.h });

    let delta = { x: 0, y: 0 };
    let moved = false;
    let lastBad: string[] = [];
    let lastWallMoves: Record<string, Partial<FloorElement>> = {};

    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      let dx = p.x - start.x;
      let dy = p.y - start.y;

      if (single) {
        if (single.isWall) {
          delta = { x: snapG(dx), y: snapG(dy) };
        } else {
          let nx = snapG(single.x + dx);
          let ny = snapG(single.y + dy);
          const raw = boxAt(single, nx, ny);
          const snapped = snapBoxToWalls(raw, poly, others, 26);
          nx += snapped.x - raw.x;
          ny += snapped.y - raw.y;
          delta = { x: nx - single.x, y: ny - single.y };
        }
      } else {
        delta = { x: snapG(dx), y: snapG(dy) };
      }

      moved = true;
      const bad: string[] = [];
      const wallMoves: Record<string, Partial<FloorElement>> = {};
      for (const it of items) {
        const nx = it.x + delta.x, ny = it.y + delta.y;
        if (it.type === "wall") wallMoves[it.id] = { x: nx, y: ny };
        const node = nodeRefs.current.get(it.id);
        if (node) {
          const left = it.kind === "table" ? nx - it.w / 2 : nx;
          const top = it.kind === "table" ? ny - it.h / 2 : ny;
          node.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(${it.rotation}deg)`;
        }
        const box = boxAt(it, nx, ny);
        const collision = otherItems.some((other) => {
          if (!boxesOverlap(box, other.box)) return false;
          if ((it.type === "wall" && other.type !== "table") || (other.type === "wall" && it.type !== "table")) return false;
          return true;
        });
        const wall = it.type === "wall" ? draft.layout.elements.find((e) => e.id === it.id) : null;
        const inside = wall ? wallInsideRoom({ ...wall, x: nx, y: ny }, poly) : boxInsideRoom(box, poly);
        if (!inside || collision) bad.push(it.id);
      }
      // Throttle aggiornamenti React via rAF — su tablet riduce da 120 a 60 re-render/sec
      // e solo se effettivamente cambiato
      if (JSON.stringify(wallMoves) !== JSON.stringify(lastWallMoves)) {
        lastWallMoves = wallMoves;
        scheduleWalls(wallMoves);
      }
      if (JSON.stringify(bad) !== JSON.stringify(lastBad)) {
        lastBad = bad;
        scheduleBad(bad);
      }
    };

    const up = (ev: PointerEvent) => {
      try { (e.currentTarget as HTMLElement).releasePointerCapture((ev as any).pointerId ?? e.pointerId); } catch {}
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (wallsRaf.current) { cancelAnimationFrame(wallsRaf.current); wallsRaf.current = 0; }
      if (badRaf.current) { cancelAnimationFrame(badRaf.current); badRaf.current = 0; }
      pendingWalls.current = null;
      pendingBad.current = null;
      setBadIds([]);
      setLiveWalls({});
      if (!moved || (delta.x === 0 && delta.y === 0)) return;
      moveSelection(group, delta.x, delta.y);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const resizeEl = (e: React.PointerEvent, el: FloorElement, hx: -1 | 0 | 1, hy: -1 | 0 | 1) => {
    e.stopPropagation();
    cancelPan();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    const node = nodeRefs.current.get(el.id);
    if (!node) return;
    const start = toWorld(e.clientX, e.clientY);
    const rad = (el.rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const center0 = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
    let box = { x: el.x, y: el.y, w: el.w, h: el.h };

    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const dxWorld = p.x - start.x, dyWorld = p.y - start.y;
      const rawDxLocal = dxWorld * cos + dyWorld * sin;
      const rawDyLocal = -dxWorld * sin + dyWorld * cos;
      const wallDamp = el.kind === "wall" ? 0.38 : 1;
      const dxLocal = rawDxLocal * wallDamp;
      const dyLocal = rawDyLocal * wallDamp;

      const min = el.kind === "wall" ? 4 : 15;
      const horizontalWall = el.kind === "wall" && el.w >= el.h;
      const verticalWall = el.kind === "wall" && el.h > el.w;
      const snapWidth = verticalWall ? (v: number) => snapTo(v, 2) : snapG;
      const snapHeight = horizontalWall ? (v: number) => snapTo(v, 2) : snapG;
      const w = hx === 0 ? el.w : Math.max(min, snapWidth(el.w + hx * dxLocal));
      const h = hy === 0 ? el.h : Math.max(min, snapHeight(el.h + hy * dyLocal));

      const shiftLocalX = (hx * (w - el.w)) / 2;
      const shiftLocalY = (hy * (h - el.h)) / 2;
      const center = {
        x: center0.x + shiftLocalX * cos - shiftLocalY * sin,
        y: center0.y + shiftLocalX * sin + shiftLocalY * cos,
      };
      const x = center.x - w / 2, y = center.y - h / 2;

      const cand: Box = el.rotation ? aabb(center.x, center.y, w, h, el.rotation) : { x, y, w, h };
      // Throttled
      scheduleBad(boxFits(cand, el.id) ? [] : [el.id]);
      box = { x, y, w, h };
      node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${el.rotation}deg)`;
      node.style.width = `${w}px`;
      node.style.height = `${h}px`;
    };
    const up = (ev: PointerEvent) => {
      try { (e.currentTarget as HTMLElement).releasePointerCapture((ev as any).pointerId ?? e.pointerId); } catch {}
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (badRaf.current) { cancelAnimationFrame(badRaf.current); badRaf.current = 0; }
      pendingBad.current = null;
      setBadIds([]);
      commit((d) => ({ ...d, layout: { ...d.layout, elements: d.layout.elements.map((x) => (x.id === el.id ? { ...x, ...box } : x)) } }));
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const dragWallEndpoint = (e: React.PointerEvent, el: FloorElement, endpoint: "a" | "b") => {
    e.stopPropagation();
    cancelPan();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    const node = nodeRefs.current.get(el.id);
    if (!node) return;
    const original = wallLine(el);
    const fixed = endpoint === "a" ? original.b : original.a;
    const dx0 = original.b.x - original.a.x;
    const dy0 = original.b.y - original.a.y;
    const horizontal = Math.abs(dx0) >= Math.abs(dy0) && Math.abs(dy0) < 2;
    const vertical = Math.abs(dy0) > Math.abs(dx0) && Math.abs(dx0) < 2;
    const otherWalls = draft.layout.elements.filter((x) => x.kind === "wall" && x.id !== el.id);
    let next = el;

    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      let target = horizontal ? { x: p.x, y: fixed.y }
        : vertical ? { x: fixed.x, y: p.y }
          : p;
      target = snapWallEndpoint(target, otherWalls, poly, STEP, 10);
      if (horizontal) target.y = fixed.y;
      if (vertical) target.x = fixed.x;
      if (Math.hypot(target.x - fixed.x, target.y - fixed.y) < STEP) return;
      next = endpoint === "a"
        ? wallFromEndpoints(el.id, target, fixed, original.thickness, el.label)
        : wallFromEndpoints(el.id, fixed, target, original.thickness, el.label);
      node.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) rotate(${next.rotation}deg)`;
      node.style.width = `${next.w}px`;
      node.style.height = `${next.h}px`;
      scheduleWalls({ [el.id]: next });
      const nextBox = elementBox(next);
      const hitsTable = draft.tables.some((t) => boxesOverlap(nextBox, tableBox(t)));
      scheduleBad(wallInsideRoom(next, poly) && !hitsTable ? [] : [el.id]);
    };
    const up = (ev: PointerEvent) => {
      try { (e.currentTarget as HTMLElement).releasePointerCapture((ev as any).pointerId ?? e.pointerId); } catch {}
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (wallsRaf.current) { cancelAnimationFrame(wallsRaf.current); wallsRaf.current = 0; }
      if (badRaf.current) { cancelAnimationFrame(badRaf.current); badRaf.current = 0; }
      pendingWalls.current = null;
      pendingBad.current = null;
      setBadIds([]);
      setLiveWalls({});
      patchEl(el.id, next);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const dragCorner = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    cancelPan();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    const before = draft;
    holdFit(true);
    const origin = toWorld(e.clientX, e.clientY);
    const startPoint = polygonOf(draft.layout)[index];
    const DAMP = 0.28;
    let pending: Point | null = null;
    let frame = 0;

    const applyPoint = (np: Point) => {
      setDraft((d) => {
        const pts = polygonOf(d.layout).map((q, i) => (i === index ? np : q));
        const shiftX = Math.max(0, -Math.min(...pts.map((q) => q.x)));
        const shiftY = Math.max(0, -Math.min(...pts.map((q) => q.y)));
        const moved = pts.map((q) => ({ x: q.x + shiftX, y: q.y + shiftY }));
        const w = Math.max(400, Math.ceil(Math.max(...moved.map((q) => q.x)) / 50) * 50);
        const h = Math.max(400, Math.ceil(Math.max(...moved.map((q) => q.y)) / 50) * 50);
        if (w > MAX_ROOM_CM || h > MAX_ROOM_CM) return d;

        const elements = shiftX || shiftY
          ? d.layout.elements.map((el) => ({ ...el, x: el.x + shiftX, y: el.y + shiftY }))
          : d.layout.elements;
        const tables = shiftX || shiftY
          ? d.tables.map((t) => ({ ...t, x: t.x + shiftX, y: t.y + shiftY }))
          : d.tables;

        return { ...d, tables, layout: { ...d.layout, w, h, polygon: moved, elements } };
      });
    };

    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      pending = {
        x: snapG(startPoint.x + (p.x - origin.x) * DAMP),
        y: snapG(startPoint.y + (p.y - origin.y) * DAMP),
      };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pending) applyPoint(pending);
      });
    };
    const up = (ev: PointerEvent) => {
      try { (e.currentTarget as HTMLElement).releasePointerCapture((ev as any).pointerId ?? e.pointerId); } catch {}
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (pending) applyPoint(pending);
      holdFit(false);
      fit();
      setPast((prev) => [...prev.slice(-40), before]);
      setFuture([]);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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

  const startMarquee = (e: React.PointerEvent) => {
    e.stopPropagation();
    cancelPan();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    const start = toWorld(e.clientX, e.clientY);
    let last: Box = { x: start.x, y: start.y, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      last = {
        x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y),
      };
      setMarquee(last);
    };
    const up = (ev: PointerEvent) => {
      try { (e.currentTarget as HTMLElement).releasePointerCapture((ev as any).pointerId ?? e.pointerId); } catch {}
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setMarquee(null);
      if (last.w < 5 && last.h < 5) { setSelIds([]); return; }
      const selected = [
        ...draft.tables.filter((t) => boxesOverlap(last, tableBox(t))).map((t) => t.id),
        ...draft.layout.elements.filter((el) => boxesOverlap(last, elementBox(el))).map((el) => el.id),
      ];
      setSelIds(selected);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onCanvasDown = (e: React.PointerEvent) => {
    if (tool === "select") {
      if (e.ctrlKey || e.metaKey) startMarquee(e);
      else { setSelIds([]); bind.onPointerDown(e); }
      return;
    }
    if (tool === "perimetro") { setSelIds([]); bind.onPointerDown(e); return; }

    if (tool === "table") {
      const p = toWorld(e.clientX, e.clientY);
      const cap = newShape === "round" ? 2 : newShape === "square" ? 4 : std * 2;
      const units = newShape === "rect" ? 2 : 1;
      const g = tableGeometry(cap, newShape, std, units);
      const safe = clampPointToRoom(p, poly);
      const id = uid();
      commit((d) => ({
        ...d,
        tables: [...d.tables, {
          id, label: String(nextLabel(boot, d)), capacity: cap, maxCapacity: cap, shape: newShape,
          x: snapG(safe.x), y: snapG(safe.y), width: g.width, height: g.height, rotation: 0,
          splitInto: suggestedSplitParts(cap, newShape, std),
          isJoinable: true,
        }],
      }));
      setSelIds([id]);
      setTool("select");
      return;
    }

    if (tool === "wall") {
      const existingWalls = draft.layout.elements.filter((el) => el.kind === "wall");
      const rawStart = toWorld(e.clientX, e.clientY);
      const start = snapWallEndpoint(rawStart, existingWalls, poly, STEP);
      let current: FloorElement | null = null;
      const move = (ev: PointerEvent) => {
        const p = toWorld(ev.clientX, ev.clientY);
        const horizontal = Math.abs(p.x - start.x) >= Math.abs(p.y - start.y);
        const axisPoint = horizontal ? { x: p.x, y: start.y } : { x: start.x, y: p.y };
        const end = snapWallEndpoint(axisPoint, existingWalls, poly, STEP);
        if (horizontal) end.y = start.y;
        else end.x = start.x;
        current = wallFromEndpoints("rubber", start, end, 10);
        setRubber(current);
        const wallBox = elementBox(current);
        const hitsTable = draft.tables.some((t) => boxesOverlap(wallBox, tableBox(t)));
        setRubberBad(!wallInsideRoom(current, poly) || hitsTable);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        setRubber(null);
        setRubberBad(false);
        setTool("select");
        if (!current) return;
        const line = wallLine(current);
        if (Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) < STEP) return;
        const wall = { ...current, id: uid() };
        commit((d) => ({ ...d, layout: { ...d.layout, elements: [...d.layout.elements, wall] } }));
        setSelIds([wall.id]);
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }

    const s0 = toWorld(e.clientX, e.clientY);
    let box: FloorElement | null = null;
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const x = snapG(Math.min(s0.x, p.x)), y = snapG(Math.min(s0.y, p.y));
      const w = snapG(Math.abs(p.x - s0.x)), h = snapG(Math.abs(p.y - s0.y));
      box = {
        id: "rubber", kind: "decor", x, y,
        w: Math.max(w, 18), h: Math.max(h, 18), rotation: 0, label: "",
      };
      setRubber(box);
      setRubberBad(!boxFits(elementBox(box)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setRubber(null);
      setRubberBad(false);
      setTool("select");
      const b = box;
      if (!b || b.w * b.h < 900) return;
      const preset = DECOR_PRESETS.find((d) => d.icon === newDecor);
      const el: FloorElement = {
        ...b, id: uid(), label: preset?.label ?? "Arredo", icon: newDecor,
      };
      commit((d) => ({ ...d, layout: { ...d.layout, elements: [...d.layout.elements, el] } }));
      setSelIds([el.id]);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const patchTable = (id: string, p: Partial<TableNodeData>) =>
    commit((d) => ({ ...d, tables: d.tables.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  const patchEl = (id: string, p: Partial<FloorElement>) =>
    commit((d) => ({ ...d, layout: { ...d.layout, elements: d.layout.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) } }));

  const setWallThickness = (wall: FloorElement, value: number) => {
    const line = wallLine(wall);
    const thickness = Math.max(10, Math.round(value / 5) * 5);
    patchEl(wall.id, wallFromEndpoints(wall.id, line.a, line.b, thickness, wall.label));
  };

  const removeSel = useCallback(() => {
    if (!selIds.length) return;
    commit((d) => ({
      ...d,
      tables: d.tables.filter((t) => !selIds.includes(t.id)),
      deleted: [...d.deleted, ...selIds.filter((id) => boot.tables.some((t) => t.id === id))],
      layout: { ...d.layout, elements: d.layout.elements.filter((e) => !selIds.includes(e.id)) },
    }));
    setSelIds([]);
  }, [selIds, commit, boot.tables]);

  const setCapacity = (t: TableNodeData, cap: number) => {
    const c = clamp(cap, 1, 80);
    const nextMax = Math.max(c, t.maxCapacity ?? c);
    const existingUnits = t.shape === "rect" ? tableLengthUnits(t.width, std) : 1;
    const requiredUnits = tableUnits(Math.max(c, nextMax), std);
    const units = Math.max(existingUnits, requiredUnits);
    const shape = units > 1 ? "rect" : shapeForCapacity(c, t.shape, std);
    const g = tableGeometry(c, shape, std, units);
    patchTable(t.id, {
      capacity: c, maxCapacity: nextMax, shape,
      splitInto: shape === "rect" ? units : 0,
      width: g.width, height: g.height,
    });
  };

  const setMaxCapacity = (t: TableNodeData, max: number) => {
    const nextMax = clamp(max, t.capacity, 80);
    const existingUnits = t.shape === "rect" ? tableLengthUnits(t.width, std) : 1;
    const requiredUnits = tableUnits(nextMax, std);
    const units = Math.max(existingUnits, requiredUnits);
    const shape = units > 1 ? "rect" : t.shape;
    const g = tableGeometry(t.capacity, shape, std, units);
    patchTable(t.id, {
      maxCapacity: nextMax, shape,
      splitInto: shape === "rect" ? units : 0,
      width: g.width, height: g.height,
    });
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") { selIds.length ? setSelIds([]) : tool !== "select" ? setTool("select") : onClose(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selIds.length) { e.preventDefault(); removeSel(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelIds([...draft.tables.map((t) => t.id), ...draft.layout.elements.map((x) => x.id)]);
      }
      if (e.key.toLowerCase() === "v") pickTool("select");
      if (e.key.toLowerCase() === "t") pickTool("table");
      if (e.key.toLowerCase() === "m") pickTool("wall");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      const nudge = e.shiftKey ? STEP * 4 : STEP;
      const dir: Record<string, [number, number]> = {
        ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge],
      };
      if (selIds.length && dir[e.key]) {
        e.preventDefault();
        const [dx, dy] = dir[e.key];
        moveSelection(selIds, dx, dy);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const focusInvalid = () => {
    const id = [...invalidIds][0];
    if (!id) return;
    setSelIds([id]);
    const t = draft.tables.find((x) => x.id === id);
    const el = draft.layout.elements.find((x) => x.id === id);
    const box = t
      ? { x: t.x - t.width / 2, y: t.y - t.height / 2, w: t.width, h: t.height }
      : el ? { x: el.x, y: el.y, w: el.w, h: el.h } : null;
    if (box) revealRect(box, PANEL_H + 80);
  };

  const save = async () => {
    if (invalidIds.size) {
      toast({
        title: `${invalidIds.size} ${invalidIds.size === 1 ? "oggetto è fuori posto" : "oggetti sono fuori posto"}`,
        msg: "Sono segnati in rosso: rimettili dentro la sala, senza sovrapposizioni.",
        tone: "err",
        actionLabel: "Mostra",
        onAction: focusInvalid,
      });
      return;
    }
    setSaving(true);
    try {
      await api(`/api/rooms/${room.id}/floor`, {
        method: "PUT",
        body: { staffId: staff?.id, staffName: staff?.name, layout: draft.layout, tables: draft.tables, deleted: draft.deleted },
      });
      await qc.invalidateQueries({ queryKey: ["bootstrap"] });
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
            {invalidIds.size > 0
              ? <button onClick={focusInvalid} className="ml-1.5 font-bold text-over underline decoration-dotted">
                  · {invalidIds.size} fuori posto
                </button>
              : dirty && <span className="ml-1.5 text-brand">· non salvata</span>}
          </p>
        </div>
        <button onClick={undo} disabled={!past.length} className="grid h-12 w-12 place-items-center rounded-2xl bg-raised disabled:opacity-30 active:scale-95" aria-label="Annulla"><Undo2 className="h-5 w-5" /></button>
        <button onClick={redo} disabled={!future.length} className="hidden h-12 w-12 place-items-center rounded-2xl bg-raised disabled:opacity-30 active:scale-95 sm:grid" aria-label="Ripeti"><Redo2 className="h-5 w-5" /></button>
        <button onClick={save} disabled={saving}
          title={invalidIds.size ? "Ci sono oggetti fuori posto" : undefined}
          className={`flex h-12 items-center gap-2 rounded-2xl px-5 font-bold shadow active:scale-95 disabled:opacity-50 ${invalidIds.size ? "bg-raised text-muted" : "bg-brand text-on-brand"}`}>
          <Check className="h-5 w-5" /> Salva
        </button>
      </div>

      <div
        ref={ref}
        onPointerMove={bind.onPointerMove}
        onPointerUp={bind.onPointerUp}
        onPointerCancel={bind.onPointerCancel}
        onPointerDown={onCanvasDown}
        className={`floor-viewport relative flex-1 overflow-hidden bg-bg ${tool === "select" ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-crosshair"}`}
        style={{
          ...(bind.style as any),
          willChange: isPanning ? "transform" : undefined,
        }}
      >
        <GridBackdrop ref={gridRef} vp={vp} strong />
        <div ref={contentRef}
          className="floor-content absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate3d(${vp.panX}px, ${vp.panY}px, 0) scale(${vp.zoom})`,
            willChange: "transform",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden" as any,
            transformStyle: "preserve-3d",
            contain: "layout style paint",
          }}>
          <RoomShell w={draft.layout.w} h={draft.layout.h} polygon={draft.layout.polygon} />
          {marquee && (
            <div className="pointer-events-none absolute z-40 border-2 border-dashed border-brand bg-brand/10"
              style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
          )}
          <WallLayer
            elements={rubber?.kind === "wall" ? [...visibleElements, rubber] : visibleElements}
            roomW={draft.layout.w} roomH={draft.layout.h}
            invalidIds={new Set([
              ...invalidIds,
              ...(rubberBad && rubber?.kind === "wall" ? ["rubber"] : []),
            ])}
            selectedIds={new Set(selIds)} />
          <PerimeterOverlay w={draft.layout.w} h={draft.layout.h} polygon={draft.layout.polygon} />

          {[...draft.layout.elements]
            .sort((a, b) => Number(a.kind === "decor") - Number(b.kind === "decor"))
            .map((el) => (
            <ElementNode key={el.id} el={el} editable invalid={isBad(el.id)} selected={selIds.includes(el.id)}
              ref={(n) => { if (n) nodeRefs.current.set(el.id, n); }}
              onPointerDown={(e) => dragNode(e, el.id)}>
              {sel?.kind === "element" && sel.id === el.id && tool === "select" && (
                el.kind === "wall" ? (
                  (["a", "b"] as const).map((end) => {
                    const horizontal = el.w >= el.h;
                    const first = end === "a";
                    return (
                      <span key={end} onPointerDown={(e) => dragWallEndpoint(e, el, end)}
                        className="absolute z-30 rounded-sm border-[3px] border-brand bg-surface"
                        style={{
                          width: 24 / vp.zoom, height: 24 / vp.zoom,
                          left: `calc(${horizontal ? (first ? "0%" : "100%") : "50%"} - ${12 / vp.zoom}px)`,
                          top: `calc(${horizontal ? "50%" : (first ? "0%" : "100%")} - ${12 / vp.zoom}px)`,
                          cursor: horizontal ? "ew-resize" : "ns-resize",
                          touchAction: "none",
                        }} />
                    );
                  })
                ) : (
                  ([[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const).map(([hx, hy]) => (
                    <span key={`${hx}${hy}`} onPointerDown={(e) => resizeEl(e, el, hx, hy)}
                      className="absolute rounded-full border-[3px] border-brand bg-surface"
                      style={{
                        width: 26 / vp.zoom, height: 26 / vp.zoom,
                        left: `calc(${hx === -1 ? "0%" : hx === 1 ? "100%" : "50%"} - ${13 / vp.zoom}px)`,
                        top: `calc(${hy === -1 ? "0%" : hy === 1 ? "100%" : "50%"} - ${13 / vp.zoom}px)`,
                        cursor: rotatedCursor(hx, hy, el.rotation),
                        touchAction: "none",
                      }} />
                  ))
                )
              )}
            </ElementNode>
          ))}
          {rubber?.kind === "decor" && <ElementNode el={rubber} selected={!rubberBad} invalid={rubberBad} />}

          {draft.tables.map((t) => (
            <TableNode key={t.id} t={t} tone="border-busy/50"
              sub={`${t.capacity}${(t.maxCapacity ?? t.capacity) > t.capacity ? `-${t.maxCapacity}` : ""}p`}
              invalid={isBad(t.id)}
              seats={seatsByTable.get(t.id)}
              selected={selIds.includes(t.id)}
              ref={(n) => { if (n) nodeRefs.current.set(t.id, n); }}
              onPointerDown={(e) => dragNode(e, t.id)} />
          ))}

          {tool === "perimetro" && poly.map((p, i) => {
            const next = poly[(i + 1) % poly.length];
            const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
            const r = 30 / vp.zoom;
            return (
              <div key={i}>
                <span onPointerDown={(e) => dragCorner(e, i)} onDoubleClick={() => removeCorner(i)}
                  className="absolute cursor-move rounded-full border-[4px] border-brand bg-surface shadow"
                  style={{ width: r, height: r, left: p.x - r / 2, top: p.y - r / 2, touchAction: "none" as any }} />
                <span onPointerDown={(e) => { e.stopPropagation(); addCorner(i); }}
                  className="absolute grid cursor-copy place-items-center rounded-full bg-brand/85 text-on-brand"
                  style={{ width: r * 0.8, height: r * 0.8, left: mid.x - r * 0.4, top: mid.y - r * 0.4, fontSize: r * 0.5 }}>
                  +
                </span>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-4 right-3 flex flex-col gap-1.5" style={{ bottom: selIds.length ? PANEL_H + 16 : 16 }}>
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

      {decorPick && (
        <div className="absolute inset-x-0 z-20 flex justify-center px-3" style={{ bottom: `calc(env(safe-area-inset-bottom) + ${selIds.length ? PANEL_H + 84 : 84}px)` }}>
          <div className="grid max-w-md grid-cols-5 gap-1.5 rounded-3xl border border-line bg-surface p-2 shadow-2xl">
            {DECOR_PRESETS.map((d) => (
              <button key={d.icon} onClick={() => { setNewDecor(d.icon); setTool("decor"); setDecorPick(false); setSelIds([]); }}
                className={`min-h-[52px] rounded-2xl px-2 text-[12px] font-bold active:scale-95 ${newDecor === d.icon && tool === "decor" ? "bg-brand text-on-brand" : "bg-raised"}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-3"
        style={{ bottom: `calc(env(safe-area-inset-bottom) + ${selIds.length ? PANEL_H + 14 : 16}px)` }}>
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-3xl border border-line bg-surface/95 p-1.5 shadow-2xl backdrop-blur">
          <ToolBtn active={tool === "select"} onClick={() => pickTool("select")} icon={<MousePointer2 className="h-5 w-5" />} label="Sposta" />
          <div className="flex items-center gap-1 rounded-2xl bg-raised/60 p-1">
            {([[ "round", <CircleDot key="a" className="h-4 w-4" />], ["square", <Square key="b" className="h-4 w-4" />], ["rect", <RectangleHorizontal key="c" className="h-4 w-4" />]] as const).map(([sh, ic]) => (
              <button key={sh} onClick={() => { setNewShape(sh as TableShape); pickTool("table"); }}
                className={`grid h-11 w-11 place-items-center rounded-xl active:scale-95 ${tool === "table" && newShape === sh ? "bg-brand text-on-brand" : "bg-surface"}`}
                aria-label={`Tavolo ${sh === "round" ? "tondo" : sh === "square" ? "quadrato" : "rettangolare"}`}>
                {ic}
              </button>
            ))}
          </div>
          <ToolBtn active={tool === "wall"} onClick={() => pickTool("wall")} icon={<Wallpaper className="h-5 w-5" />} label="Muro" />
          <ToolBtn active={tool === "decor"} onClick={() => { setSelIds([]); setDecorPick((v) => !v); }} icon={<Blocks className="h-5 w-5" />} label="Arredo" />
          <ToolBtn active={tool === "perimetro"} onClick={() => pickTool("perimetro")} icon={<Spline className="h-5 w-5" />} label="Sala" />
        </div>
      </div>

      {selIds.length > 1 && (
        <ContextPanel onClose={() => setSelIds([])}
          title={`${selIds.length} oggetti selezionati`}
          subtitle="Trascinali insieme o spostali con le frecce">
          <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
            <button onClick={() => moveSelection(selIds, -STEP, 0)} className="h-12 rounded-xl bg-raised px-4 text-sm font-bold active:scale-95">←</button>
            <button onClick={() => moveSelection(selIds, STEP, 0)} className="h-12 rounded-xl bg-raised px-4 text-sm font-bold active:scale-95">→</button>
            <button onClick={() => moveSelection(selIds, 0, -STEP)} className="h-12 rounded-xl bg-raised px-4 text-sm font-bold active:scale-95">↑</button>
            <button onClick={() => moveSelection(selIds, 0, STEP)} className="h-12 rounded-xl bg-raised px-4 text-sm font-bold active:scale-95">↓</button>
            <button onClick={removeSel} className="ml-auto grid h-12 w-12 place-items-center rounded-xl bg-over/15 text-over active:scale-95" aria-label="Elimina selezione">
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </ContextPanel>
      )}

      {selTable && (
        <ContextPanel onClose={() => setSelIds([])} title={`Tavolo ${selTable.label}`}
          subtitle={`${selTable.capacity}${(selTable.maxCapacity ?? selTable.capacity) > selTable.capacity ? `-${selTable.maxCapacity}` : ""} coperti · ${Math.round(selTable.width)}×${Math.round(selTable.height)} cm`}>
          <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
            <input value={selTable.label} onChange={(e) => patchTable(selTable.id, { label: e.target.value.slice(0, 6) })}
              className="h-12 w-16 rounded-xl border border-line bg-bg text-center font-display text-lg font-extrabold outline-none focus:border-brand" aria-label="Numero tavolo" />
            <Spin label="Coperti" value={selTable.capacity} onMinus={() => setCapacity(selTable, selTable.capacity - 1)} onPlus={() => setCapacity(selTable, selTable.capacity + 1)} />
            <Spin label="Max sedie" value={selTable.maxCapacity ?? selTable.capacity}
              onMinus={() => setMaxCapacity(selTable, (selTable.maxCapacity ?? selTable.capacity) - 1)}
              onPlus={() => setMaxCapacity(selTable, (selTable.maxCapacity ?? selTable.capacity) + 1)} />
            <div className="flex h-12 items-center overflow-hidden rounded-xl bg-raised">
              <button onClick={() => patchTable(selTable.id, { rotation: (selTable.rotation + 345) % 360 })}
                aria-label="Ruota di 15 gradi in senso antiorario"
                className="grid h-12 w-11 place-items-center active:scale-95"><RotateCw className="h-4 w-4 -scale-x-100" /></button>
              <span className="px-1 text-[13px] font-bold tabular-nums">{selTable.rotation}°</span>
              <button onClick={() => patchTable(selTable.id, { rotation: (selTable.rotation + 15) % 360 })}
                aria-label="Ruota di 15 gradi in senso orario"
                className="grid h-12 w-11 place-items-center active:scale-95"><RotateCw className="h-4 w-4" /></button>
              <button onClick={() => patchTable(selTable.id, { rotation: (selTable.rotation + 90) % 360 })}
                className="h-12 border-l border-line px-3 text-sm font-bold active:scale-95">90°</button>
            </div>
            {([["round", "Tondo"], ["square", "Quadr."], ["rect", "Accostati"]] as const).map(([sh, lb]) => (
              <button key={sh} onClick={() => {
                const units = sh === "rect" ? tableLengthUnits(selTable.width, std) : 1;
                patchTable(selTable.id, {
                  shape: sh, ...tableGeometry(selTable.capacity, sh, std, Math.max(2, units)),
                  splitInto: sh === "rect" ? Math.max(2, units) : 0,
                });
              }}
                className={`h-12 rounded-xl px-3 text-sm font-bold active:scale-95 ${selTable.shape === sh ? "bg-brand text-on-brand" : "bg-raised"}`}>{lb}</button>
            ))}
            <button
              onClick={() => patchTable(selTable.id, { isJoinable: selTable.isJoinable === false })}
              title={selTable.isJoinable === false
                ? "Non si può accostare ad altri tavoli"
                : "Si può accostare ad altri tavoli"}
              aria-label="Attiva o disattiva accorpamento con altri tavoli"
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl active:scale-95 ${
                selTable.isJoinable === false ? "bg-over/10 text-over" : "bg-busy/10 text-busy"
              }`}>
              {selTable.isJoinable === false ? <Unlink className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
            </button>
            {selTable.shape !== "round" && selTable.width > unitTableSide(std) && (
              <button
                onClick={() => patchTable(selTable.id, {
                  splitInto: (selTable.splitInto ?? 0) >= 2
                    ? 0
                    : Math.max(2, tableLengthUnits(selTable.width, std)),
                })}
                title={(selTable.splitInto ?? 0) >= 2
                  ? `Staccabile in ${selTable.splitInto} tavoli da ${std}`
                  : "Tavolo unico, non staccabile"}
                aria-label="Attiva o disattiva tavolo staccabile"
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl active:scale-95 ${
                  (selTable.splitInto ?? 0) >= 2 ? "bg-ok/15 text-ok" : "bg-raised text-muted"
                }`}>
                <Scissors className="h-5 w-5" />
              </button>
            )}
            <button onClick={removeSel} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-over/15 text-over active:scale-95" aria-label="Elimina tavolo"><Trash2 className="h-5 w-5" /></button>
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
        <ContextPanel onClose={() => setSelIds([])} title={selEl.kind === "wall" ? "Muro" : "Arredo"}
          subtitle={selEl.kind === "wall"
            ? `${Math.round(Math.max(selEl.w, selEl.h))} cm di lunghezza · ${Math.round(Math.min(selEl.w, selEl.h))} cm di spessore`
            : `${Math.round(selEl.w)}×${Math.round(selEl.h)} cm${selEl.rotation ? ` · ruotato ${selEl.rotation}°` : ""}`}>
          <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
            {selEl.kind === "wall" ? (
              <>
                <Spin label="Spessore" value={Math.round(Math.min(selEl.w, selEl.h))}
                  onMinus={() => setWallThickness(selEl, Math.min(selEl.w, selEl.h) - 5)}
                  onPlus={() => setWallThickness(selEl, Math.min(selEl.w, selEl.h) + 5)} />
                <span className="text-[12px] font-medium text-muted">10, 15, 20… cm</span>
              </>
            ) : (
              <>
                <input value={selEl.label}
                  onChange={(e) => patchEl(selEl.id, { label: e.target.value.slice(0, 28), icon: iconFromLabel(e.target.value, selEl.icon) })}
                  placeholder="Nome arredo"
                  title="Nome arredo"
                  className="h-11 w-[180px] shrink-0 rounded-xl border border-line bg-bg px-3 text-sm font-semibold outline-none focus:border-brand" />
                <select value={selEl.icon ?? "generico"} title="Tipo di arredo"
                  onChange={(e) => patchEl(selEl.id, { icon: e.target.value as DecorIcon })}
                  className="h-11 w-[105px] shrink-0 rounded-xl border border-line bg-bg px-2 text-xs font-bold outline-none focus:border-brand">
                  {DECOR_PRESETS.map((d) => <option key={d.icon} value={d.icon}>{d.label}</option>)}
                  <option value="generico">Altro</option>
                </select>

                <div className="flex h-11 shrink-0 items-center gap-1 rounded-xl bg-raised px-1.5" title="Sfumatura arredo">
                  {DECOR_TONES.map((tone) => (
                    <button key={tone.id} onClick={() => patchEl(selEl.id, { tone: tone.id as DecorTone })}
                      aria-label={`Colore ${tone.label}`}
                      className={`h-7 w-7 rounded-full border-2 active:scale-90 ${(selEl.tone ?? "neutro") === tone.id ? "border-brand ring-1 ring-brand" : "border-surface"}`}
                      style={{ backgroundColor: tone.fill }} />
                  ))}
                </div>

                <button onClick={() => patchEl(selEl.id, { rotation: (selEl.rotation + 90) % 360 })}
                  title="Ruota oggetto di 90°" aria-label="Ruota oggetto di 90 gradi"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-raised active:scale-95">
                  <RotateCw className="h-4 w-4" />
                </button>
                <button onClick={() => patchEl(selEl.id, { rotation: (selEl.rotation + 15) % 360 })}
                  title="Ruota oggetto di 15°" aria-label="Ruota oggetto di 15 gradi"
                  className="h-11 w-11 shrink-0 rounded-xl bg-raised text-xs font-bold active:scale-95">+15°</button>
                {selEl.label && (
                  <>
                    <button onClick={() => patchEl(selEl.id, { labelRotation: ((selEl.labelRotation ?? 0) + 90) % 360 })}
                      title="Ruota il nome di 90°" aria-label="Ruota il nome di 90 gradi"
                      className="h-11 w-11 shrink-0 rounded-xl bg-raised text-xs font-bold active:scale-95">A↻</button>
                    <button onClick={() => patchEl(selEl.id, { labelScale: clamp((selEl.labelScale ?? 1) - 0.1, 0.6, 1.5) })}
                      title="Riduci il nome" aria-label="Riduci il nome"
                      className="h-11 w-11 shrink-0 rounded-xl bg-raised text-xs font-bold active:scale-95">A−</button>
                    <button onClick={() => patchEl(selEl.id, { labelScale: clamp((selEl.labelScale ?? 1) + 0.1, 0.6, 1.5) })}
                      title="Ingrandisci il nome" aria-label="Ingrandisci il nome"
                      className="h-11 w-11 shrink-0 rounded-xl bg-raised text-sm font-bold active:scale-95">A+</button>
                  </>
                )}
              </>
            )}
            <button onClick={removeSel} className="grid h-12 w-12 place-items-center rounded-xl bg-over/15 text-over active:scale-95" aria-label="Elimina">
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </ContextPanel>
      )}
    </div>
  );
}

function rotatedCursor(hx: -1 | 0 | 1, hy: -1 | 0 | 1, rotation: number): string {
  const base = Math.atan2(hy, hx) * (180 / Math.PI);
  const angle = ((base + rotation) % 180 + 180) % 180;
  if (angle < 22.5 || angle >= 157.5) return "ew-resize";
  if (angle < 67.5) return "nwse-resize";
  if (angle < 112.5) return "ns-resize";
  return "nesw-resize";
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

function ContextPanel({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <div className="pointer-events-auto w-[calc(100vw-1rem)] animate-sheet-up rounded-2xl border border-line bg-surface/97 p-2.5 shadow-2xl backdrop-blur sm:w-fit sm:min-w-[300px] sm:max-w-[calc(100vw-2rem)]">
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
  splitInto: t.splitInto,
  isJoinable: t.isJoinable,
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
