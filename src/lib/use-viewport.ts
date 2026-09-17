"use client";
// NUOVA LOGICA NAVIGAZIONE MAPPA DA ZERO - iOS SAFE 120 FPS
// - Niente pointer capture, niente global listeners, niente ResizeObserver loop
// - Solo touch/mouse locali, rAF singolo, transform GPU diretto
// - Cache size, no layout thrashing durante move
// - Tap 8px/350ms, momentum friction 0.92 max 60 frame, freeze su tap

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM, clamp, CM_PER_CELL } from "./floor";

export type Viewport = { zoom: number; panX: number; panY: number };
export type ZoomLevel = "low" | "mid" | "high";
function zl(z: number): ZoomLevel {
  if (z < 0.35) return "low";
  if (z < 0.75) return "mid";
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
  const m = args.margin ?? 36;
  const aw = Math.max(100, viewportW - m * 2);
  const ah = Math.max(100, viewportH - bottomInset - m * 2);
  const top = box.y * current.zoom + current.panY;
  const bottom = (box.y + box.h) * current.zoom + current.panY;
  const left = box.x * current.zoom + current.panX;
  const right = (box.x + box.w) * current.zoom + current.panX;
  const vb = viewportH - bottomInset - m;
  const hidden = bottom > vb || top < m || left < m || right > viewportW - m;
  if (!hidden) return { view: current, changed: false };
  const fz = Math.min(aw / Math.max(1, box.w), ah / Math.max(1, box.h)) * 0.92;
  const zoom = Math.min(current.zoom, fz);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const cy2 = m + ah / 2;
  return { view: { zoom, panX: viewportW / 2 - cx * zoom, panY: cy2 - cy * zoom }, changed: true };
}

type Bounds = { x1: number; y1: number; x2: number; y2: number };

