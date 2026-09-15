"use client";
// Primitive di disegno della piantina, condivise fra vista servizio ed editor.
// Tutto in coordinate mondo (cm); la scala la applica il contenitore trasformato.
import { forwardRef, useId } from "react";
import {
  CM_PER_CELL, DECOR_TONES, clamp, rectPolygon, tableSeats, wallLine,
  type DecorIcon, type FloorElement, type Point, type TableShape,
} from "@/lib/floor";
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
  isJoinable?: boolean; // può essere accostato manualmente/automaticamente
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
      className={`absolute left-0 top-0 z-20 ${dimmed ? "opacity-40" : ""}`}
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
function DecorFace({ icon, w, h, label, labelRotation = 0, labelScale = 1, textColor }: {
  icon: DecorIcon; w: number; h: number; label: string;
  labelRotation?: number; labelScale?: number; textColor?: string;
}) {
  const common = "absolute inset-0";
  // Il nome usa lo spazio REALE dopo la rotazione: a 90° larghezza e altezza si
  // scambiano. Prima il calcolo ignorava questo e tagliava testo che sarebbe entrato.
  const quarterTurn = Math.abs(labelRotation % 180) === 90;
  const usableW = (quarterTurn ? h : w) * 0.86;
  const usableH = (quarterTurn ? w : h) * 0.68;
  // Stima conservativa della larghezza media di una lettera bold (~0.58em).
  const fitByWidth = label ? usableW / (Math.max(1, label.length) * 0.58) : usableH;
  const autoSize = Math.min(usableH * 0.58, fitByWidth, 24);
  const fs = clamp(autoSize * clamp(labelScale, 0.6, 1.5), 6, 30);
  const estimatedWidth = label.length * fs * 0.58;
  const mustEllipsize = estimatedWidth > usableW + 1;
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
        <div className={`${common} drop-shadow-sm`} aria-label="Pianta">
          {/* Cespuglio visto dall'alto: masse di foglie sovrapposte, nessun vaso. */}
          <span className="absolute left-[22%] top-[3%] h-[48%] w-[50%] rounded-[48%_55%_46%_58%] bg-ok/45" />
          <span className="absolute right-[2%] top-[24%] h-[49%] w-[48%] rounded-[55%_43%_59%_47%] bg-ok/55" />
          <span className="absolute bottom-[1%] left-[25%] h-[48%] w-[52%] rounded-[44%_58%_49%_55%] bg-ok/50" />
          <span className="absolute left-[1%] top-[27%] h-[47%] w-[49%] rounded-[57%_45%_53%_48%] bg-ok/60" />
          <span className="absolute left-[28%] top-[27%] h-[47%] w-[47%] rounded-full bg-ok/70" />
          {/* piccoli riflessi che danno profondità alla chioma */}
          <span className="absolute left-[25%] top-[19%] h-[15%] w-[17%] rounded-full bg-white/20" />
          <span className="absolute right-[19%] top-[39%] h-[12%] w-[14%] rounded-full bg-white/15" />
        </div>
      )}
      {label && icon !== "pilastro" && (
        // Nessuna contro-rotazione: il nome segue l'orientamento dell'arredo,
        // come è scritto davvero su una piantina.
        <span className="absolute left-1/2 top-1/2 grid place-items-center overflow-hidden text-center font-sans font-bold uppercase leading-none tracking-wide"
          title={mustEllipsize ? label : undefined}
          style={{
            width: usableW,
            height: usableH,
            fontSize: fs,
            color: textColor,
            whiteSpace: "nowrap",
            textOverflow: mustEllipsize ? "ellipsis" : "clip",
            transform: `translate(-50%, -50%) rotate(${labelRotation}deg)`,
          }}>
          <span className={`max-w-full whitespace-nowrap ${mustEllipsize ? "overflow-hidden text-ellipsis" : ""}`}>{label}</span>
        </span>
      )}
    </>
  );
}

