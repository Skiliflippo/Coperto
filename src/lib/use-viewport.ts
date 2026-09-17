"use client";
// Pan & Zoom 60 FPS + momentum ghiaccio Google Earth
// Base: 908d25d (60 FPS ottimizzato) + momentum leggero
// - Durante gesto: solo DOM via rAF, no setState
// - Momentum: friction 0.92, interrompibile, no crash
// - Fit animato con easeOutExpo ma senza loop ResizeObserver

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

  const fitZoom =
    Math.min(availableW / Math.max(1, box.w), availableH / Math.max(1, box.h)) * 0.92;
  const zoom = Math.min(current.zoom, fitZoom);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const centerY = margin + availableH / 2;
  return {
    view: {
      zoom,
      panX: viewportW / 2 - cx * zoom,
      panY: centerY - cy * zoom,
    },
    changed: true,
  };
}

type Bounds = { x1: number; y1: number; x2: number; y2: number };

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function useViewport(
  roomW: number,
  roomH: number,
  opts?: { padding?: number; bounds?: Bounds },
) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [vp, setVpState] = useState<Viewport>({ zoom: 0.4, panX: 0, panY: 0 });
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(() => getZoomLevel(0.4));
  const vpRef = useRef(vp);
  const committedVpRef = useRef(vp);
  useEffect(() => {
    vpRef.current = vp;
    setZoomLevel(getZoomLevel(vp.zoom));
  }, [vp]);

  const pendingVp = useRef<Viewport | null>(null);
  const rafId = useRef<number>(0);
  const animateRaf = useRef<number>(0);
  const momentumRaf = useRef<number>(0);

  const sizeCache = useRef({ w: 0, h: 0, minZoom: MIN_ZOOM });
  const rectCache = useRef<{ left: number; top: number } | null>(null);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const enabled = useRef(true);
  const [isPanning, setPanning] = useState(false);
  const [isAnimating, setAnimating] = useState(false);

  const moveHistory = useRef<{ x: number; y: number; t: number }[]>([]);
  const velocity = useRef({ x: 0, y: 0 });

  const pad = opts?.padding ?? 40;
  const bx1 = opts?.bounds?.x1 ?? 0,
    by1 = opts?.bounds?.y1 ?? 0;
  const bx2 = opts?.bounds?.x2 ?? roomW,
    by2 = opts?.bounds?.y2 ?? roomH;
  const boundsW = Math.max(50, bx2 - bx1),
    boundsH = Math.max(50, by2 - by1);

  const updateSizeCache = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw < 10 || ch < 10) return;
    const minZoom = Math.max(
      MIN_ZOOM,
      Math.min((cw - pad) / boundsW, (ch - pad) / boundsH) * 0.8,
    );
    sizeCache.current = { w: cw, h: ch, minZoom };
  }, [boundsW, boundsH, pad]);

  const minZoomForCached = useCallback(() => {
    return sizeCache.current.minZoom || MIN_ZOOM;
  }, []);

  const clampVp = useCallback(
    (v: Viewport): Viewport => {
      const { w: vw, h: vh } = sizeCache.current;
      if (vw < 10 || vh < 10) {
        const el = ref.current;
        if (!el) return v;
        const cw = el.clientWidth;
        const ch = el.clientHeight;
        if (cw < 10 || ch < 10) return v;
        sizeCache.current = {
          w: cw,
          h: ch,
          minZoom: Math.max(MIN_ZOOM, Math.min((cw - pad) / boundsW, (ch - pad) / boundsH) * 0.8),
        };
        return clampVp(v);
      }
      const zoom = clamp(v.zoom, sizeCache.current.minZoom, MAX_ZOOM);
      const w = boundsW * zoom,
        h = boundsH * zoom;
      const offX = bx1 * zoom,
        offY = by1 * zoom;
      const marginX = Math.min(vw * 0.3, 140);
      const marginY = Math.min(vh * 0.3, 140);
      const panX =
        w <= vw
          ? clamp(v.panX, -offX - marginX, vw - w - offX + marginX)
          : clamp(v.panX, vw - w - offX - marginX, -offX + marginX);
      const panY =
        h <= vh
          ? clamp(v.panY, -offY - marginY, vh - h - offY + marginY)
          : clamp(v.panY, vh - h - offY - marginY, -offY + marginY);
      return { zoom, panX, panY };
    },
    [boundsW, boundsH, bx1, by1, pad],
  );

  const applyDom = useCallback((v: Viewport) => {
    vpRef.current = v;
    const content = contentRef.current;
    if (content) {
      content.style.transform = `translate3d(${v.panX}px, ${v.panY}px, 0) scale(${v.zoom})`;
    }
    const grid = gridRef.current;
    if (grid) {
      const cell = CM_PER_CELL * v.zoom;
      const major = cell * 2;
      // backgroundPosition è più economico di transform modulo su iOS
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
      committedVpRef.current = clamped;
      applyDom(clamped);
      setVpState(clamped);
    },
    [clampVp, applyDom],
  );

  const cancelAnimations = useCallback(() => {
    if (animateRaf.current) {
      cancelAnimationFrame(animateRaf.current);
      animateRaf.current = 0;
    }
    if (momentumRaf.current) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = 0;
    }
    setAnimating(false);
  }, []);

  const animateTo = useCallback(
    (target: Viewport, duration = 340) => {
      cancelAnimations();
      const start = { ...vpRef.current };
      const clampedTarget = clampVp(target);
      const startTime = performance.now();
      setAnimating(true);

      const tick = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = easeOutExpo(t);
        const zoom = start.zoom + (clampedTarget.zoom - start.zoom) * eased;
        const panX = start.panX + (clampedTarget.panX - start.panX) * eased;
        const panY = start.panY + (clampedTarget.panY - start.panY) * eased;
        const current = { zoom, panX, panY };
        applyDom(current);
        if (t < 1) {
          animateRaf.current = requestAnimationFrame(tick);
        } else {
          animateRaf.current = 0;
          committedVpRef.current = clampedTarget;
          setVpState(clampedTarget);
          setAnimating(false);
          setPanning(false);
        }
      };
      animateRaf.current = requestAnimationFrame(tick);
    },
    [clampVp, applyDom, cancelAnimations],
  );

  const apply = useCallback(
    (fn: (v: Viewport) => Viewport) => {
      const next = fn(vpRef.current);
      animateTo(next, 300);
    },
    [animateTo],
  );

  const fitHold = useRef(false);
  const fit = useCallback(
    (animated = true) => {
      if (fitHold.current) return;
      const el = ref.current;
      if (!el) return;
      const vw = el.clientWidth,
        vh = el.clientHeight;
      if (vw < 10 || vh < 10) return;
      sizeCache.current = {
        w: vw,
        h: vh,
        minZoom: Math.max(MIN_ZOOM, Math.min((vw - pad * 2) / boundsW, (vh - pad * 2) / boundsH) * 0.8),
      };
      const zoom = clamp(
        Math.min((vw - pad * 2) / boundsW, (vh - pad * 2) / boundsH),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const cx = (bx1 + bx2) / 2,
        cy = (by1 + by2) / 2;
      const target = { zoom, panX: vw / 2 - cx * zoom, panY: vh / 2 - cy * zoom };
      if (animated) {
        animateTo(target, 360);
      } else {
        commit(target);
      }
    },
    [bx1, by1, bx2, by2, boundsW, boundsH, pad, commit, animateTo],
  );

  // ResizeObserver leggero: solo se dimensione cambia >2px, e senza animazione loop
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    updateSizeCache();
    const doFit = () => {
      if (fitHold.current) return;
      if (isAnimating) return; // non rifittare durante animazione
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
      lastW = w;
      lastH = h;
      sizeCache.current.w = w;
      sizeCache.current.h = h;
      sizeCache.current.minZoom = Math.max(
        MIN_ZOOM,
        Math.min((w - pad) / boundsW, (h - pad) / boundsH) * 0.8,
      );
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        fit(false);
      });
    };
    doFit();
    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [fit, updateSizeCache, pad, boundsW, boundsH, isAnimating]);

  const stopPan = useCallback(() => {
    if (pendingVp.current) {
      const final = clampVp(pendingVp.current);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
      pendingVp.current = null;
      committedVpRef.current = final;
      applyDom(final);
      setVpState(final);
    }
    pointers.current.clear();
    pinch.current = null;
    panning.current = null;
    rectCache.current = null;
    moveHistory.current = [];
    velocity.current = { x: 0, y: 0 };
    setPanning(false);
  }, [clampVp, applyDom]);

  const freeze = useCallback(() => {
    const wasAnimating = !!animateRaf.current || !!momentumRaf.current;
    cancelAnimations();
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
    committedVpRef.current = cur;
    applyDom(cur);
    setVpState(cur);
    pointers.current.clear();
    pinch.current = null;
    panning.current = null;
    rectCache.current = null;
    moveHistory.current = [];
    velocity.current = { x: 0, y: 0 };
    setPanning(false);
    return wasAnimating;
  }, [clampVp, applyDom, cancelAnimations]);

  const cancelPan = useCallback(() => {
    if (animateRaf.current || momentumRaf.current) {
      freeze();
      enabled.current = false;
      setTimeout(() => {
        enabled.current = true;
      }, 50);
      return;
    }
    enabled.current = false;
    cancelAnimations();
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    pendingVp.current = null;
    applyDom(committedVpRef.current);
    pointers.current.clear();
    pinch.current = null;
    panning.current = null;
    rectCache.current = null;
    moveHistory.current = [];
    velocity.current = { x: 0, y: 0 };
    setPanning(false);
    setTimeout(() => {
      enabled.current = true;
    }, 50);
  }, [applyDom, cancelAnimations, freeze]);

  const startMomentum = useCallback(
    (vx: number, vy: number) => {
      cancelAnimations();
      if (pendingVp.current) {
        vpRef.current = pendingVp.current;
        pendingVp.current = null;
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }
      }
      let curVx = vx * 0.92;
      let curVy = vy * 0.92;
      const friction = 0.92;
      const minVelocity = 0.08; // più alto = si ferma prima, meno lag
      let frames = 0;
      const maxFrames = 90; // cap a 1.5s max, evita loop infinito
      setPanning(true);
      setAnimating(true);

      const step = () => {
        frames++;
        curVx *= friction;
        curVy *= friction;
        const speed = Math.hypot(curVx, curVy);
        if (speed < minVelocity || frames > maxFrames) {
          momentumRaf.current = 0;
          const final = clampVp(vpRef.current);
          committedVpRef.current = final;
          applyDom(final);
          setVpState(final);
          setPanning(false);
          setAnimating(false);
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
    [clampVp, applyDom, cancelAnimations],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      const isOnButton = !!target.closest("button");
      const isOnTable = !!target.closest("[data-table-id]");
      const wasAnimating = !!animateRaf.current || !!momentumRaf.current;

      if (wasAnimating) {
        cancelAnimations();
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
        committedVpRef.current = cur;
        applyDom(cur);
        setVpState(cur);
        pointers.current.clear();
        pinch.current = null;
        panning.current = null;
        rectCache.current = null;
        moveHistory.current = [];
        velocity.current = { x: 0, y: 0 };
        setPanning(false);
        if (isOnButton || isOnTable) return;
      }

      if (isOnButton) return;
      if (isOnTable) return;

      cancelAnimations();
      if (e.pointerType === "touch") e.preventDefault();
      enabled.current = true;
      const currentTarget = e.currentTarget as HTMLElement;
      try {
        currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size === 1) {
        const el = ref.current;
        if (el) {
          const r = el.getBoundingClientRect();
          rectCache.current = { left: r.left, top: r.top };
        }
        moveHistory.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
        velocity.current = { x: 0, y: 0 };
      }

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 1) return;
        const rc = rectCache.current;
        const centerX = rc ? (a.x + b.x) / 2 - rc.left : (a.x + b.x) / 2;
        const centerY = rc ? (a.y + b.y) / 2 - rc.top : (a.y + b.y) / 2;
        pinch.current = {
          startDist: dist,
          startZoom: vpRef.current.zoom,
          startPanX: vpRef.current.panX,
          startPanY: vpRef.current.panY,
          centerX,
          centerY,
        };
        panning.current = null;
        setPanning(false);
        return;
      }
      panning.current = {
        x: e.clientX,
        y: e.clientY,
        panX: vpRef.current.panX,
        panY: vpRef.current.panY,
      };
      setPanning(true);
    },
    [cancelAnimations, clampVp, applyDom],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled.current) return;
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const now = performance.now();
      if (pointers.current.size === 1) {
        moveHistory.current.push({ x: e.clientX, y: e.clientY, t: now });
        const cutoff = now - 100;
        while (moveHistory.current.length > 3 && moveHistory.current[0].t < cutoff) {
          moveHistory.current.shift();
        }
        if (moveHistory.current.length >= 2) {
          const first = moveHistory.current[0];
          const last = moveHistory.current[moveHistory.current.length - 1];
          const dt = last.t - first.t;
          if (dt > 4) {
            velocity.current = {
              x: (last.x - first.x) / dt,
              y: (last.y - first.y) / dt,
            };
          }
        }
      }

      if (pinch.current && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 1) return;
        const factor = dist / pinch.current.startDist;
        const min = minZoomForCached();
        const newZoom = clamp(pinch.current.startZoom * factor, min, MAX_ZOOM);
        const k = newZoom / pinch.current.startZoom;
        const centerX = pinch.current.centerX;
        const centerY = pinch.current.centerY;
        const newPanX = centerX - (centerX - pinch.current.startPanX) * k;
        const newPanY = centerY - (centerY - pinch.current.startPanY) * k;
        scheduleDom(clampVp({ zoom: newZoom, panX: newPanX, panY: newPanY }));
        return;
      }

      const p = panning.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      scheduleDom(
        clampVp({
          zoom: vpRef.current.zoom,
          panX: p.panX + dx,
          panY: p.panY + dy,
        }),
      );
    },
    [clampVp, minZoomForCached, scheduleDom],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      if (pointers.current.size < 2) {
        pinch.current = null;
      }
      if (pointers.current.size === 0) {
        if (panning.current) {
          const dx = e.clientX - panning.current.x;
          const dy = e.clientY - panning.current.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= 4) {
            const vx = velocity.current.x;
            const vy = velocity.current.y;
            const speed = Math.hypot(vx, vy);
            if (speed > 0.12) {
              startMomentum(vx, vy);
              panning.current = null;
              rectCache.current = null;
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
        }
        panning.current = null;
        rectCache.current = null;
        moveHistory.current = [];
        velocity.current = { x: 0, y: 0 };
        setPanning(false);
      }
    },
    [clampVp, applyDom, startMomentum],
  );

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return { x: 0, y: 0 };
    const rc = rectCache.current;
    let left: number, top: number;
    if (rc) {
      left = rc.left;
      top = rc.top;
    } else {
      const rect = el.getBoundingClientRect();
      left = rect.left;
      top = rect.top;
    }
    const v = vpRef.current;
    return { x: (clientX - left - v.panX) / v.zoom, y: (clientY - top - v.panY) / v.zoom };
  }, []);

  const zoomBy = useCallback(
    (f: number) => {
      cancelAnimations();
      const el = ref.current;
      if (!el) return;
      const v = vpRef.current;
      const min = minZoomForCached();
      const zoom = clamp(v.zoom * f, min, MAX_ZOOM);
      const k = zoom / v.zoom;
      const { w, h } = sizeCache.current;
      const sx = w / 2 || el.clientWidth / 2,
        sy = h / 2 || el.clientHeight / 2;
      const target = { zoom, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k };
      animateTo(target, 300);
    },
    [minZoomForCached, animateTo, cancelAnimations],
  );

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      cancelAnimations();
      const v = vpRef.current;
      const min = minZoomForCached();
      const zoom = clamp(v.zoom * factor, min, MAX_ZOOM);
      const k = zoom / v.zoom;
      const target = { zoom, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k };
      animateTo(target, 300);
    },
    [minZoomForCached, animateTo, cancelAnimations],
  );

  const centerOn = useCallback(
    (wx: number, wy: number, bottomInset = 0) => {
      cancelAnimations();
      const el = ref.current;
      if (!el) return;
      const { w: vw, h: vhRaw } = sizeCache.current;
      const vw2 = vw || el.clientWidth;
      const vh2 = (vhRaw || el.clientHeight) - bottomInset;
      const v = vpRef.current;
      const target = { ...v, panX: vw2 / 2 - wx * v.zoom, panY: vh2 / 2 - wy * v.zoom };
      animateTo(target, 320);
    },
    [animateTo, cancelAnimations],
  );

  const revealRect = useCallback(
    (box: { x: number; y: number; w: number; h: number }, bottomInset: number) => {
      const el = ref.current;
      if (!el) return;
      const { w, h } = sizeCache.current;
      const next = selectionViewport({
        current: vpRef.current,
        box,
        viewportW: w || el.clientWidth,
        viewportH: h || el.clientHeight,
        bottomInset,
      });
      if (next.changed) animateTo(next.view, 340);
    },
    [animateTo],
  );

  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (animateRaf.current) cancelAnimationFrame(animateRaf.current);
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
    zoomAt,
    toWorld,
    isPanning: isPanning || isAnimating,
    isAnimating,
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
