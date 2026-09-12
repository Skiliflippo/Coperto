"use client";
// ─────────────────────────────────────────────────────────────────────────────
// WIZARD SALA · si dichiara la forma, poi le misure, poi si apre l'editor.
// Usato sia al primo accesso sia quando il titolare aggiunge una nuova sala:
// un solo percorso, così l'esperienza è identica nei due casi.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CircleDot, Maximize2, Pencil, RectangleHorizontal, Ruler, Square, TriangleAlert, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { toast } from "@/components/toast";
import { Btn } from "@/components/ui";
import { MAX_ROOM_CM, rectPolygon, type Point, type RoomLayout, type TableShape } from "@/lib/floor";
import {
  defaultBulkRows, fitRoomToTables, layoutBulkTables, totalCovers, totalTables,
  type BulkRow, type BulkTable,
} from "@/lib/bulk-tables";
import { FloorEditor } from "@/components/floor-editor";
import type { Bootstrap } from "@/lib/types";

type ShapeKind = "rettangolo" | "elle" | "trapezio" | "libera";

const SHAPES: { kind: ShapeKind; label: string; hint: string; make: (w: number, h: number) => Point[] }[] = [
  { kind: "rettangolo", label: "Rettangolare", hint: "quattro muri dritti", make: (w, h) => rectPolygon(w, h) },
  {
    kind: "elle", label: "A elle", hint: "con un angolo rientrante",
    make: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h * 0.55 }, { x: w * 0.45, y: h * 0.55 }, { x: w * 0.45, y: h }, { x: 0, y: h }],
  },
  {
    kind: "trapezio", label: "Con muro obliquo", hint: "una parete storta",
    make: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: w * 0.28, y: h }],
  },
  { kind: "libera", label: "La disegno io", hint: "parto da un rettangolo", make: (w, h) => rectPolygon(w, h) },
];

