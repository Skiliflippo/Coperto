"use client";
// Primitive di disegno della piantina, condivise fra vista servizio ed editor.
// Tutto in coordinate mondo (cm); la scala la applica il contenitore trasformato.
import { forwardRef, useId } from "react";
import { CM_PER_CELL, rectPolygon, tableSeats, type DecorIcon, type FloorElement, type Point, type TableShape } from "@/lib/floor";
import type { Viewport } from "@/lib/use-viewport";

// Griglia disegnata in spazio SCHERMO: resta nitida a qualsiasi zoom (trucco anti-sfocatura).
export function GridBackdrop({ vp, strong }: { vp: Viewport; strong?: boolean }) {
  const cell = CM_PER_CELL * vp.zoom;
  const major = cell * 2; // ogni metro
  if (cell < 4) return null;
  const line = strong ? "color-mix(in srgb, var(--line) 90%, transparent)" : "color-mix(in srgb, var(--line) 55%, transparent)";
  return (
    <div className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `
          linear-gradient(to right, ${line} 1px, transparent 1px),
          linear-gradient(to bottom, ${line} 1px, transparent 1px),
          radial-gradient(circle at 0 0, color-mix(in srgb, var(--muted) 45%, transparent) 1.4px, transparent 1.5px)`,
        backgroundSize: `${cell}px ${cell}px, ${cell}px ${cell}px, ${major}px ${major}px`,
        backgroundPosition: `${vp.panX}px ${vp.panY}px`,
      }} />
  );
}

export type TableNodeData = {
  id: string; label: string; capacity: number; maxCapacity?: number; shape: TableShape;
  x: number; y: number; width: number; height: number; rotation: number;
  splitInto?: number;   // in quante parti si stacca (0 = tavolo unico)
};

// Un tavolo: piano + sedie + etichetta sempre dritta (contro-ruotata).
export const TableNode = forwardRef<HTMLDivElement, {
  t: TableNodeData;
  tone?: string;         // classi bordo/stato
  dotClass?: string;     // pallino di stato
  sub?: string;          // riga sotto il numero (coperti o timer)
  selected?: boolean;
  dimmed?: boolean;
  invalid?: boolean;
  // Posti già calcolati per l'intera sala (computeRoomSeats): così due tavoli
  // vicini non piazzano sedie nello stesso punto.
  seats?: Point[];
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}>(function TableNode({ t, tone = "border-line", dotClass, sub, selected, dimmed, invalid, seats: given, onPointerDown, onPointerUp, onClick, children }, ref) {
  const seats = given ?? tableSeats(t);
  const radius = t.shape === "round" ? "50%" : Math.max(8, Math.min(t.width, t.height) * 0.12);
  const fs = Math.max(22, Math.min(t.width, t.height) * 0.36);
  return (
    <div ref={ref} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onClick={onClick}
      className={`absolute left-0 top-0 ${dimmed ? "opacity-40" : ""}`}
      style={{
        width: t.width, height: t.height,
        transform: `translate3d(${t.x - t.width / 2}px, ${t.y - t.height / 2}px, 0) rotate(${t.rotation}deg)`,
        willChange: "transform",
      }}>
      {seats.map((s, i) => (
        <span key={i} className="absolute rounded-full bg-muted/45"
          style={{ left: s.x - 13, top: s.y - 13, width: 26, height: 26 }} />
      ))}
      <div className={`h-full w-full border-[7px] bg-surface shadow-md transition-colors ${tone} ${selected ? "!border-brand" : ""} ${invalid ? "!border-dashed !border-over bg-over/15" : ""}`}
        style={{ borderRadius: radius }}>
        <div className="flex h-full w-full flex-col items-center justify-center"
          style={{ transform: `rotate(${-t.rotation}deg)` }}>
          <span className="font-display font-extrabold leading-none" style={{ fontSize: fs }}>{t.label}</span>
          {sub && <span className="mt-1.5 font-sans font-bold leading-none text-muted" style={{ fontSize: fs * 0.5 }}>{sub}</span>}
          {dotClass && <span className={`mt-2 block rounded-full ${dotClass}`} style={{ width: fs * 0.4, height: fs * 0.4 }} />}
        </div>
      </div>
      {children}
    </div>
  );
});