// LIVELLO COMUNE DEI MURI. Ogni muro è una linea fra due punti della stessa
// griglia. strokeLinecap="butt" significa che il lato terminale coincide
// ESATTAMENTE col punto di ancoraggio: due segmenti con lo stesso estremo si
// incontrano come rettangoli reali, senza cerchi o pezze nei giunti.
export function WallLayer({ elements, roomW, roomH, invalidIds, selectedIds }: {
  elements: FloorElement[];
  roomW: number; roomH: number;
  invalidIds?: Set<string>;
  selectedIds?: Set<string>;
}) {
  const walls = elements.filter((e) => e.kind === "wall").map(wallLine);
  if (!walls.length) return null;
  const pad = 80;
  // Riempimenti QUADRATI nei punti condivisi. Non sono nodi grafici o cerchi:
  // sono la vera unione dell'area dei due muri, con spigoli netti.
  const joints: { key: string; x: number; y: number; size: number; invalid: boolean }[] = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      for (const a of [walls[i].a, walls[i].b]) {
        for (const b of [walls[j].a, walls[j].b]) {
          if (Math.hypot(a.x - b.x, a.y - b.y) > 0.75) continue;
          joints.push({
            key: `${walls[i].id}-${walls[j].id}-${a.x}-${a.y}`,
            x: a.x, y: a.y,
            size: Math.max(walls[i].thickness, walls[j].thickness),
            invalid: (invalidIds?.has(walls[i].id) ?? false) || (invalidIds?.has(walls[j].id) ?? false),
          });
        }
      }
    }
  }
  return (
    <svg className="pointer-events-none absolute z-0 overflow-visible"
      style={{ left: -pad, top: -pad }}
      width={roomW + pad * 2} height={roomH + pad * 2}
      viewBox={`${-pad} ${-pad} ${roomW + pad * 2} ${roomH + pad * 2}`}>
      {walls.map((wall) => {
        const invalid = invalidIds?.has(wall.id) ?? false;
        const selected = selectedIds?.has(wall.id) ?? false;
        return (
          <g key={wall.id}>
            {selected && (
              <line x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y}
                stroke="var(--brand)" strokeWidth={wall.thickness + 8} strokeLinecap="butt" opacity={0.4} />
            )}
            <line x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y}
              stroke={invalid ? "var(--over)" : "var(--wall)"}
              strokeWidth={wall.thickness}
              strokeLinecap="butt"
              strokeDasharray={invalid ? `${wall.thickness * 1.6} ${wall.thickness}` : undefined} />
          </g>
        );
      })}
      {joints.map((joint) => (
        <rect key={joint.key}
          x={joint.x - joint.size / 2} y={joint.y - joint.size / 2}
          width={joint.size} height={joint.size}
          fill={joint.invalid ? "var(--over)" : "var(--wall)"} />
      ))}
    </svg>
  );
}

// Ridisegna SOLO il muro perimetrale sopra i muri interni: quando un divisorio
// vi arriva contro, la parete esterna lo copre come succede nella muratura reale.
export function PerimeterOverlay({ w, h, polygon }: { w: number; h: number; polygon?: Point[] }) {
  const poly = polygon && polygon.length >= 3 ? polygon : rectPolygon(w, h);
  const points = poly.map((p) => `${p.x},${p.y}`).join(" ");
  const pad = 80;
  const maskId = useId();
  return (
    <svg className="pointer-events-none absolute z-[5] overflow-visible"
      style={{ left: -pad, top: -pad }} width={w + pad * 2} height={h + pad * 2}
      viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}>
      <defs>
        <mask id={maskId}>
          <rect x={-pad} y={-pad} width={w + pad * 2} height={h + pad * 2} fill="white" />
          <polygon points={points} fill="black" />
        </mask>
      </defs>
      {/* Solo fuori dalla sala: le misure dichiarate restano quelle del pavimento
          interno, senza perdere qualche centimetro per lo spessore visivo. */}
      <polygon points={points} fill="none" stroke="var(--oos)"
        strokeWidth={PERIMETER_THICKNESS * 2} strokeLinejoin="miter" strokeLinecap="square"
        mask={`url(#${maskId})`} />
    </svg>
  );
}