export function useViewport(roomW: number, roomH: number, opts?: { padding?: number; bounds?: Bounds }) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [vp, setVp] = useState<Viewport>({ zoom: 0.4, panX: 0, panY: 0 });
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("mid");
  const vpRef = useRef(vp);
  const sizeRef = useRef({ w: 0, h: 0, minZoom: MIN_ZOOM });
  const rectRef = useRef({ left: 0, top: 0 });

  const rafId = useRef(0);
  const pending = useRef<Viewport | null>(null);
  const momentumId = useRef(0);

  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinchStart = useRef<{ dist: number; zoom: number; panX: number; panY: number; cx: number; cy: number } | null>(null);
  const hist = useRef<{ x: number; y: number; t: number }[]>([]);
  const vel = useRef({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const isMouseDown = useRef(false);

  const pad = opts?.padding ?? 40;
  const bx1 = opts?.bounds?.x1 ?? 0;
  const by1 = opts?.bounds?.y1 ?? 0;
  const bx2 = opts?.bounds?.x2 ?? roomW;
  const by2 = opts?.bounds?.y2 ?? roomH;
  const bw = Math.max(50, bx2 - bx1);
  const bh = Math.max(50, by2 - by1);

  const refreshSize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w < 10 || h < 10) return;
    const mz = Math.max(MIN_ZOOM, Math.min((w - pad) / bw, (h - pad) / bh) * 0.8);
    sizeRef.current = { w, h, minZoom: mz };
    const r = el.getBoundingClientRect();
    rectRef.current = { left: r.left, top: r.top };
  }, [bw, bh, pad]);

  const clampVp = useCallback(
    (v: Viewport): Viewport => {
      const { w, h, minZoom } = sizeRef.current;
      if (w < 10 || h < 10) return v;
      const zoom = clamp(v.zoom, minZoom, MAX_ZOOM);
      const rw = bw * zoom;
      const rh = bh * zoom;
      const ox = bx1 * zoom;
      const oy = by1 * zoom;
      const mx = Math.min(w * 0.35, 160);
      const my = Math.min(h * 0.35, 160);
      const panX = rw <= w ? clamp(v.panX, -ox - mx, w - rw - ox + mx) : clamp(v.panX, w - rw - ox - mx, -ox + mx);
      const panY = rh <= h ? clamp(v.panY, -oy - my, h - rh - oy + my) : clamp(v.panY, h - rh - oy - my, -oy + my);
      return { zoom, panX, panY };
    },
    [bw, bh, bx1, by1],
  );

  const applyDom = useCallback((v: Viewport) => {
    vpRef.current = v;
    const c = contentRef.current;
    if (c) c.style.transform = `translate3d(${v.panX}px,${v.panY}px,0) scale(${v.zoom})`;
    const g = gridRef.current;
    if (g) {
      const cell = CM_PER_CELL * v.zoom;
      g.style.backgroundPosition = `${v.panX}px ${v.panY}px`;
      g.style.backgroundSize = `${cell}px ${cell}px, ${cell}px ${cell}px, ${cell * 2}px ${cell * 2}px`;
    }
  }, []);

  const schedule = useCallback(
    (v: Viewport) => {
      pending.current = v;
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        const n = pending.current;
        if (n) {
          pending.current = null;
          applyDom(n);
        }
      });
    },
    [applyDom],
  );

  const commit = useCallback(
    (v: Viewport) => {
      const cl = clampVp(v);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
      pending.current = null;
      applyDom(cl);
      setVp(cl);
      vpRef.current = cl;
      setZoomLevel(zl(cl.zoom));
    },
    [clampVp, applyDom],
  );

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w < 10 || h < 10) return;
    const mz = Math.max(MIN_ZOOM, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh) * 0.8);
    sizeRef.current = { w, h, minZoom: mz };
    const r = el.getBoundingClientRect();
    rectRef.current = { left: r.left, top: r.top };
    const zoom = clamp(Math.min((w - pad * 2) / bw, (h - pad * 2) / bh), MIN_ZOOM, MAX_ZOOM);
    const cx = (bx1 + bx2) / 2;
    const cy = (by1 + by2) / 2;
    commit({ zoom, panX: w / 2 - cx * zoom, panY: h / 2 - cy * zoom });
  }, [bx1, bx2, by1, by2, bw, bh, pad, commit]);

  // mount
  useEffect(() => {
    refreshSize();
    fit();
    const onResize = () => {
      if (panStart.current || momentumId.current) return;
      refreshSize();
      fit();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (momentumId.current) cancelAnimationFrame(momentumId.current);
    };
  }, [fit, refreshSize]);

  // room change -> fit
  useEffect(() => {
    fit();
  }, [roomW, roomH, bx1, by1, bx2, by2]);

  const cancelMomentum = useCallback(() => {
    if (momentumId.current) {
      cancelAnimationFrame(momentumId.current);
      momentumId.current = 0;
    }
  }, []);

  const freeze = useCallback(() => {
    const was = !!momentumId.current;
    cancelMomentum();
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    const cur = pending.current ? clampVp(pending.current) : clampVp(vpRef.current);
    pending.current = null;
    applyDom(cur);
    setVp(cur);
    vpRef.current = cur;
    panStart.current = null;
    pinchStart.current = null;
    hist.current = [];
    vel.current = { x: 0, y: 0 };
    setIsPanning(false);
    isMouseDown.current = false;
    return was;
  }, [clampVp, applyDom, cancelMomentum]);

  const cancelPan = useCallback(() => {
    if (momentumId.current) {
      freeze();
      return;
    }
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    pending.current = null;
    applyDom(vpRef.current);
    panStart.current = null;
    pinchStart.current = null;
    hist.current = [];
    vel.current = { x: 0, y: 0 };
    setIsPanning(false);
    isMouseDown.current = false;
  }, [freeze, applyDom]);

  const startMomentum = useCallback(
    (vx: number, vy: number) => {
      cancelMomentum();
      if (pending.current) {
        vpRef.current = pending.current;
        pending.current = null;
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
      }
      let cx = vx * 0.85;
      let cy = vy * 0.85;
      const friction = 0.92;
      let frames = 0;
      setIsPanning(true);
      const step = () => {
        frames++;
        cx *= friction;
        cy *= friction;
        const sp = Math.hypot(cx, cy);
        if (sp < 0.08 || frames > 60) {
          momentumId.current = 0;
          const fin = clampVp(vpRef.current);
          applyDom(fin);
          setVp(fin);
          vpRef.current = fin;
          setIsPanning(false);
          hist.current = [];
          vel.current = { x: 0, y: 0 };
          return;
        }
        const nxt = clampVp({
          zoom: vpRef.current.zoom,
          panX: vpRef.current.panX + cx * 16,
          panY: vpRef.current.panY + cy * 16,
        });
        if (Math.abs(nxt.panX - vpRef.current.panX) < 0.05) cx = 0;
        if (Math.abs(nxt.panY - vpRef.current.panY) < 0.05) cy = 0;
        applyDom(nxt);
        momentumId.current = requestAnimationFrame(step);
      };
      momentumId.current = requestAnimationFrame(step);
    },
    [clampVp, applyDom, cancelMomentum],
  );

  // TOUCH
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest("[data-table-id]")) return;
      if (momentumId.current) {
        const cur = pending.current ? clampVp(pending.current) : clampVp(vpRef.current);
        pending.current = null;
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
        cancelMomentum();
        applyDom(cur);
        setVp(cur);
        vpRef.current = cur;
        setIsPanning(false);
        if (t.closest("button") || t.closest("[data-table-id]")) return;
      }
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        refreshSize();
        hist.current = [{ x: touch.clientX, y: touch.clientY, t: performance.now() }];
        vel.current = { x: 0, y: 0 };
        panStart.current = { x: touch.clientX, y: touch.clientY, panX: vpRef.current.panX, panY: vpRef.current.panY };
        setIsPanning(true);
      } else if (e.touches.length === 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        const dist = Math.hypot(dx, dy);
        if (dist < 5) return;
        const cx = (a.clientX + b.clientX) / 2 - rectRef.current.left;
        const cy = (a.clientY + b.clientY) / 2 - rectRef.current.top;
        pinchStart.current = { dist, zoom: vpRef.current.zoom, panX: vpRef.current.panX, panY: vpRef.current.panY, cx, cy };
        panStart.current = null;
        setIsPanning(true);
      }
    },
    [clampVp, applyDom, cancelMomentum, refreshSize],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 0) return;
      if (panStart.current == null && pinchStart.current == null) return;
      e.preventDefault();
      const now = performance.now();
      if (e.touches.length === 1 && panStart.current) {
        const touch = e.touches[0];
        hist.current.push({ x: touch.clientX, y: touch.clientY, t: now });
        while (hist.current.length > 4 && hist.current[0].t < now - 100) hist.current.shift();
        if (hist.current.length >= 2) {
          const f = hist.current[0];
          const l = hist.current[hist.current.length - 1];
          const dt = l.t - f.t;
          if (dt > 5) vel.current = { x: (l.x - f.x) / dt, y: (l.y - f.y) / dt };
        }
        const dx = touch.clientX - panStart.current.x;
        const dy = touch.clientY - panStart.current.y;
        if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
        schedule(clampVp({ zoom: vpRef.current.zoom, panX: panStart.current.panX + dx, panY: panStart.current.panY + dy }));
      } else if (e.touches.length === 2 && pinchStart.current) {
        const a = e.touches[0];
        const b = e.touches[1];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (dist < 5) return;
        const factor = dist / pinchStart.current.dist;
        const mz = sizeRef.current.minZoom || MIN_ZOOM;
        const nz = clamp(pinchStart.current.zoom * factor, mz, MAX_ZOOM);
        const k = nz / pinchStart.current.zoom;
        const nx = pinchStart.current.cx - (pinchStart.current.cx - pinchStart.current.panX) * k;
        const ny = pinchStart.current.cy - (pinchStart.current.cy - pinchStart.current.panY) * k;
        schedule(clampVp({ zoom: nz, panX: nx, panY: ny }));
      }
    },
    [clampVp, schedule],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length >= 2) return;
      pinchStart.current = null;
      if (e.touches.length === 0) {
        if (panStart.current) {
          const last = hist.current[hist.current.length - 1];
          const first = hist.current[0];
          if (last && first) {
            const dx = last.x - first.x;
            const dy = last.y - first.y;
            const dist = Math.hypot(dx, dy);
            const sp = Math.hypot(vel.current.x, vel.current.y);
            if (dist >= 4 && sp > 0.15) {
              startMomentum(vel.current.x, vel.current.y);
              panStart.current = null;
              return;
            }
          }
        }
        if (pending.current) {
          const fin = clampVp(pending.current);
          if (rafId.current) {
            cancelAnimationFrame(rafId.current);
            rafId.current = 0;
          }
          pending.current = null;
          applyDom(fin);
          setVp(fin);
          vpRef.current = fin;
        }
        panStart.current = null;
        hist.current = [];
        vel.current = { x: 0, y: 0 };
        setIsPanning(false);
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        panStart.current = { x: touch.clientX, y: touch.clientY, panX: vpRef.current.panX, panY: vpRef.current.panY };
        hist.current = [{ x: touch.clientX, y: touch.clientY, t: performance.now() }];
      }
    },
    [clampVp, applyDom, startMomentum],
  );

  // MOUSE
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest("[data-table-id]")) return;
      if (momentumId.current) {
        const cur = pending.current ? clampVp(pending.current) : clampVp(vpRef.current);
        pending.current = null;
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
        cancelMomentum();
        applyDom(cur);
        setVp(cur);
        vpRef.current = cur;
        setIsPanning(false);
        if (t.closest("button") || t.closest("[data-table-id]")) return;
      }
      isMouseDown.current = true;
      refreshSize();
      hist.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      vel.current = { x: 0, y: 0 };
      panStart.current = { x: e.clientX, y: e.clientY, panX: vpRef.current.panX, panY: vpRef.current.panY };
      setIsPanning(true);
    },
    [clampVp, applyDom, cancelMomentum, refreshSize],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isMouseDown.current || !panStart.current) return;
      const now = performance.now();
      hist.current.push({ x: e.clientX, y: e.clientY, t: now });
      while (hist.current.length > 4 && hist.current[0].t < now - 100) hist.current.shift();
      if (hist.current.length >= 2) {
        const f = hist.current[0];
        const l = hist.current[hist.current.length - 1];
        const dt = l.t - f.t;
        if (dt > 5) vel.current = { x: (l.x - f.x) / dt, y: (l.y - f.y) / dt };
      }
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
      schedule(clampVp({ zoom: vpRef.current.zoom, panX: panStart.current.panX + dx, panY: panStart.current.panY + dy }));
    },
    [clampVp, schedule],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isMouseDown.current) return;
      isMouseDown.current = false;
      if (panStart.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        const dist = Math.hypot(dx, dy);
        const sp = Math.hypot(vel.current.x, vel.current.y);
        if (dist >= 4 && sp > 0.12) {
          startMomentum(vel.current.x, vel.current.y);
          panStart.current = null;
          return;
        }
      }
      if (pending.current) {
        const fin = clampVp(pending.current);
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
        pending.current = null;
        applyDom(fin);
        setVp(fin);
        vpRef.current = fin;
      }
      panStart.current = null;
      hist.current = [];
      vel.current = { x: 0, y: 0 };
      setIsPanning(false);
    },
    [clampVp, applyDom, startMomentum],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < 2) {
        e.preventDefault();
        const f = e.deltaY < 0 ? 1.08 : 0.92;
        const mz = sizeRef.current.minZoom || MIN_ZOOM;
        const v = vpRef.current;
        const nz = clamp(v.zoom * f, mz, MAX_ZOOM);
        const k = nz / v.zoom;
        const rect = rectRef.current;
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        commit({ zoom: nz, panX: cx - (cx - v.panX) * k, panY: cy - (cy - v.panY) * k });
      } else {
        e.preventDefault();
        schedule(clampVp({ zoom: vpRef.current.zoom, panX: vpRef.current.panX - e.deltaX, panY: vpRef.current.panY - e.deltaY }));
      }
    },
    [clampVp, schedule, commit],
  );

  // POINTER (compat per editor vecchio) - mappa su mouse logic
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest("[data-table-id]")) return;
      if (momentumId.current) {
        const cur = pending.current ? clampVp(pending.current) : clampVp(vpRef.current);
        pending.current = null;
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
        cancelMomentum();
        applyDom(cur);
        setVp(cur);
        vpRef.current = cur;
        setIsPanning(false);
        if (t.closest("button") || t.closest("[data-table-id]")) return;
      }
      if (e.pointerType === "touch") (e as any).preventDefault?.();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
      refreshSize();
      hist.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      vel.current = { x: 0, y: 0 };
      panStart.current = { x: e.clientX, y: e.clientY, panX: vpRef.current.panX, panY: vpRef.current.panY };
      setIsPanning(true);
    },
    [clampVp, applyDom, cancelMomentum, refreshSize],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!panStart.current) return;
      const now = performance.now();
      hist.current.push({ x: e.clientX, y: e.clientY, t: now });
      while (hist.current.length > 4 && hist.current[0].t < now - 100) hist.current.shift();
      if (hist.current.length >= 2) {
        const f = hist.current[0];
        const l = hist.current[hist.current.length - 1];
        const dt = l.t - f.t;
        if (dt > 5) vel.current = { x: (l.x - f.x) / dt, y: (l.y - f.y) / dt };
      }
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
      schedule(clampVp({ zoom: vpRef.current.zoom, panX: panStart.current.panX + dx, panY: panStart.current.panY + dy }));
    },
    [clampVp, schedule],
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!panStart.current) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      const dist = Math.hypot(dx, dy);
      const sp = Math.hypot(vel.current.x, vel.current.y);
      if (dist >= 4 && sp > 0.12) {
        startMomentum(vel.current.x, vel.current.y);
        panStart.current = null;
        return;
      }
      if (pending.current) {
        const fin = clampVp(pending.current);
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
        pending.current = null;
        applyDom(fin);
        setVp(fin);
        vpRef.current = fin;
      }
      panStart.current = null;
      hist.current = [];
      vel.current = { x: 0, y: 0 };
      setIsPanning(false);
    },
    [clampVp, applyDom, startMomentum],
  );

  const toWorld = useCallback((cx: number, cy: number) => {
    const v = vpRef.current;
    const r = rectRef.current;
    return { x: (cx - r.left - v.panX) / v.zoom, y: (cy - r.top - v.panY) / v.zoom };
  }, []);

  const zoomBy = useCallback(
    (f: number) => {
      const mz = sizeRef.current.minZoom || MIN_ZOOM;
      const v = vpRef.current;
      const nz = clamp(v.zoom * f, mz, MAX_ZOOM);
      const k = nz / v.zoom;
      const sx = sizeRef.current.w / 2;
      const sy = sizeRef.current.h / 2;
      commit({ zoom: nz, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k });
    },
    [commit],
  );

  const centerOn = useCallback(
    (wx: number, wy: number, bottomInset = 0) => {
      const vw = sizeRef.current.w;
      const vh = sizeRef.current.h - bottomInset;
      const v = vpRef.current;
      commit({ ...v, panX: vw / 2 - wx * v.zoom, panY: vh / 2 - wy * v.zoom });
    },
    [commit],
  );

  const revealRect = useCallback(
    (box: { x: number; y: number; w: number; h: number }, bottomInset: number) => {
      const vw = sizeRef.current.w;
      const vh = sizeRef.current.h;
      const nxt = selectionViewport({ current: vpRef.current, box, viewportW: vw, viewportH: vh, bottomInset });
      if (nxt.changed) commit(nxt.view);
    },
    [commit],
  );

  return {
    ref,
    contentRef,
    gridRef,
    vp,
    zoomLevel,
    fit,
    zoomBy,
    toWorld,
    isPanning,
    centerOn,
    revealRect,
    cancelPan,
    freeze,
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave: onMouseUp,
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      style: {
        touchAction: "none",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        overscrollBehavior: "none",
      } as React.CSSProperties,
    },
  };
}