// Disegno dell'arredo in base al tipo: un bancone non è una scala.
function DecorFace({ icon, w, h, label }: { icon: DecorIcon; w: number; h: number; label: string }) {
  const common = "absolute inset-0";
  // L'etichetta resta SEMPRE dentro l'oggetto: il corpo scala con il lato corto,
  // e si riduce ancora se il nome è lungo rispetto alla larghezza disponibile.
  const usableW = w * 0.86, usableH = h * 0.7;
  const byHeight = usableH * 0.5;
  const byWidth = label ? (usableW / Math.max(3, label.length)) * 1.7 : byHeight;
  const fs = Math.max(7, Math.min(byHeight, byWidth, Math.min(w, h) * 0.3));
  return (
    <>
      {icon === "scala" && (
        <div className={`${common} flex flex-col justify-between p-[6px]`}>
          {Array.from({ length: Math.max(3, Math.min(9, Math.round(h / 45))) }).map((_, i) => (
            <span key={i} className="block h-[6px] rounded-full bg-oos/45" />
          ))}
        </div>
      )}
      {icon === "bancone" && <div className={`${common} border-b-[10px] border-oos/50`} />}
      {icon === "cassa" && <div className={`${common} m-[14%] rounded-md border-[5px] border-oos/45`} />}
      {icon === "pilastro" && <div className={`${common} rounded-full bg-oos/45`} />}
      {icon === "porta" && (
        <div className={`${common} overflow-hidden`}>
          <span className="absolute inset-x-[10%] bottom-0 top-[45%] rounded-t-full border-[5px] border-b-0 border-oos/50" />
        </div>
      )}
      {icon === "bagno" && <div className={`${common} m-[18%] rounded-full border-[5px] border-dashed border-oos/45`} />}
      {icon === "pianta" && (
        <div className={`${common} grid place-items-center`}>
          {/* vaso trapezoidale */}
          <span className="absolute bottom-[12%] left-1/2 h-[34%] w-[44%] -translate-x-1/2 rounded-b-[18%] rounded-t-[6%] bg-oos/55" />
          {/* chioma: due cerchi sfalsati, verde tenue */}
          <span className="absolute left-[14%] top-[10%] h-[48%] w-[48%] rounded-full bg-ok/40" />
          <span className="absolute right-[12%] top-[22%] h-[40%] w-[40%] rounded-full bg-ok/55" />
        </div>
      )}
      {label && icon !== "pilastro" && (
        // Nessuna contro-rotazione: il nome segue l'orientamento dell'arredo,
        // come è scritto davvero su una piantina.
        <span className={`${common} grid place-items-center overflow-hidden px-[6%] text-center font-sans font-bold uppercase leading-none tracking-wide text-muted`}
          style={{ fontSize: fs, wordBreak: "break-word" }}>
          {label}
        </span>
      )}
    </>
  );
}

// Muro o arredo fisso (bancone, cucina, scala…)
export const ElementNode = forwardRef<HTMLDivElement, {
  el: FloorElement; selected?: boolean; editable?: boolean; invalid?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  children?: React.ReactNode;
}>(function ElementNode({ el, selected, editable, invalid, onPointerDown, children }, ref) {
  const isWall = el.kind === "wall";
  // Mezzo spessore di estensione per lato: due muri che si incontrano si
  // sovrappongono esattamente all'angolo, senza i bordi stondati che tradivano
  // la composizione da oggetti separati.
  const half = isWall ? Math.min(el.w, el.h) / 2 : 0;
  return (
    <div ref={ref} onPointerDown={onPointerDown}
      className={`absolute left-0 top-0 ${editable ? "cursor-move" : ""}`}
      style={{
        // il riquadro di hit resta quello reale: l'estensione è solo visiva
        width: el.w, height: el.h,
        transform: `translate3d(${el.x}px, ${el.y}px, 0) rotate(${el.rotation}deg)`,
        willChange: "transform",
      }}>
      {isWall ? (
        // niente border-radius: un angolo di muro deve essere un angolo.
        // l'ombra segue l'estensione così la selezione resta leggibile.
        <div className={`absolute bg-oos ${selected && !invalid ? "outline outline-[6px] outline-brand" : ""} ${invalid ? "!outline !outline-dashed !outline-over" : ""}`}
          style={{ inset: `-${half}px`, outlineOffset: half > 0 ? `${half}px` : undefined }} />
      ) : (
        <div className={`relative h-full w-full overflow-hidden rounded-md border-[5px] border-oos/45 bg-oos/15 ${selected && !invalid ? "outline outline-[6px] outline-brand" : ""} ${invalid ? "!border-[6px] !border-dashed !border-over !bg-over/25" : ""}`}>
          <DecorFace icon={el.icon ?? "generico"} w={el.w} h={el.h} label={el.label} />
        </div>
      )}
      {children}
    </div>
  );
});