// Muro o arredo fisso (bancone, cucina, scala…)
export const ElementNode = forwardRef<HTMLDivElement, {
  el: FloorElement; selected?: boolean; editable?: boolean; invalid?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  children?: React.ReactNode;
}>(function ElementNode({ el, selected, editable, invalid, onPointerDown, children }, ref) {
  const isWall = el.kind === "wall";
  const isPlant = el.icon === "pianta";
  const decorTone = DECOR_TONES.find((tone) => tone.id === (el.tone ?? (isPlant ? "verde" : "neutro")))
    ?? DECOR_TONES[0];
  // Mezzo spessore di estensione SOLO agli estremi della lunghezza. Estendere
  // anche sopra/sotto raddoppiava visivamente lo spessore: un muro salvato da
  // 6 cm sembrava ancora da 12.
  const half = isWall ? Math.min(el.w, el.h) / 2 : 0;
  const wallVisualStyle = isWall
    ? el.w >= el.h
      ? { left: -half, right: -half, top: 0, bottom: 0 }
      : { left: 0, right: 0, top: -half, bottom: -half }
    : undefined;
  return (
    <div ref={ref} onPointerDown={onPointerDown}
      className={`absolute left-0 top-0 ${isWall ? (selected ? "z-30" : "z-0") : "z-10"} ${editable ? "cursor-move" : ""}`}
      style={{
        // il riquadro di hit resta quello reale: l'estensione è solo visiva
        width: el.w, height: el.h,
        transform: `translate3d(${el.x}px, ${el.y}px, 0) rotate(${el.rotation}deg)`,
        willChange: "transform",
      }}>
      {isWall ? (
        // Il muro visibile è nel WallLayer condiviso. Qui resta solo l'area di
        // interazione trasparente per selezionare/trascinare il singolo segmento.
        <div className="absolute bg-transparent" style={wallVisualStyle} />
      ) : isPlant ? (
        // Una pianta vista dall'alto non ha un mobile quadrato attorno: il suo
        // ingombro resta selezionabile, ma visivamente è solo la chioma organica.
        <div className={`relative h-full w-full overflow-visible ${selected && !invalid ? "rounded-full outline outline-[5px] outline-brand/70" : ""} ${invalid ? "rounded-full outline outline-[5px] outline-dashed outline-over" : ""}`}>
          <DecorFace icon="pianta" w={el.w} h={el.h} label="" />
        </div>
      ) : (
        <div className={`relative h-full w-full overflow-hidden rounded-md border-[5px] ${selected && !invalid ? "outline outline-[6px] outline-brand" : ""} ${invalid ? "!border-[6px] !border-dashed !border-over !bg-over/25" : ""}`}
          style={{ backgroundColor: decorTone.fill, borderColor: decorTone.border }}>
          <DecorFace
            icon={el.icon ?? "generico"}
            w={el.w} h={el.h} label={el.label}
            labelRotation={el.labelRotation ?? 0}
            labelScale={el.labelScale ?? 1}
            textColor={decorTone.text} />
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
      className="absolute left-0 top-0 z-20 cursor-pointer"
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
  return (
    <svg className="pointer-events-none absolute" width={vw} height={vh}
      style={{ left: minX, top: minY }} viewBox={`${minX} ${minY} ${vw} ${vh}`}>
      {/* Solo pavimento: il muro esterno è disegnato una volta sola dal
          PerimeterOverlay, sopra ai divisori interni. */}
      <polygon points={pts} fill="var(--surface)" />
      <polygon points={pts} fill="none" stroke="var(--line)" strokeWidth={1} />
    </svg>
  );
}
