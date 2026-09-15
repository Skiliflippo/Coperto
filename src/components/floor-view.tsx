"use client";
// PIANTINA IN SERVIZIO — sola lettura: pan, zoom, tap sul tavolo per agire.
// Ottimizzata per 60 FPS su iPad/tablet:
// - Pan/zoom via transform GPU diretta (nessun re-render React per frame)
// - PointerEvents unificati con capture + rAF batching
// - touch-action: none + overscroll-behavior: none per evitare conflitti con scroll nativo
// - will-change + translate3d per accelerazione hardware su Safari iOS e Chrome Android
import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Pencil, ZoomIn, ZoomOut } from "lucide-react";
import { useSession } from "@/store/session";
import { useViewport } from "@/lib/use-viewport";
import { computeRoomSeats, elementBox, normalizeLayout, polygonBounds, polygonOf } from "@/lib/floor";
import { groupBBox, isCompactGroup } from "@/lib/join";
import { TABLE_STATE } from "@/lib/meta";
import { GridBackdrop, RoomShell, TableNode, ElementNode, JoinedNode, WallLayer, PerimeterOverlay } from "@/components/floor-shapes";
import { FloorEditor } from "@/components/floor-editor";
import { RoomTabs, useActiveRoom } from "@/components/room-tabs";
import { StatusBar, tallyTables } from "@/components/status-bar";
import type { TableStatus } from "@/lib/estimates";
import type { Bootstrap, Seating, TableT } from "@/lib/types";