export function ShapePreview({ points, active, big, maxSize }: {
  points: Point[]; active?: boolean; big?: boolean; maxSize?: number;
}) {
  // Riquadro reale della forma: senza questo il viewBox e le dimensioni SVG
  // andavano per conto loro e la preview si deformava aumentando le misure.
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const shapeW = Math.max(1, Math.max(...xs) - minX);
  const shapeH = Math.max(1, Math.max(...ys) - minY);

  const box = maxSize ?? (big ? 240 : 52);

  // Il bordo è disegnato con vectorEffect="non-scaling-stroke": lo spessore è in
  // PIXEL DELLO SCHERMO, quindi dev'essere una costante. Calcolarlo come frazione
  // delle misure della sala (in cm) faceva ingrassare il muro all'aumentare delle
  // dimensioni, fino a coprire tutto il pavimento.
  const strokePx = big ? 3 : 2;

  // Nessun margine nel viewBox: il riquadro coincide esattamente con la sala,
  // quindi le proporzioni mostrate sono quelle reali anche su sale molto
  // allungate. Il mezzo tratto che sborda si vede grazie a overflow-visible.
  const scale = Math.min(box / shapeW, box / shapeH);   // stessa scala sui due assi

  return (
    <svg
      width={shapeW * scale}
      height={shapeH * scale}
      viewBox={`${minX} ${minY} ${shapeW} ${shapeH}`}
      className={`overflow-visible ${big ? "" : "shrink-0"}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Anteprima della forma della sala"
    >
      <polygon points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill={active ? "var(--brand-soft)" : "var(--raised)"}
        stroke={active ? "var(--brand)" : "var(--muted)"}
        strokeWidth={strokePx}
        strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function RoomWizard({ boot, mode, onDone, onCancel }: {
  boot: Bootstrap;
  mode: "primo-accesso" | "nuova-sala";
  onDone: () => void;              // chiude il wizard (e conclude l'onboarding se serve)
  onCancel?: () => void;           // solo per "nuova sala": si può annullare
}) {
  const staff = useSession((s) => s.staff);
  const qc = useQueryClient();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [rows, setRows] = useState<BulkRow[]>(() => defaultBulkRows());
  // Proposta di allargamento: compare quando i tavoli dichiarati non ci stanno.
  const [overflow, setOverflow] = useState<{
    placed: number; requested: number;
    grown: { w: number; h: number; tables: BulkTable[]; skipped: number; fits: boolean };
    asIs: BulkTable[];
  } | null>(null);
  const [shape, setShape] = useState<ShapeKind>("rettangolo");
  const [name, setName] = useState(mode === "primo-accesso" ? (boot.rooms[0]?.name ?? "Sala interna") : "");
  const [w, setW] = useState(1200);
  const [h, setH] = useState(800);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const makePolygon = (width: number, height: number) =>
    (SHAPES.find((s) => s.kind === shape) ?? SHAPES[0]).make(width, height);
  const layoutFor = (width: number, height: number): RoomLayout => ({
    w: width, h: height,
    polygon: makePolygon(width, height).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    elements: [],
  });
  const layout = (): RoomLayout => layoutFor(w, h);

  const goToEditor = async () => {
    const roomName = name.trim() || "Sala";
    setBusy(true);
    try {
      const res = await api<{ roomId: string }>("/api/onboarding", {
        method: "POST",
        body: {
          restaurantId: boot.restaurant.id, staffId: staff?.id, staffName: staff?.name,
          roomName, layout: layout(),
          // in modalità "nuova sala" non si tocca la sala esistente
          createNew: mode === "nuova-sala",
        },
      });
      await qc.invalidateQueries({ queryKey: ["bootstrap", staff?.restaurantId] });
      setRoomId(res.roomId);
      setStep(mode === "primo-accesso" ? 2 : 3);
    } catch (error: unknown) {
      toast({ title: error instanceof Error ? error.message : "Non riuscito", tone: "err" });
    }
    setBusy(false);
  };

  // Scrive sul server il layout scelto (eventualmente allargato) con i suoi tavoli.
  const persistBulk = async (roomLayout: RoomLayout, tables: BulkTable[]) => {
    if (!roomId) return;
    setBusy(true);
    try {
      await api(`/api/rooms/${roomId}/floor`, {
        method: "PUT",
        body: { staffId: staff?.id, staffName: staff?.name, layout: roomLayout, tables, deleted: [] },
      });
      await qc.invalidateQueries({ queryKey: ["bootstrap", staff?.restaurantId] });
      setW(roomLayout.w);
      setH(roomLayout.h);
      setOverflow(null);
      setStep(3);
    } catch (error: unknown) {
      toast({ title: error instanceof Error ? error.message : "Non riuscito", tone: "err" });
      setBusy(false);
    }
  };

  // I tavoli dichiarati vengono disposti su griglia. Se non ci stanno tutti si
  // chiede cosa fare: allargare la sala o tenere solo quelli che entrano.
  const saveBulkTables = async () => {
    if (!roomId || busy) return;
    const requested = totalTables(rows);
    if (requested === 0) { setStep(3); return; }

    const attempt = layoutBulkTables(rows, layout());
    if (attempt.skipped === 0) {
      await persistBulk(layout(), attempt.tables);
      return;
    }
    // misure spesso approssimative: si propone l'allargamento invece di scartare
    const grown = fitRoomToTables(rows, makePolygon, w, h);
    setOverflow({ placed: attempt.tables.length, requested, grown, asIs: attempt.tables });
  };

  const finish = async () => {
    if (mode === "primo-accesso") {
      await api("/api/onboarding", {
        method: "POST",
        body: { restaurantId: boot.restaurant.id, staffId: staff?.id, staffName: staff?.name, finish: true },
      });
    }
    await qc.invalidateQueries({ queryKey: ["bootstrap", staff?.restaurantId] });
    toast({ title: mode === "primo-accesso" ? "Sala pronta" : `Sala "${name.trim() || "Sala"}" creata`, tone: "ok" });
    onDone();
  };

  // Ultimo passo: l'editor vero, dove si disegnano muri e tavoli.
  if (step === 3 && roomId) {
    return <FloorEditor boot={boot} roomId={roomId} onClose={finish} />;
  }

  return (
    <>
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-bg px-5 pb-10" style={{ paddingTop: "calc(env(safe-area-inset-top) + 28px)" }}>
      <div className="mx-auto max-w-lg">
        <div className="flex items-center gap-3">
          {(mode === "primo-accesso" ? [0, 1, 2, 3] : [0, 1, 3]).map((i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand" : "bg-raised"}`} />
          ))}
          {onCancel && (
            <button onClick={onCancel} aria-label="Annulla"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-raised text-muted active:scale-95">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {step === 0 && (
          <div className="pt-8">
            {mode === "primo-accesso" ? (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand font-display text-2xl font-bold text-on-brand">C</div>
                <h1 className="mt-4 font-display text-[30px] font-bold leading-tight">Disegniamo la tua sala</h1>
                <p className="mt-2 text-muted">
                  Serve una volta sola. Da qui in poi vedi i tavoli come sono davvero disposti,
                  e sedere qualcuno è questione di un tocco.
                </p>
              </>
            ) : (
              <>
                <h1 className="font-display text-[28px] font-bold leading-tight">Nuova sala</h1>
                <p className="mt-1.5 text-muted">Dehors, soppalco, sala piccola: ogni ambiente ha la sua piantina.</p>
              </>
            )}

            <p className="mt-7 text-sm font-bold uppercase tracking-wide text-muted">Come è fatta?</p>
            <div className="mt-2 grid gap-2">
              {SHAPES.map((s) => (
                <button key={s.kind} onClick={() => setShape(s.kind)}
                  className={`flex min-h-[68px] items-center gap-3 rounded-2xl border-2 px-4 text-left active:scale-[0.98] ${shape === s.kind ? "border-brand bg-brand/10" : "border-line bg-surface"}`}>
                  <ShapePreview points={s.make(100, 68)} active={shape === s.kind} />
                  <span className="flex-1">
                    <span className="block font-bold">{s.label}</span>
                    <span className="block text-[13px] text-muted">{s.hint}</span>
                  </span>
                  {shape === s.kind && <Check className="h-5 w-5 text-brand" />}
                </button>
              ))}
            </div>
            <div className="mt-6"><Btn size="xl" onClick={() => setStep(1)}>Avanti <ArrowRight className="h-5 w-5" /></Btn></div>
          </div>
        )}

        {step === 1 && (
          <div className="pt-8">
            <h1 className="font-display text-[28px] font-bold leading-tight">Quanto è grande?</h1>
            <p className="mt-1.5 text-muted">Va bene anche a occhio: potrai correggere quando vuoi.</p>

            <label className="mt-6 block">
              <span className="mb-1.5 block text-sm font-semibold text-muted">Nome della sala</span>
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 30))}
                placeholder="es. Dehors"
                className="min-h-[56px] w-full rounded-2xl border border-line bg-surface px-4 font-semibold outline-none focus:border-brand" />
            </label>

            <div className="mt-4 space-y-2">
              {([["Larghezza", w, setW], ["Profondità", h, setH]] as const).map(([label, val, set]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3">
                  <span className="flex items-center gap-2 text-[15px] font-semibold"><Ruler className="h-4 w-4 text-muted" />{label}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => set(Math.max(400, val - 100))} className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-xl font-bold active:scale-95">−</button>
                    <span className="w-20 text-center font-display text-xl font-extrabold tabular-nums">{(val / 100).toFixed(1)} m</span>
                    <button onClick={() => set(Math.min(MAX_ROOM_CM, val + 100))} className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-xl font-bold active:scale-95">+</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid place-items-center rounded-3xl border border-line bg-surface p-5">
              <ShapePreview points={(SHAPES.find((s) => s.kind === shape) ?? SHAPES[0]).make(w, h)} big />
              <p className="mt-2 text-[13px] font-semibold text-muted">{(w / 100).toFixed(1)} × {(h / 100).toFixed(1)} metri</p>
            </div>

            <div className="mt-6 grid gap-2">
              <Btn size="xl" disabled={busy} onClick={goToEditor}>
                {mode === "primo-accesso"
                  ? <>Avanti <ArrowRight className="h-5 w-5" /></>
                  : <><Pencil className="h-5 w-5" /> Disegna muri e tavoli</>}
              </Btn>
              <Btn variant="ghost" onClick={() => setStep(0)}>Indietro</Btn>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="pt-8">
            <h1 className="font-display text-[28px] font-bold leading-tight">Quanti tavoli hai?</h1>
            <p className="mt-1.5 text-muted">
              Dichiara le taglie: li dispongo io nella sala, poi li sposti come vuoi.
              Puoi anche saltare e disegnarli a mano.
            </p>

            <div className="mt-6 space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2.5">
                  <div className="flex shrink-0 items-center gap-1 rounded-xl bg-raised px-1.5 py-1">
                    <button onClick={() => setRows(rows.map((r, j) => j === i ? { ...r, capacity: Math.max(1, r.capacity - 1) } : r))}
                      className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg font-bold active:scale-95">−</button>
                    <span className="w-12 text-center leading-none">
                      <span className="block font-display text-lg font-extrabold tabular-nums">{row.capacity}</span>
                      <span className="block text-[10px] font-bold text-muted">posti</span>
                    </span>
                    <button onClick={() => setRows(rows.map((r, j) => j === i ? { ...r, capacity: Math.min(20, r.capacity + 1) } : r))}
                      className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg font-bold active:scale-95">+</button>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    {([["round", CircleDot], ["square", Square], ["rect", RectangleHorizontal]] as const).map(([shape, Icon]) => (
                      <button key={shape} onClick={() => setRows(rows.map((r, j) => j === i ? { ...r, shape: shape as TableShape } : r))}
                        aria-label={`Forma ${shape}`}
                        className={`grid h-10 w-10 place-items-center rounded-lg active:scale-95 ${row.shape === shape ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}>
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1 rounded-xl bg-raised px-1.5 py-1">
                    <button onClick={() => setRows(rows.map((r, j) => j === i ? { ...r, count: Math.max(0, r.count - 1) } : r))}
                      className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg font-bold active:scale-95">−</button>
                    <span className="w-12 text-center leading-none">
                      <span className="block font-display text-lg font-extrabold tabular-nums">{row.count}</span>
                      <span className="block text-[10px] font-bold text-muted">tavoli</span>
                    </span>
                    <button onClick={() => setRows(rows.map((r, j) => j === i ? { ...r, count: Math.min(40, r.count + 1) } : r))}
                      className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg font-bold active:scale-95">+</button>
                  </div>

                  <button onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Togli questa taglia"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-over/15 text-over active:scale-95">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <button onClick={() => setRows([...rows, { capacity: 8, count: 1, shape: "rect" }])}
                className="min-h-[52px] w-full rounded-2xl border-2 border-dashed border-line font-bold text-muted active:scale-[0.98]">
                + Aggiungi una taglia
              </button>
            </div>

            <p className="mt-4 rounded-2xl bg-raised px-4 py-3 text-center font-bold">
              {totalTables(rows)} tavoli · {totalCovers(rows)} coperti
            </p>

            <div className="mt-5 grid gap-2">
              <Btn size="xl" disabled={busy} onClick={saveBulkTables}>
                <Check className="h-5 w-5" /> Crea i tavoli e sistema la sala
              </Btn>
              <Btn variant="ghost" onClick={() => setStep(3)}>Li disegno a mano</Btn>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* I tavoli dichiarati non ci stanno: si sceglie come procedere. */}
      {overflow && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/55 px-5">
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl">
            <p className="flex items-center gap-2 font-display text-xl font-bold">
              <TriangleAlert className="h-5 w-5 text-soon" /> Non ci stanno tutti
            </p>
            <p className="mt-2 text-sm text-muted">
              In una sala di {(w / 100).toFixed(1)}×{(h / 100).toFixed(1)} m entrano{" "}
              <b className="text-ink">{overflow.placed} tavoli su {overflow.requested}</b>.
              Le misure a occhio si correggono facilmente: posso allargare la sala.
            </p>

            <div className="mt-4 grid gap-2">
              {overflow.grown.fits ? (
                <Btn size="xl" disabled={busy}
                  onClick={() => persistBulk(layoutFor(overflow.grown.w, overflow.grown.h), overflow.grown.tables)}>
                  <Maximize2 className="h-5 w-5" />
                  Allarga a {(overflow.grown.w / 100).toFixed(1)}×{(overflow.grown.h / 100).toFixed(1)} m
                </Btn>
              ) : (
                <Btn size="xl" disabled={busy || overflow.grown.tables.length <= overflow.placed}
                  onClick={() => persistBulk(layoutFor(overflow.grown.w, overflow.grown.h), overflow.grown.tables)}>
                  <Maximize2 className="h-5 w-5" />
                  Allarga al massimo · {overflow.grown.tables.length} tavoli
                </Btn>
              )}
              <Btn variant="soft" disabled={busy}
                onClick={() => persistBulk(layout(), overflow.asIs)}>
                Tieni la sala così · {overflow.placed} tavoli
              </Btn>
              <Btn variant="ghost" disabled={busy} onClick={() => setOverflow(null)}>
                Torna a modificare
              </Btn>
            </div>

            <p className="mt-3 text-center text-[12px] text-muted">
              {overflow.grown.fits
                ? "Potrai comunque ritoccare misure e tavoli nell'editor."
                : `Anche alla dimensione massima ne entrano ${overflow.grown.tables.length}: gli altri li aggiungi a mano.`}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
