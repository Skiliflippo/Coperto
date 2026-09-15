"use client";
// Pan & Zoom della piantina — ottimizzato per 60 FPS su tablet.
// Trasformazione affine: schermo = mondo * zoom + pan.
// Strategia: durante il gesto si aggiorna SOLO il DOM via requestAnimationFrame
// (nessun setState React), il React state viene sincronizzato solo a fine gesto.
// Questo evita centinaia di re-render al secondo su iPad/Android.

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM, clamp, CM_PER_CELL } from "./floor";

export type Viewport = { zoom: number; panX: number; panY: number };

/** Calcola Zoom-to-selection/Zoom Object: mai zoom-in, solo extents visibili. */
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

export function useViewport(
  roomW: number,
  roomH: number,
  opts?: { padding?: number; bounds?: Bounds },
) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [vp, setVpState] = useState<Viewport>({ zoom: 0.4, panX: 0, panY: 0 });
  const vpRef = useRef(vp);
  useEffect(() => {
    vpRef.current = vp;
  }, [vp]);

  // rAF batching per 60fps fluidi
  const pendingVp = useRef<Viewport | null>(null);
  const rafId = useRef<number>(0);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    startDist: number;
    startZoom: number;
    centerX: number;
    centerY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const enabled = useRef(true);
  const [isPanning, setPanning] = useState(false);
  const pad = opts?.padding ?? 40;
  const bx1 = opts?.bounds?.x1 ?? 0,
    by1 = opts?.bounds?.y1 ?? 0;
  const bx2 = opts?.bounds?.x2 ?? roomW,
    by2 = opts?.bounds?.y2 ?? roomH;
  const boundsW = Math.max(50, bx2 - bx1),
    boundsH = Math.max(50, by2 - by1);

  const minZoomFor = useCallback(
    (el: HTMLElement) =>
      Math.max(
        MIN_ZOOM,
        Math.min((el.clientWidth - pad) / boundsW, (el.clientHeight - pad) / boundsH) * 0.8,
      ),
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
    [boundsW, boundsH, bx1, by1, minZoomFor],
  );

  // Applica trasformazioni DIRETTAMENTE al DOM (GPU accelerated)
  const applyDom = useCallback((v: Viewport) => {
    vpRef.current = v;
    const content = contentRef.current;
    if (content) {
      // translate3d forza accelerazione GPU su iOS Safari e Chrome Android
      content.style.transform = `translate3d(${v.panX}px, ${v.panY}px, 0) scale(${v.zoom})`;
    }
    const grid = gridRef.current;
    if (grid) {
      const cell = CM_PER_CELL * v.zoom;
      const major = cell * 2;
      // Aggiornamento diretto evita re-render React di GridBackdrop
      grid.style.backgroundPosition = `${v.panX}px ${v.panY}px`;
      grid.style.backgroundSize = `${cell}px ${cell}px, ${cell}px ${cell}px, ${major}px ${major}px`;
    }
  }, []);

  // Schedula update via rAF — un solo frame alla volta
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

  // Commit finale: applica subito + sincronizza React state
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

  const apply = useCallback(
    (fn: (v: Viewport) => Viewport) => {
      commit(fn(vpRef.current));
    },
    [commit],
  );

  const fitHold = useRef(false);
  const fit = useCallback(() => {
    if (fitHold.current) return;
    const el = ref.current;
    if (!el) return;
    const vw = el.clientWidth,
      vh = el.clientHeight;
    const zoom = clamp(
      Math.min((vw - pad * 2) / boundsW, (vh - pad * 2) / boundsH),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const cx = (bx1 + bx2) / 2,
      cy = (by1 + by2) / 2;
    commit({ zoom, panX: vw / 2 - cx * zoom, panY: vh / 2 - cy * zoom });
  }, [bx1, by1, bx2, by2, boundsW, boundsH, pad, commit]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      apply((v) => {
        const el = ref.current;
        const min = el ? minZoomFor(el) : MIN_ZOOM;
        const zoom = clamp(v.zoom * factor, min, MAX_ZOOM);
        const k = zoom / v.zoom;
        return { zoom, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k };
      });
    },
    [apply, minZoomFor],
  );

  // Wheel: throttled via rAF per non intasare il main thread
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left,
        sy = e.clientY - rect.top;
      const factor = e.ctrlKey || e.metaKey ? Math.exp(-e.deltaY * 0.01) : Math.exp(-e.deltaY * 0.0016);
      if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        const v = vpRef.current;
        scheduleDom(clampVp({ ...v, panX: v.panX - e.deltaY }));
      } else {
        const v = vpRef.current;
        const min = minZoomFor(el);
        const zoom = clamp(v.zoom * factor, min, MAX_ZOOM);
        const k = zoom / v.zoom;
        const next = { zoom, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k };
        scheduleDom(clampVp(next));
        // Commit debounced a fine gesto wheel
        clearTimeout((onWheel as any)._t);
        (onWheel as any)._t = setTimeout(() => commit(clampVp(next)), 150);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, apply, clampVp, minZoomFor, scheduleDom, commit]);

  const stopPan = useCallback(() => {
    // Committa posizione finale se c'è un pending
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
    setPanning(false);
  }, [clampVp, applyDom]);

  const cancelPan = useCallback(() => {
    enabled.current = false;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    pendingVp.current = null;
    stopPan();
    // Riabilita dopo un tick così il tap non riavvia il pan
    setTimeout(() => {
      enabled.current = true;
    }, 50);
  }, [stopPan]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Previene scroll nativo e selezione testo su tablet
      if (e.pointerType === "touch") {
        e.preventDefault();
      }
      enabled.current = true;
      const target = e.currentTarget as HTMLElement;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {}
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
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
      // Pan singolo dito / mouse
      panning.current = {
        x: e.clientX,
        y: e.clientY,
        panX: vpRef.current.panX,
        panY: vpRef.current.panY,
      };
      setPanning(true);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled.current || !pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch.current && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 1) return;
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const centerX = (a.x + b.x) / 2 - rect.left;
        const centerY = (a.y + b.y) / 2 - rect.top;
        const factor = dist / pinch.current.startDist;
        const el = ref.current;
        const min = el ? minZoomFor(el) : MIN_ZOOM;
        const newZoom = clamp(pinch.current.startZoom * factor, min, MAX_ZOOM);
        const k = newZoom / pinch.current.startZoom;
        // Mantiene il punto sotto le dita fisso
        const newPanX = centerX - (centerX - pinch.current.startPanX) * k;
        const newPanY = centerY - (centerY - pinch.current.startPanY) * k;
        const next = clampVp({ zoom: newZoom, panX: newPanX, panY: newPanY });
        scheduleDom(next);
        return;
      }

      const p = panning.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      // Ignora micro-movimenti (<0.5px) per ridurre lavoro
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const next = clampVp({
        zoom: vpRef.current.zoom,
        panX: p.panX + dx,
        panY: p.panY + dy,
      });
      scheduleDom(next);
    },
    [clampVp, minZoomFor, scheduleDom],
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
        // Fine gesto: committa stato finale
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
        setPanning(false);
      }
    },
    [clampVp, applyDom],
  );

  // Gestione globale per quando il dito esce dal container
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
      const next = clampVp({
        zoom: vpRef.current.zoom,
        panX: p.panX + (e.clientX - p.x),
        panY: p.panY + (e.clientY - p.y),
      });
      scheduleDom(next);
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

  // Cleanup rAF
  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  // Sincronizza DOM quando vp cambia via React (fit, zoom buttons)
  useEffect(() => {
    applyDom(vp);
  }, [vp, applyDom]);

  return {
    ref,
    contentRef,
    gridRef,
    vp,
    setVp: apply,
    fit,
    zoomBy,
    toWorld,
    isPanning,
    centerOn,
    revealRect,
    cancelPan,
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