export function FloorView({ boot, statuses, onPick, viewToggle }: {
  boot: Bootstrap;
  statuses: Map<string, TableStatus>;
  onPick: (t: TableT) => void;
  viewToggle?: React.ReactNode;
}) {
  const staff = useSession((s) => s.staff);
  const isOwner = staff?.role === "titolare";
  const [roomId, setRoomId] = useActiveRoom(boot.rooms);
  const [editing, setEditing] = useState(false);
  const room = boot.rooms.find((r) => r.id === roomId) ?? boot.rooms[0];
  const layout = normalizeLayout(room?.layout);
  const tables = boot.tables.filter((t) => t.roomId === room?.id);
  const roomCounts = tallyTables(tables, statuses);
  const { ref, contentRef, gridRef, vp, fit, zoomBy, isPanning, bind, cancelPan } = useViewport(layout.w, layout.h, {
    padding: 34, bounds: polygonBounds(polygonOf(layout)),
  });

  const poly = polygonOf(layout);
  const seatsByTable = useMemo(
    () => computeRoomSeats(tables, poly, layout.elements.map(elementBox)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room?.id, tables, layout],
  );

  // Tocco vs trascinamento: sotto 8px è tap → apre scheda tavolo.
  // PointerEvents unificati: funziona sia mouse che touch.
  const tapRef = useRef<{ x: number; y: number; key: string; time: number } | null>(null);
  const startTap = (e: React.PointerEvent, key: string) => {
    tapRef.current = { x: e.clientX, y: e.clientY, key, time: Date.now() };
  };
  const endTap = (e: React.PointerEvent, key: string, table: TableT) => {
    const s = tapRef.current;
    tapRef.current = null;
    if (!s || s.key !== key) return;
    // Soglia 8px + 300ms per distinguere tap da pan veloce su tablet
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) return;
    if (Date.now() - s.time > 350) return;
    e.stopPropagation();
    cancelPan();
    onPick(table);
  };

  const joinedGroups = new Map<string, { seating: Seating; tables: TableT[] }>();
  for (const t of tables) {
    const seat = statuses.get(t.id)?.seating;
    if (!seat || seat.tableIds.length < 2) continue;
    const g = joinedGroups.get(seat.id) ?? { seating: seat, tables: [] };
    g.tables.push(t);
    joinedGroups.set(seat.id, g);
  }
  for (const [id, g] of joinedGroups) {
    if (g.tables.length < 2 || !isCompactGroup(g.tables)) joinedGroups.delete(id);
  }
  const joinedTableIds = new Set([...joinedGroups.values()].flatMap((g) => g.tables.map((t) => t.id)));

  useEffect(() => { fit(); }, [roomId, fit]);
  if (!room) return null;

  return (
    <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
      <RoomTabs rooms={boot.rooms} active={room.id} onPick={setRoomId} right={
        <div className="flex shrink-0 items-center gap-1.5">
          {isOwner && (
            <button onClick={() => setEditing(true)} aria-label="Modifica mappa" title="Modifica mappa"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-raised text-muted active:scale-95">
              <Pencil className="h-[17px] w-[17px]" />
            </button>
          )}
          {viewToggle}
        </div>
      } />

      {/* Container mappa: GPU + touch-optimizations per 60 FPS su tablet */}
      <div
        ref={ref}
        onPointerDown={bind.onPointerDown}
        onPointerMove={bind.onPointerMove}
        onPointerUp={bind.onPointerUp}
        onPointerCancel={bind.onPointerCancel}
        className={`floor-viewport relative -mx-3 mt-2 min-h-[240px] flex-1 overflow-hidden rounded-2xl border border-line bg-bg ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          ...(bind.style as any),
          WebkitOverflowScrolling: "auto" as any,
          willChange: isPanning ? "transform" : undefined,
        }}
      >
        <GridBackdrop ref={gridRef} vp={vp} />

        <div
          ref={contentRef}
          className="floor-content absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate3d(${vp.panX}px, ${vp.panY}px, 0) scale(${vp.zoom})`,
            willChange: "transform",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden" as any,
            transformStyle: "preserve-3d",
            contain: "layout style paint",
          }}
        >
          <RoomShell w={layout.w} h={layout.h} polygon={layout.polygon} />
          <WallLayer elements={layout.elements} roomW={layout.w} roomH={layout.h} />
          <PerimeterOverlay w={layout.w} h={layout.h} polygon={layout.polygon} />
          {[...layout.elements]
            .sort((a, b) => Number(a.kind === "decor") - Number(b.kind === "decor"))
            .map((el) => <ElementNode key={el.id} el={el} />)}

          {tables.filter((t) => !joinedTableIds.has(t.id)).map((t) => {
            const st = statuses.get(t.id);
            const meta = TABLE_STATE[st?.state ?? "libero"];
            const extra = t.maxCapacity > t.capacity ? `-${t.maxCapacity}` : "";
            const sub = st?.seating
              ? `${st.seating.partySize}p · ${st.minutesSeated}′`
              : st?.state === "prenotato"
                ? `${st.reservation?.time} · ${st.reservation?.partySize}p`
                : `${t.capacity}${extra}p`;
            return (
              <TableNode key={t.id} t={t} tone={meta.card} dotClass={meta.dot} sub={sub} seats={seatsByTable.get(t.id)}
                onPointerDown={(e) => startTap(e, t.id)}
                onPointerUp={(e) => endTap(e, t.id, t)} />
            );
          })}

          {[...joinedGroups.values()].map(({ seating, tables: group }) => {
            const st = statuses.get(group[0].id);
            const meta = TABLE_STATE[st?.state ?? "occupato"];
            const box = groupBBox(group);
            const label = [...group].sort((a, b) => Number(a.label) - Number(b.label)).map((t) => t.label).join("+");
            return (
              <JoinedNode key={seating.id} box={box}
                label={label} tone={meta.card} dotClass={meta.dot}
                sub={`${seating.partySize}p · ${st?.minutesSeated ?? 0}′`}
                onPointerDown={(e) => startTap(e, seating.id)}
                onPointerUp={(e) => endTap(e, seating.id, group[0])} />
            );
          })}
        </div>

        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          <button onClick={() => zoomBy(1.25)} className="grid h-10 w-10 place-items-center rounded-xl bg-surface shadow ring-1 ring-line active:scale-95" aria-label="Ingrandisci"><ZoomIn className="h-4 w-4" /></button>
          <button onClick={() => zoomBy(0.8)} className="grid h-10 w-10 place-items-center rounded-xl bg-surface shadow ring-1 ring-line active:scale-95" aria-label="Riduci"><ZoomOut className="h-4 w-4" /></button>
          <button onClick={fit} className="grid h-10 w-10 place-items-center rounded-xl bg-surface shadow ring-1 ring-line active:scale-95" aria-label="Adatta"><Maximize2 className="h-4 w-4" /></button>
        </div>

        {!tables.length && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="rounded-2xl bg-surface px-4 py-3 text-center font-semibold text-muted shadow">
              Nessun tavolo in {room.name}.{isOwner ? " Tocca la matita per disegnarli." : ""}
            </p>
          </div>
        )}
      </div>

      <div className="mt-1.5 shrink-0">
        <StatusBar counts={roomCounts}>
          <span className="shrink-0 font-medium opacity-60">· tocca un tavolo per sedere o liberare</span>
        </StatusBar>
      </div>

      {editing && isOwner && <FloorEditor boot={boot} roomId={room.id} onClose={() => setEditing(false)} />}
    </div>
  );
}
