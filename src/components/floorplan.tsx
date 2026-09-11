"use client";
// PIANTINA DELLA SALA — vista dall'alto, come la si guarda dalla porta d'ingresso.
// Coordinate in "unità stanza" (≈ cm): il canvas viene scalato per stare nello schermo,
// così muri e tavoli restano sempre in proporzione fra loro.
// Vista: tutti. Editor (sposta / ruota / aggiungi / muri): solo il titolare.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check, CircleDot, Grid2x2, Minus, Move, Plus, RectangleHorizontal, RotateCw, Ruler, Square, Trash2, Wallpaper, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { TABLE_STATE } from "@/lib/meta";
import { mmssAgo } from "@/lib/time";
import { toast } from "@/components/toast";
import type { Bootstrap, Room, Seating, TableLiveState, TableT, Wall } from "@/lib/types";

const SNAP = 10;            // griglia di aggancio in unità stanza
const GRID = 50;            // passo della griglia disegnata
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Mode = "view" | "move" | "walls";

export function FloorPlan({ boot, states, byTable, now, onPick }: {
  boot: Bootstrap;
  states: Map<string, TableLiveState>;
  byTable: Map<string, Seating>;
  now: number;
  onPick: (t: TableT) => void;
}) {
  const staff = useSession((s) => s.staff);
  const isOwner = staff?.role === "titolare";
  const qc = useQueryClient();
  const [roomId, setRoomId] = useState(boot.rooms[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("view");
  const [selId, setSelId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { x: number; y: number }>>({});
  const [wallDraft, setWallDraft] = useState<Wall | null>(null);
  const [sizeOpen, setSizeOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  const room: Room | undefined = boot.rooms.find((r) => r.id === roomId) ?? boot.rooms[0];
  const layout = room?.layout ?? { w: 1200, h: 800, walls: [], objects: [] };
  const tables = boot.tables.filter((t) => t.roomId === room?.id);
  const sel = tables.find((t) => t.id === selId) ?? null;

  // Il canvas si adatta alla larghezza disponibile: zero scroll orizzontale, mai.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const availW = el.clientWidth;
      const availH = Math.min(560, Math.max(320, window.innerHeight - 420));
      setScale(Math.min(availW / layout.w, availH / layout.h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [layout.w, layout.h]);

  useEffect(() => { if (!isOwner && mode !== "view") setMode("view"); }, [isOwner, mode]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["bootstrap", staff?.restaurantId] }), [qc, staff]);
  const owner = { restaurantId: staff?.restaurantId, staffId: staff?.id, staffName: staff?.name ?? "" };

  const saveGeometry = async (id: string, patch: Record<string, number | string>) => {
    try {
      await api(`/api/tables/${id}`, { method: "PATCH", body: { ...owner, action: "geometry", ...patch } });
      await refresh();
    } catch (e: any) { toast({ title: e.message, tone: "err" }); await refresh(); }
  };
  const saveLayout = async (next: typeof layout) => {
    try {
      await api(`/api/rooms/${room!.id}`, { method: "PUT", body: { ...owner, layout: next } });
      await refresh();
    } catch (e: any) { toast({ title: e.message, tone: "err" }); }
  };

  // Coordinate puntatore → unità stanza
  const toRoom = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  // ── Trascinamento tavolo ──────────────────────────────────────────────────
  const startDragTable = (e: React.PointerEvent, t: TableT) => {
    if (mode !== "move") return;
    e.preventDefault(); e.stopPropagation();
    setSelId(t.id);
    const start = toRoom(e);
    const from = drafts[t.id] ?? { x: t.x, y: t.y };
    const off = { dx: start.x - from.x, dy: start.y - from.y };
    const half = { w: Math.max(t.width, t.height) / 2, h: Math.max(t.width, t.height) / 2 };
    const move = (ev: PointerEvent) => {
      const p = toRoom(ev);
      setDrafts((d) => ({
        ...d,
        [t.id]: {
          x: clamp(snap(p.x - off.dx), half.w, layout.w - half.w),
          y: clamp(snap(p.y - off.dy), half.h, layout.h - half.h),
        },
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrafts((d) => {
        const pos = d[t.id];
        if (pos && (pos.x !== t.x || pos.y !== t.y)) void saveGeometry(t.id, pos);
        return d;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── Disegno muri ──────────────────────────────────────────────────────────
  const startWall = (e: React.PointerEvent) => {
    if (mode !== "walls") return;
    const s0 = toRoom(e);
    const from = { x: snap(s0.x), y: snap(s0.y) };
    const move = (ev: PointerEvent) => {
      const p = toRoom(ev);
      let x2 = snap(p.x), y2 = snap(p.y);
      // muri dritti: se quasi orizzontale/verticale, allinea (come si costruisce davvero)
      if (Math.abs(x2 - from.x) < 40) x2 = from.x;
      if (Math.abs(y2 - from.y) < 40) y2 = from.y;
      setWallDraft({ x1: from.x, y1: from.y, x2, y2 });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWallDraft((w) => {
        if (w && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 40) {
          void saveLayout({ ...layout, walls: [...layout.walls, w] });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addTable = async () => {
    try {
      await api("/api/tables", {
        method: "POST",
        body: { ...owner, roomId: room!.id, capacity: 4, x: snap(layout.w / 2), y: snap(layout.h / 2) },
      });
      await refresh();
      toast({ title: "Tavolo aggiunto al centro della sala", msg: "Trascinalo al suo posto.", tone: "ok" });
    } catch (e: any) { toast({ title: e.message, tone: "err" }); }
  };

  if (!room) return null;
  const canvasH = layout.h * scale;

  return (
    <div className="mt-4">
      {/* Selettore sala + accesso editor */}
      <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4">
        {boot.rooms.map((r) => (
          <button key={r.id} onClick={() => { setRoomId(r.id); setSelId(null); }}
            className={`min-h-[48px] shrink-0 rounded-2xl px-4 font-semibold active:scale-95 ${r.id === room.id ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}>
            {r.name}
          </button>
        ))}
        {isOwner && (
          <button onClick={() => { setMode(mode === "view" ? "move" : "view"); setSelId(null); }}
            className={`ml-auto flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl px-4 font-bold active:scale-95 ${mode !== "view" ? "bg-soon text-ink" : "bg-raised text-muted"}`}>
            {mode !== "view" ? <><Check className="h-4 w-4" /> Fine</> : <><Move className="h-4 w-4" /> Modifica mappa</>}
          </button>
        )}
      </div>

      {/* Barra strumenti editor */}
      {mode !== "view" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border-2 border-soon/50 bg-soon/10 p-2">
          <button onClick={addTable} className="flex min-h-[48px] items-center gap-2 rounded-xl bg-surface px-3.5 font-bold active:scale-95">
            <Plus className="h-4 w-4" /> Tavolo
          </button>
          <button onClick={() => { setMode(mode === "walls" ? "move" : "walls"); setSelId(null); }}
            className={`flex min-h-[48px] items-center gap-2 rounded-xl px-3.5 font-bold active:scale-95 ${mode === "walls" ? "bg-ink text-bg" : "bg-surface"}`}>
            <Wallpaper className="h-4 w-4" /> Muri
          </button>
          <button onClick={() => setSizeOpen((v) => !v)} className="flex min-h-[48px] items-center gap-2 rounded-xl bg-surface px-3.5 font-bold active:scale-95">
            <Ruler className="h-4 w-4" /> Sala
          </button>
          <p className="ml-auto pr-1 text-[13px] font-semibold text-soon">
            {mode === "walls" ? "Traccia un muro trascinando · tocca un muro per toglierlo" : "Trascina i tavoli · tocca per modificarli"}
          </p>
        </div>
      )}

      {/* Dimensioni sala */}
      {mode !== "view" && sizeOpen && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-3">
          {(["w", "h"] as const).map((k) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted">{k === "w" ? "Larghezza" : "Profondità"}</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => saveLayout({ ...layout, [k]: Math.max(400, layout[k] - 100) })}
                  className="grid h-11 w-11 place-items-center rounded-xl bg-raised text-xl font-bold active:scale-95">−</button>
                <span className="w-16 text-center font-display font-extrabold tabular-nums">{(layout[k] / 100).toFixed(1)}m</span>
                <button onClick={() => saveLayout({ ...layout, [k]: Math.min(4000, layout[k] + 100) })}
                  className="grid h-11 w-11 place-items-center rounded-xl bg-raised text-xl font-bold active:scale-95">+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CANVAS */}
      <div ref={wrapRef} className="relative mt-3 w-full touch-none select-none overflow-hidden rounded-3xl border-2 border-line bg-raised/40"
        style={{ height: canvasH }}
        onPointerDown={(e) => { if (mode === "walls") startWall(e); else if (mode === "move") setSelId(null); }}>
        <div className="absolute left-0 top-0 origin-top-left"
          style={{ width: layout.w, height: layout.h, transform: `scale(${scale})` }}>

          {/* Pavimento + griglia + muri perimetrali (i limiti del locale) */}
          <div className="absolute inset-0 rounded-[6px] border-[10px] border-oos/70 bg-surface"
            style={{
              backgroundImage: mode !== "view"
                ? `linear-gradient(to right, color-mix(in srgb, var(--line) 70%, transparent) 1px, transparent 1px),
                   linear-gradient(to bottom, color-mix(in srgb, var(--line) 70%, transparent) 1px, transparent 1px)`
                : undefined,
              backgroundSize: `${GRID}px ${GRID}px`,
            }} />

          {/* Arredi fissi: bancone, cucina, scala… */}
          {layout.objects.map((o, i) => (
            <div key={i} className="absolute grid place-items-center rounded-md border-2 border-oos/50 bg-oos/20"
              style={{ left: o.x, top: o.y, width: o.w, height: o.h }}>
              <span className="font-sans font-bold uppercase tracking-wide text-muted" style={{ fontSize: 34 }}>{o.label}</span>
            </div>
          ))}

          {/* Muri interni */}
          {layout.walls.map((w, i) => {
            const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
            const ang = (Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI;
            return (
              <div key={i}
                onPointerDown={(e) => {
                  if (mode !== "walls") return;
                  e.stopPropagation();
                  void saveLayout({ ...layout, walls: layout.walls.filter((_, j) => j !== i) });
                }}
                className={`absolute rounded-full bg-oos ${mode === "walls" ? "cursor-pointer ring-4 ring-over/30" : ""}`}
                style={{ left: w.x1, top: w.y1 - 9, width: len, height: 18, transform: `rotate(${ang}deg)`, transformOrigin: "0 50%" }} />
            );
          })}
          {wallDraft && (() => {
            const len = Math.hypot(wallDraft.x2 - wallDraft.x1, wallDraft.y2 - wallDraft.y1);
            const ang = (Math.atan2(wallDraft.y2 - wallDraft.y1, wallDraft.x2 - wallDraft.x1) * 180) / Math.PI;
            return <div className="absolute rounded-full bg-brand/70"
              style={{ left: wallDraft.x1, top: wallDraft.y1 - 9, width: len, height: 18, transform: `rotate(${ang}deg)`, transformOrigin: "0 50%" }} />;
          })()}

          {/* TAVOLI */}
          {tables.map((t) => {
            const pos = drafts[t.id] ?? { x: t.x, y: t.y };
            const st = states.get(t.id) ?? "libero";
            const seat = byTable.get(t.id);
            const meta = TABLE_STATE[st];
            const selected = selId === t.id && mode !== "view";
            return (
              <div key={t.id}
                onPointerDown={(e) => startDragTable(e, t)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (mode === "view") onPick(t);
                  else if (mode === "move") setSelId(t.id);
                }}
                className={`absolute ${mode === "walls" ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
                style={{ left: pos.x - t.width / 2, top: pos.y - t.height / 2, width: t.width, height: t.height, transform: `rotate(${t.rotation}deg)` }}>
                {/* sedie */}
                {seatDots(t).map((d, i) => (
                  <span key={i} className="absolute rounded-full bg-muted/50"
                    style={{ left: d.x - 11, top: d.y - 11, width: 22, height: 22 }} />
                ))}
                {/* piano del tavolo */}
                <div className={`grid h-full w-full place-items-center border-[6px] bg-surface shadow-sm ${meta.card} ${selected ? "!border-brand ring-[6px] ring-brand/30" : ""}`}
                  style={{ borderRadius: t.shape === "round" ? "50%" : 14 }}>
                  <div style={{ transform: `rotate(${-t.rotation}deg)` }} className="text-center leading-none">
                    <p className="font-display font-extrabold" style={{ fontSize: t.width <= 100 ? 40 : 46 }}>{t.label}</p>
                    <p className="mt-1 font-sans font-bold text-muted" style={{ fontSize: 24 }}>
                      {seat ? `${seat.partySize}p · ${mmssAgo(seat.seatedAt, now)}′` : `${t.capacity}p`}
                    </p>
                    <span className={`mx-auto mt-1.5 block rounded-full ${meta.dot}`} style={{ width: 22, height: 22 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!tables.length && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="rounded-2xl bg-surface px-4 py-3 text-center font-semibold text-muted">
              Nessun tavolo in {room.name}.{isOwner ? " Tocca “Modifica mappa” → “+ Tavolo”." : ""}
            </p>
          </div>
        )}
      </div>

      {/* Legenda in vista normale */}
      {mode === "view" && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
          {(["libero", "occupato", "in_liberazione", "oltre_tempo", "da_pulire", "fuori_servizio"] as TableLiveState[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
              <span className={`h-2.5 w-2.5 rounded-full ${TABLE_STATE[k].dot}`} /> {TABLE_STATE[k].label}
            </span>
          ))}
        </div>
      )}

      {/* Pannello del tavolo selezionato */}
      {sel && mode === "move" && (
        <TablePanel t={sel} onClose={() => setSelId(null)} onPatch={(p) => saveGeometry(sel.id, p)}
          onDelete={async () => {
            try {
              await api(`/api/tables/${sel.id}`, { method: "DELETE", body: owner });
              setSelId(null); await refresh();
              toast({ title: `Tavolo ${sel.label} rimosso dalla mappa`, tone: "ok" });
            } catch (e: any) { toast({ title: e.message, tone: "err" }); }
          }} />
      )}
    </div>
  );
}

// Sedie disegnate attorno al tavolo: rendono leggibile la capienza a colpo d'occhio.
function seatDots(t: TableT): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = Math.min(t.capacity, 12);
  if (t.shape === "round") {
    const r = Math.max(t.width, t.height) / 2 + 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: t.width / 2 + Math.cos(a) * r, y: t.height / 2 + Math.sin(a) * r });
    }
    return out;
  }
  // rettangolari: metà sopra, metà sotto (e i capotavola se dispari/grande)
  const perSide = Math.ceil(n / 2);
  for (let i = 0; i < perSide; i++) {
    const x = ((i + 1) / (perSide + 1)) * t.width;
    out.push({ x, y: -16 });
  }
  for (let i = 0; i < n - perSide; i++) {
    const x = ((i + 1) / (n - perSide + 1)) * t.width;
    out.push({ x, y: t.height + 16 });
  }
  return out;
}

function TablePanel({ t, onPatch, onDelete, onClose }: {
  t: TableT; onPatch: (p: Record<string, number | string>) => void; onDelete: () => void; onClose: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const shapes: { k: TableT["shape"]; label: string; icon: React.ReactNode }[] = [
    { k: "round", label: "Tondo", icon: <CircleDot className="h-4 w-4" /> },
    { k: "square", label: "Quadrato", icon: <Square className="h-4 w-4" /> },
    { k: "rect", label: "Rettangolare", icon: <RectangleHorizontal className="h-4 w-4" /> },
  ];
  const setShape = (k: TableT["shape"]) =>
    onPatch(k === "rect" ? { shape: k, width: Math.max(t.width, 190), height: 110 } : { shape: k, width: t.height, height: t.height });

  return (
    <div className="mt-3 rounded-3xl border-2 border-brand/50 bg-surface p-4 shadow-lg">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand font-display text-xl font-extrabold text-on-brand">{t.label}</span>
        <p className="flex-1 font-bold">Tavolo {t.label} <span className="font-semibold text-muted">· {t.capacity} posti</span></p>
        <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl bg-raised text-muted active:scale-95" aria-label="Chiudi"><X className="h-5 w-5" /></button>
      </div>

      <p className="mt-3 text-sm font-semibold text-muted">Coperti</p>
      <div className="mt-1 flex items-center gap-3">
        <button onClick={() => onPatch({ capacity: Math.max(1, t.capacity - 1) })} className="grid h-14 w-14 place-items-center rounded-2xl bg-raised text-2xl font-bold active:scale-95">−</button>
        <span className="w-12 text-center font-display text-3xl font-extrabold tabular-nums">{t.capacity}</span>
        <button onClick={() => onPatch({ capacity: Math.min(20, t.capacity + 1) })} className="grid h-14 w-14 place-items-center rounded-2xl bg-raised text-2xl font-bold active:scale-95">+</button>
        <div className="ml-auto flex gap-2">
          <button onClick={() => onPatch({ rotation: t.rotation + 15 })} className="flex h-14 items-center gap-1.5 rounded-2xl bg-raised px-4 font-bold active:scale-95"><RotateCw className="h-5 w-5" /> 15°</button>
          <button onClick={() => onPatch({ rotation: t.rotation + 90 })} className="flex h-14 items-center gap-1.5 rounded-2xl bg-raised px-4 font-bold active:scale-95"><RotateCw className="h-5 w-5" /> 90°</button>
        </div>
      </div>

      <p className="mt-3 text-sm font-semibold text-muted">Forma</p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {shapes.map((sh) => (
          <button key={sh.k} onClick={() => setShape(sh.k)}
            className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl text-sm font-bold active:scale-95 ${t.shape === sh.k ? "bg-brand text-on-brand" : "bg-raised"}`}>
            {sh.icon} {sh.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm font-semibold text-muted">Dimensione</p>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div className="flex items-center justify-between rounded-2xl bg-raised px-3 py-2">
          <span className="text-sm font-semibold">Largh.</span>
          <div className="flex items-center gap-1">
            <button onClick={() => onPatch({ width: t.width - 20, ...(t.shape !== "rect" ? { height: t.width - 20 } : {}) })} className="grid h-11 w-11 place-items-center rounded-xl bg-surface text-xl font-bold active:scale-95"><Minus className="h-4 w-4" /></button>
            <span className="w-12 text-center font-bold tabular-nums">{t.width}</span>
            <button onClick={() => onPatch({ width: t.width + 20, ...(t.shape !== "rect" ? { height: t.width + 20 } : {}) })} className="grid h-11 w-11 place-items-center rounded-xl bg-surface text-xl font-bold active:scale-95"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-raised px-3 py-2">
          <span className="text-sm font-semibold">Prof.</span>
          <div className="flex items-center gap-1">
            <button onClick={() => onPatch({ height: t.height - 20, ...(t.shape !== "rect" ? { width: t.height - 20 } : {}) })} className="grid h-11 w-11 place-items-center rounded-xl bg-surface text-xl font-bold active:scale-95"><Minus className="h-4 w-4" /></button>
            <span className="w-12 text-center font-bold tabular-nums">{t.height}</span>
            <button onClick={() => onPatch({ height: t.height + 20, ...(t.shape !== "rect" ? { width: t.height + 20 } : {}) })} className="grid h-11 w-11 place-items-center rounded-xl bg-surface text-xl font-bold active:scale-95"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {confirmDel ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={onDelete} className="min-h-[52px] rounded-2xl bg-over font-bold text-white active:scale-95">Sì, togli il {t.label}</button>
          <button onClick={() => setConfirmDel(false)} className="min-h-[52px] rounded-2xl bg-raised font-bold active:scale-95">No</button>
        </div>
      ) : (
        <button onClick={() => setConfirmDel(true)}
          className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-over/15 font-bold text-over active:scale-95">
          <Trash2 className="h-5 w-5" /> Togli dalla mappa
        </button>
      )}
      <p className="mt-2 text-center text-[13px] text-muted">Le occupazioni passate restano nelle statistiche.</p>
    </div>
  );
}
