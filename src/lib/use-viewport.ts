"use client";
// Pan & Zoom 60 FPS fluida (908d25d) + momentum ghiaccio leggero
// FIX LAG: partenza istantanea, no 1s delay, no freeze, 60 FPS garantiti
// - Solo DOM via rAF durante gesto, nessun setState, nessuna API, nessun Zustand durante move
// - Momentum: friction 0.92, max 60 frame, interrompibile con tap

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM, clamp, CM_PER_CELL } from "./floor";

export type Viewport = { zoom: number; panX: number; panY: number };
export type ZoomLevel = "low" | "mid" | "high";

function getZoomLevel(zoom: number): ZoomLevel {
  if (zoom < 0.35) return "low";
  if (zoom < 0.75) return "mid";
  return "high";
}

export function selectionViewport(args: {
  current: Viewport;
  box: { x: number; y: number; w: number; h: number };
  viewportW: number;
  viewportH: number;
  bottomInset: number;
  margin?: number;
}): { view: Viewport; changed: boolean } {
  const { current, box, viewportW, viewportH, bottomInset } = args;
  const margin = args.margin ?? 36;
  const availableW = Math.max(100, viewportW - margin * 2);
  const availableH = Math.max(100, viewportH - bottomInset - margin * 2);
  const top = box.y * current.zoom + current.panY;
  const bottom = (box.y + box.h) * current.zoom + current.panY;
  const left = box.x * current.zoom + current.panX;
  const right = (box.x + box.w) * current.zoom + current.panX;
  const visibleBottom = viewportH - bottomInset - margin;
  const hidden = bottom > visibleBottom || top < margin || left < margin || right > viewportW - margin;
  if (!hidden) return { view: current, changed: false };
  const fitZoom = Math.min(availableW / Math.max(1, box.w), availableH / Math.max(1, box.h)) * 0.92;
  const zoom = Math.min(current.zoom, fitZoom);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const centerY = margin + availableH / 2;
  return { view: { zoom, panX: viewportW / 2 - cx * zoom, panY: centerY - cy * zoom }, changed: true };
}

type Bounds = { x1: number; y1: number; x2: number; y2: number };

