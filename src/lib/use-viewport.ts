"use client";
// Pan & Zoom della piantina. Trasformazione affine: schermo = mondo * zoom + pan.
// Lo zoom avviene SEMPRE sul punto puntato (cursore o centro del pinch).
// La navigazione è LIMITATA: non si può perdere di vista la sala, né rimpicciolirla
// oltre il punto in cui sta tutta nello schermo.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM, clamp, fitView } from "./floor";

export type Viewport = { zoom: number; panX: number; panY: number };

export function useViewport(roomW: number, roomH: number, opts?: { padding?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ zoom: 0.4, panX: 0, panY: 0 });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number } | null>(null);
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const enabled = useRef(true);           // il pan si può sospendere (es. tap su un tavolo)
  const [isPanning, setPanning] = useState(false);
  const pad = opts?.padding ?? 40;

  // Zoom minimo utile: quello che fa stare tutta la sala nello schermo.
  const minZoomFor = useCallback((el: HTMLElement) =>
    Math.max(MIN_ZOOM, Math.min((el.clientWidth - pad) / roomW, (el.clientHeight - pad) / roomH) * 0.85),
    [roomW, roomH, pad]);

  // Vincola il pan: la sala deve restare almeno per metà dentro la finestra.
  const clampVp = useCallback((v: Viewport): Viewport => {
    const el = ref.current;
    if (!el) return v;
    const zoom = clamp(v.zoom, minZoomFor(el), MAX_ZOOM);
    const vw = el.clientWidth, vh = el.clientHeight;
    const w = roomW * zoom, h = roomH * zoom;
    const marginX = Math.min(vw * 0.35, 160);
    const marginY = Math.min(vh * 0.35, 160);
    // se la sala è più piccola della finestra la centriamo, altrimenti limitiamo lo scorrimento
    const panX = w <= vw ? clamp(v.panX, -marginX, vw - w + marginX) : clamp(v.panX, vw - w - marginX, marginX);
    const panY = h <= vh ? clamp(v.panY, -marginY, vh - h + marginY) : clamp(v.panY, vh - h - marginY, marginY);
    return { zoom, panX, panY };
  }, [roomW, roomH, minZoomFor]);

  const apply = useCallback((fn: (v: Viewport) => Viewport) => setVp((v) => clampVp(fn(v))), [clampVp]);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setVp(clampVp(fitView(roomW, roomH, el.clientWidth, el.clientHeight, pad)));
  }, [roomW, roomH, pad, clampVp]);

  useEffect(() => {
    fit();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    apply((v) => {
      const el = ref.current;
      const min = el ? minZoomFor(el) : MIN_ZOOM;
      const zoom = clamp(v.zoom * factor, min, MAX_ZOOM);
      const k = zoom / v.zoom;
      return { zoom, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k };
    });
  }, [apply, minZoomFor]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
      else if (e.shiftKey) apply((v) => ({ ...v, panX: v.panX - e.deltaY }));
      else zoomAt(Math.exp(-e.deltaY * 0.0016), sx, sy);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, apply]);

  const stopPan = useCallback(() => {
    pointers.current.clear();
    pinch.current = null;
    panning.current = null;
    setPanning(false);
  }, []);

  // Sospende il pan finché non si rilascia: usato quando il tocco è su un tavolo.
  const cancelPan = useCallback(() => {
    enabled.current = false;
    stopPan();
  }, [stopPan]);

  const onPointerDown = (e: React.PointerEvent) => {
    enabled.current = true;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      panning.current = null;
      setPanning(false);
      return;
    }
    panning.current = { x: e.clientX, y: e.clientY, panX: vpRef.current.panX, panY: vpRef.current.panY };
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!enabled.current || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = ref.current!.getBoundingClientRect();
      zoomAt(dist / pinch.current.dist, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      pinch.current.dist = dist;
      return;
    }
    const p = panning.current;
    if (!p) return;
    apply((v) => ({ ...v, panX: p.panX + (e.clientX - p.x), panY: p.panY + (e.clientY - p.y) }));
  };
  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) { panning.current = null; setPanning(false); }
  };

  // Il gesto finisce sempre, anche se il dito esce dal riquadro o il browser lo annulla.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = panning.current;
      if (!enabled.current || !p || pointers.current.size > 1) return;
      apply((v) => ({ ...v, panX: p.panX + (e.clientX - p.x), panY: p.panY + (e.clientY - p.y) }));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopPan);
    window.addEventListener("pointercancel", stopPan);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopPan);
      window.removeEventListener("pointercancel", stopPan);
    };
  }, [apply, stopPan]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - rect.left - v.panX) / v.zoom, y: (clientY - rect.top - v.panY) / v.zoom };
  }, []);

  const zoomBy = (f: number) => {
    const el = ref.current;
    if (!el) return;
    zoomAt(f, el.clientWidth / 2, el.clientHeight / 2);
  };

  // Centra un punto del mondo nell'area visibile, con eventuale offset per il
  // pannello che occupa la parte bassa dello schermo.
  const centerOn = useCallback((wx: number, wy: number, bottomInset = 0) => {
    const el = ref.current;
    if (!el) return;
    const vw = el.clientWidth, vh = el.clientHeight - bottomInset;
    apply((v) => ({ ...v, panX: vw / 2 - wx * v.zoom, panY: vh / 2 - wy * v.zoom }));
  }, [apply]);

  // Assicura che un rettangolo del mondo sia visibile sopra il pannello.
  const revealRect = useCallback((box: { x: number; y: number; w: number; h: number }, bottomInset: number) => {
    const el = ref.current;
    if (!el) return;
    const v = vpRef.current;
    const top = box.y * v.zoom + v.panY;
    const bottom = (box.y + box.h) * v.zoom + v.panY;
    const left = box.x * v.zoom + v.panX;
    const right = (box.x + box.w) * v.zoom + v.panX;
    const visibleBottom = el.clientHeight - bottomInset - 12;
    const hidden = bottom > visibleBottom || top < 12 || left < 12 || right > el.clientWidth - 12;
    if (hidden) centerOn(box.x + box.w / 2, box.y + box.h / 2, bottomInset);
  }, [centerOn]);

  return {
    ref, vp, setVp: apply, fit, zoomBy, toWorld, isPanning, centerOn, revealRect, cancelPan, stopPan,
    bind: { onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer },
  };
}