// TAVOLI ACCOSTATI: mentre il gruppo è seduto, due o più tavoli diventano
// visivamente UNO. Si disegna un blocco unico sopra il loro ingombro complessivo.
export function JoinedNode({ box, label, sub, tone, dotClass, onPointerDown, onPointerUp }: {
  box: { x: number; y: number; w: number; h: number };
  label: string; sub?: string; tone: string; dotClass?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}) {
  const fs = Math.max(26, Math.min(box.w, box.h) * 0.3);
  return (
    <div onPointerDown={onPointerDown} onPointerUp={onPointerUp}
      className="absolute left-0 top-0 cursor-pointer"
      style={{ width: box.w, height: box.h, transform: `translate3d(${box.x}px, ${box.y}px, 0)` }}>
      <div className={`grid h-full w-full place-items-center rounded-[16px] border-[7px] bg-surface shadow-lg ${tone}`}>
        <div className="text-center leading-none">
          <span className="font-display font-extrabold" style={{ fontSize: fs }}>{label}</span>
          {sub && <span className="mt-1.5 block font-sans font-bold text-muted" style={{ fontSize: fs * 0.5 }}>{sub}</span>}
          {dotClass && <span className={`mx-auto mt-2 block rounded-full ${dotClass}`} style={{ width: fs * 0.35, height: fs * 0.35 }} />}
        </div>
      </div>
      <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-soon px-3 py-0.5 font-sans font-bold text-ink"
        style={{ fontSize: fs * 0.34 }}>uniti</span>
    </div>
  );
}

// Perimetro del locale. Il poligono rappresenta la FACCIA INTERNA dei muri: lo
// spessore viene disegnato verso l'esterno con una maschera, così un tavolo
// appoggiato al bordo tocca il muro senza finirci sopra.
// Spessore del muro perimetrale: condiviso dall'editor per far combaciare
// i muri interni con il bordo della sala.
export const PERIMETER_THICKNESS = 12;

export function RoomShell({ w, h, polygon }: { w: number; h: number; polygon?: Point[] }) {
  const poly = polygon && polygon.length >= 3 ? polygon : rectPolygon(w, h);
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const pad = 80;
  const minX = Math.min(0, ...xs) - pad, minY = Math.min(0, ...ys) - pad;
  const maxX = Math.max(w, ...xs) + pad, maxY = Math.max(h, ...ys) + pad;
  const vw = maxX - minX, vh = maxY - minY;
  const pts = poly.map((p) => `${p.x},${p.y}`).join(" ");
  // ID stabile: se cambiasse a ogni frame (es. derivato dalle dimensioni) il
  // browser perderebbe il riferimento url(#id) mentre trascini un angolo e il
  // pavimento sparirebbe a intermittenza.
  const id = useId();
  const T = PERIMETER_THICKNESS;   // spessore muro in cm, tutto verso l'esterno
  return (
    <svg className="pointer-events-none absolute" width={vw} height={vh}
      style={{ left: minX, top: minY }} viewBox={`${minX} ${minY} ${vw} ${vh}`}>
      <defs>
        <mask id={id}>
          <rect x={minX} y={minY} width={vw} height={vh} fill="white" />
          <polygon points={pts} fill="black" />
        </mask>
      </defs>
      <polygon points={pts} fill="var(--surface)" />
      <polygon points={pts} fill="none" stroke="var(--oos)" strokeWidth={T * 2}
        strokeLinejoin="miter" strokeLinecap="square" mask={`url(#${id})`} opacity={0.85} />
      <polygon points={pts} fill="none" stroke="var(--line)" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