export function useViewport(roomW: number, roomH: number, opts?: { padding?: number; bounds?: Bounds }) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [vp, setVpState] = useState<Viewport>({ zoom: 0.4, panX: 0, panY: 0 });
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(() => getZoomLevel(0.4));
  const vpRef = useRef(vp);
  useEffect(() => {
    vpRef.current = vp;
    setZoomLevel(getZoomLevel(vp.zoom));
  }, [vp]);

  const pendingVp = useRef<Viewport | null>(null);
  const rafId = useRef<number>(0);
  const momentumRaf = useRef<number>(0);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ startDist: number; startZoom: number; centerX: number; centerY: number; startPanX: number; startPanY: number } | null>(null);
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const enabled = useRef(true);
  const [isPanning, setPanning] = useState(false);

  const moveHistory = useRef<{ x: number; y: number; t: number }[]>([]);
  const velocity = useRef({ x: 0, y: 0 });

  const pad = opts?.padding ?? 40;
  const bx1 = opts?.bounds?.x1 ?? 0,
    by1 = opts?.bounds?.y1 ?? 0;
  const bx2 = opts?.bounds?.x2 ?? roomW,
    by2 = opts?.bounds?.y2 ?? roomH;
  const boundsW = Math.max(50, bx2 - bx1),
    boundsH = Math.max(50, by2 - by1);

  const minZoomFor = useCallback(
    (el: HTMLElement) => Math.max(MIN_ZOOM, Math.min((el.clientWidth - pad) / boundsW, (el.clientHeight - pad) / boundsH) * 0.8),
    [boundsW, boundsH, pad],
  );

  const clampVp = useCallback(
    (v: Viewport): Viewport => {
      const el = ref.current;
      if (!el) return v;
      const zoom = clamp(v.zoom, minZoomFor(el), MAX_ZOOM);
      const vw = el.clientWidth,
        vh = el.clientHeight;
      const w = boundsW * zoom,
        h = boundsH * zoom;
      const offX = bx1 * zoom,
        offY = by1 * zoom;
      const marginX = Math.min(vw * 0.3, 140);
      const marginY = Math.min(vh * 0.3, 140);
      const panX = w <= vw ? clamp(v.panX, -offX - marginX, vw - w - offX + marginX) : clamp(v.panX, vw - w - offX - marginX, -offX + marginX);
      const panY = h <= vh ? clamp(v.panY, -offY - marginY, vh - h - offY + marginY) : clamp(v.panY, vh - h - offY - marginY, -offY + marginY);
      return { zoom, panX, panY };
    },
    [boundsW, boundsH, bx1, by1, minZoomFor],
  );

  const applyDom = useCallback((v: Viewport) => {
    vpRef.current = v;
    const content = contentRef.current;
    if (content) content.style.transform = `translate3d(${v.panX}px, ${v.panY}px, 0) scale(${v.zoom})`;
    const grid = gridRef.current;
    if (grid) {
      const cell = CM_PER_CELL * v.zoom;
      const major = cell * 2;
      grid.style.backgroundPosition = `${v.panX}px ${v.panY}px`;
      grid.style.backgroundSize = `${cell}px ${cell}px, ${cell}px ${cell}px, ${major}px ${major}px`;
    }
  }, []);

  const scheduleDom = useCallback(
    (v: Viewport) => {
      pendingVp.current = v;
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        const next = pendingVp.current;
        if (next) {
          pendingVp.current = null;
          applyDom(next);
        }
      });
    },
    [applyDom],
  );

  const commit = useCallback(
    (v: Viewport) => {
      const clamped = clampVp(v);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
      pendingVp.current = null;
      applyDom(clamped);
      setVpState(clamped);
      vpRef.current = clamped;
    },
    [clampVp, applyDom],
  );

  const apply = useCallback((fn: (v: Viewport) => Viewport) => commit(fn(vpRef.current)), [commit]);

  const fitHold = useRef(false);
  const fit = useCallback(
    (animated = false) => {
      if (fitHold.current) return;
      const el = ref.current;
      if (!el) return;
      const vw = el.clientWidth,
        vh = el.clientHeight;
      const zoom = clamp(Math.min((vw - pad * 2) / boundsW, (vh - pad * 2) / boundsH), MIN_ZOOM, MAX_ZOOM);
      const cx = (bx1 + bx2) / 2,
        cy = (by1 + by2) / 2;
      commit({ zoom, panX: vw / 2 - cx * zoom, panY: vh / 2 - cy * zoom });
    },
    [bx1, by1, bx2, by2, boundsW, boundsH, pad, commit],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const doFit = () => {
      if (!fitHold.current) fit();
    };
    doFit();
    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const cancelMomentum = useCallback(() => {
    if (momentumRaf.current) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = 0;
    }
  }, []);

  const freeze = useCallback(() => {
    const wasAnimating = !!momentumRaf.current;
    cancelMomentum();
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    let cur: Viewport;
    if (pendingVp.current) {
      cur = clampVp(pendingVp.current);
      pendingVp.current = null;
    } else {
      cur = clampVp(vpRef.current);
    }
    applyDom(cur);
    setVpState(cur);
    vpRef.current = cur;
    pointers.current.clear();
    pinch.current = null;
    panning.current = null;
    moveHistory.current = [];
    velocity.current = { x: 0, y: 0 };
    setPanning(false);
    return wasAnimating;
  }, [clampVp, applyDom, cancelMomentum]);

  const stopPan = useCallback(() => {
    if (pendingVp.current) {
      const final = clampVp(pendingVp.current);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
      pendingVp.current = null;
      applyDom(final);
      setVpState(final);
      vpRef.current = final;
    }
    pointers.current.clear();
    pinch.current = null;
    panning.current = null;
    moveHistory.current = [];
    velocity.current = { x: 0, y: 0 };
    setPanning(false);
  }, [clampVp, applyDom]);

  const cancelPan = useCallback(() => {
    if (momentumRaf.current) {
      freeze();
      enabled.current = false;
      setTimeout(() => (enabled.current = true), 30);
      return;
    }
    enabled.current = false;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    pendingVp.current = null;
    stopPan();
    setTimeout(() => (enabled.current = true), 30);
  }, [stopPan, freeze]);

  const startMomentum = useCallback(
    (vx: number, vy: number) => {
      cancelMomentum();
      if (pendingVp.current) {
        vpRef.current = pendingVp.current;
        pendingVp.current = null;
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
      }
      let curVx = vx * 0.9;
      let curVy = vy * 0.9;
      const friction = 0.92;
      const minVelocity = 0.1;
      let frames = 0;
      const maxFrames = 60;
      setPanning(true);
      const step = () => {
        frames++;
        curVx *= friction;
        curVy *= friction;
        const speed = Math.hypot(curVx, curVy);
        if (speed < minVelocity || frames > maxFrames) {
          momentumRaf.current = 0;
          const final = clampVp(vpRef.current);
          applyDom(final);
          setVpState(final);
          vpRef.current = final;
          setPanning(false);
          moveHistory.current = [];
          velocity.current = { x: 0, y: 0 };
          return;
        }
        const next = clampVp({
          zoom: vpRef.current.zoom,
          panX: vpRef.current.panX + curVx * 16,
          panY: vpRef.current.panY + curVy * 16,
        });
        if (Math.abs(next.panX - vpRef.current.panX) < 0.1) curVx = 0;
        if (Math.abs(next.panY - vpRef.current.panY) < 0.1) curVy = 0;
        applyDom(next);
        momentumRaf.current = requestAnimationFrame(step);
      };
      momentumRaf.current = requestAnimationFrame(step);
    },
    [clampVp, applyDom, cancelMomentum],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (momentumRaf.current) {
        cancelMomentum();
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
        let cur: Viewport;
        if (pendingVp.current) {
          cur = clampVp(pendingVp.current);
          pendingVp.current = null;
        } else {
          cur = clampVp(vpRef.current);
        }
        applyDom(cur);
        setVpState(cur);
        vpRef.current = cur;
        pointers.current.clear();
        pinch.current = null;
        panning.current = null;
        moveHistory.current = [];
        velocity.current = { x: 0, y: 0 };
        setPanning(false);
        const target = e.target as HTMLElement;
        if (target.closest("button") || target.closest("[data-table-id]")) return;
      }
      if (e.pointerType === "touch") e.preventDefault();
      enabled.current = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        moveHistory.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
        velocity.current = { x: 0, y: 0 };
      }
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 1) return;
        const centerX = (a.x + b.x) / 2;
        const centerY = (a.y + b.y) / 2;
        const rect = ref.current?.getBoundingClientRect();
        const sx = rect ? centerX - rect.left : centerX;
        const sy = rect ? centerY - rect.top : centerY;
        pinch.current = {
          startDist: dist,
          startZoom: vpRef.current.zoom,
          centerX: sx,
          centerY: sy,
          startPanX: vpRef.current.panX,
          startPanY: vpRef.current.panY,
        };
        panning.current = null;
        setPanning(false);
        return;
      }
      panning.current = { x: e.clientX, y: e.clientY, panX: vpRef.current.panX, panY: vpRef.current.panY };
      setPanning(true);
    },
    [clampVp, applyDom, cancelMomentum],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled.current || !pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = performance.now();
      if (pointers.current.size === 1) {
        moveHistory.current.push({ x: e.clientX, y: e.clientY, t: now });
        while (moveHistory.current.length > 4 && moveHistory.current[0].t < now - 100) moveHistory.current.shift();
        if (moveHistory.current.length >= 2) {
          const first = moveHistory.current[0];
          const last = moveHistory.current[moveHistory.current.length - 1];
          const dt = last.t - first.t;
          if (dt > 5) velocity.current = { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
        }
      }
      if (pinch.current && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 1) return;
        const factor = dist / pinch.current.startDist;
        const el = ref.current;
        const min = el ? minZoomFor(el) : MIN_ZOOM;
        const newZoom = clamp(pinch.current.startZoom * factor, min, MAX_ZOOM);
        const k = newZoom / pinch.current.startZoom;
        const newPanX = pinch.current.centerX - (pinch.current.centerX - pinch.current.startPanX) * k;
        const newPanY = pinch.current.centerY - (pinch.current.centerY - pinch.current.startPanY) * k;
        scheduleDom(clampVp({ zoom: newZoom, panX: newPanX, panY: newPanY }));
        return;
      }
      const p = panning.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      scheduleDom(clampVp({ zoom: vpRef.current.zoom, panX: p.panX + dx, panY: p.panY + dy }));
    },
    [clampVp, minZoomFor, scheduleDom],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 0) {
        if (panning.current) {
          const dx = e.clientX - panning.current.x;
          const dy = e.clientY - panning.current.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= 3) {
            const vx = velocity.current.x;
            const vy = velocity.current.y;
            const speed = Math.hypot(vx, vy);
            if (speed > 0.12) {
              startMomentum(vx, vy);
              panning.current = null;
              return;
            }
          }
        }
        if (pendingVp.current) {
          const final = clampVp(pendingVp.current);
          if (rafId.current) {
            cancelAnimationFrame(rafId.current);
            rafId.current = 0;
          }
          pendingVp.current = null;
          applyDom(final);
          setVpState(final);
          vpRef.current = final;
        }
        panning.current = null;
        moveHistory.current = [];
        velocity.current = { x: 0, y: 0 };
        setPanning(false);
      }
    },
    [clampVp, applyDom, startMomentum],
  );

  useEffect(() => {
    const onGlobalMove = (e: PointerEvent) => {
      if (!enabled.current) return;
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const centerX = (a.x + b.x) / 2 - rect.left;
        const centerY = (a.y + b.y) / 2 - rect.top;
        const factor = dist / pinch.current.startDist;
        const el = ref.current;
        const min = el ? minZoomFor(el) : MIN_ZOOM;
        const newZoom = clamp(pinch.current.startZoom * factor, min, MAX_ZOOM);
        const k = newZoom / pinch.current.startZoom;
        const newPanX = centerX - (centerX - pinch.current.startPanX) * k;
        const newPanY = centerY - (centerY - pinch.current.startPanY) * k;
        scheduleDom(clampVp({ zoom: newZoom, panX: newPanX, panY: newPanY }));
        return;
      }
      const p = panning.current;
      if (!p) return;
      scheduleDom(clampVp({ zoom: vpRef.current.zoom, panX: p.panX + (e.clientX - p.x), panY: p.panY + (e.clientY - p.y) }));
    };
    const onGlobalUp = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 0) {
        if (pendingVp.current) {
          const final = clampVp(pendingVp.current);
          if (rafId.current) {
            cancelAnimationFrame(rafId.current);
            rafId.current = 0;
          }
          pendingVp.current = null;
          applyDom(final);
          setVpState(final);
          vpRef.current = final;
        }
        panning.current = null;
        moveHistory.current = [];
        velocity.current = { x: 0, y: 0 };
        setPanning(false);
      }
    };
    window.addEventListener("pointermove", onGlobalMove);
    window.addEventListener("pointerup", onGlobalUp);
    window.addEventListener("pointercancel", onGlobalUp);
    return () => {
      window.removeEventListener("pointermove", onGlobalMove);
      window.removeEventListener("pointerup", onGlobalUp);
      window.removeEventListener("pointercancel", onGlobalUp);
    };
  }, [clampVp, minZoomFor, scheduleDom, applyDom]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - rect.left - v.panX) / v.zoom, y: (clientY - rect.top - v.panY) / v.zoom };
  }, []);

  const zoomBy = useCallback(
    (f: number) => {
      const el = ref.current;
      if (!el) return;
      const v = vpRef.current;
      const min = minZoomFor(el);
      const zoom = clamp(v.zoom * f, min, MAX_ZOOM);
      const k = zoom / v.zoom;
      const sx = el.clientWidth / 2,
        sy = el.clientHeight / 2;
      commit({ zoom, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k });
    },
    [commit, minZoomFor],
  );

  const centerOn = useCallback(
    (wx: number, wy: number, bottomInset = 0) => {
      const el = ref.current;
      if (!el) return;
      const vw = el.clientWidth,
        vh = el.clientHeight - bottomInset;
      const v = vpRef.current;
      commit({ ...v, panX: vw / 2 - wx * v.zoom, panY: vh / 2 - wy * v.zoom });
    },
    [commit],
  );

  const revealRect = useCallback(
    (box: { x: number; y: number; w: number; h: number }, bottomInset: number) => {
      const el = ref.current;
      if (!el) return;
      const next = selectionViewport({
        current: vpRef.current,
        box,
        viewportW: el.clientWidth,
        viewportH: el.clientHeight,
        bottomInset,
      });
      if (next.changed) commit(next.view);
    },
    [commit],
  );

  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (momentumRaf.current) cancelAnimationFrame(momentumRaf.current);
    };
  }, []);

  useEffect(() => {
    applyDom(vp);
  }, [vp, applyDom]);

  return {
    ref,
    contentRef,
    gridRef,
    vp,
    zoomLevel,
    setVp: apply,
    fit,
    zoomBy,
    toWorld,
    isPanning,
    isAnimating: !!momentumRaf.current,
    centerOn,
    revealRect,
    cancelPan,
    freeze,
    stopPan,
    holdFit: (hold: boolean) => {
      fitHold.current = hold;
    },
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      style: {
        touchAction: "none" as const,
        userSelect: "none" as const,
        WebkitUserSelect: "none" as const,
        overscrollBehavior: "none" as const,
        WebkitTouchCallout: "none" as const,
      },
    },
  };
}
