"use client";
// PIANTINA SERVIZIO - riscritta da zero per iOS fluido
// - Pan/zoom 100% locale GPU, niente re-render durante gesto
// - Tap tavoli sempre reattivo, freeze momentum su tap

import { useEffect, useMemo, useState } from "react";
import { Maximize2, Pencil } from "lucide-react";
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

export function FloorView({
  boot,
  statuses,
  onPick,
  viewToggle,
}: {
  boot: Bootstrap;
  statuses: Map<string, TableStatus>;
  onPick: (t: TableT) => void;
  viewToggle?: React.ReactNode;
}) {
  const staff = useSession((s) => s.staff);
  const isOwner = staff?.role === "titolare";
  const [roomId, setRoomId] = useActiveRoom(boot.rooms);
  const [editing, setEditing] = useState(false);

  const room = useMemo(() => boot.rooms.find((r) => r.id === roomId) ?? boot.rooms[0], [boot.rooms, roomId]);
  const layout = useMemo(() => normalizeLayout(room?.layout), [room?.layout]);
  const tables = useMemo(() => boot.tables.filter((t) => t.roomId === room?.id), [boot.tables, room?.id]);
  const roomCounts = useMemo(() => tallyTables(tables, statuses), [tables, statuses]);

  const { ref, contentRef, gridRef, vp, fit, isPanning, bind, freeze } = useViewport(layout.w, layout.h, {
    padding: 36,
    bounds: polygonBounds(polygonOf(layout)),
  });

  const poly = useMemo(() => polygonOf(layout), [layout]);
  const seatsByTable = useMemo(
    () => computeRoomSeats(tables, poly, layout.elements.map(elementBox)),
    [tables, poly, layout.elements],
  );

  // Gruppi tavoli uniti
  const { joinedGroups, joinedTableIds } = useMemo(() => {
    const groups = new Map<string, { seating: Seating; tables: TableT[] }>();
    for (const t of tables) {
      const seat = statuses.get(t.id)?.seating;
      if (!seat || seat.tableIds.length < 2) continue;
      const g = groups.get(seat.id) ?? { seating: seat, tables: [] };
      g.tables.push(t);
      groups.set(seat.id, g);
    }
    for (const [id, g] of groups) {
      if (g.tables.length < 2 || !isCompactGroup(g.tables)) groups.delete(id);
    }
    const ids = new Set([...groups.values()].flatMap((g) => g.tables.map((t) => t.id)));
    return { joinedGroups: groups, joinedTableIds: ids };
  }, [tables, statuses]);

  // fit quando cambia stanza
  useEffect(() => {
    fit();
  }, [roomId, fit]);

  if (!room) return null;

  const handleTableTap = (t: TableT) => {
    freeze();
    onPick(t);
  };

  return (
    <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
      <RoomTabs
        rooms={boot.rooms}
        active={room.id}
        onPick={setRoomId}
        right={
          <div className="flex shrink-0 items-center gap-1.5">
            {isOwner && (
              <button
                onClick={() => setEditing(true)}
                aria-label="Modifica mappa"
                title="Modifica mappa"
                className="grid h-10 w-10 place-items-center rounded-2xl bg-raised text-muted active:scale-95"
              >
                <Pencil className="h-[17px] w-[17px]" />
              </button>
            )}
            {viewToggle}
          </div>
        }
      />

      <div
        ref={ref}
        onTouchStart={bind.onTouchStart}
        onTouchMove={bind.onTouchMove}
        onTouchEnd={bind.onTouchEnd}
        onMouseDown={bind.onMouseDown}
        onMouseMove={bind.onMouseMove}
        onMouseUp={bind.onMouseUp}
        onMouseLeave={bind.onMouseLeave}
        onWheel={bind.onWheel}
        className={`floor-viewport relative -mx-3 mt-2 min-h-[240px] flex-1 overflow-hidden rounded-2xl border border-line bg-bg ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
        style={bind.style as any}
      >
        <GridBackdrop ref={gridRef} vp={vp} />

        <div
          ref={contentRef}
          className="floor-content absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate3d(${vp.panX}px,${vp.panY}px,0) scale(${vp.zoom})`,
            willChange: isPanning ? "transform" : "auto",
          }}
        >
          <RoomShell w={layout.w} h={layout.h} polygon={layout.polygon} />
          <WallLayer elements={layout.elements} roomW={layout.w} roomH={layout.h} />
          <PerimeterOverlay w={layout.w} h={layout.h} polygon={layout.polygon} />
          {[...layout.elements]
            .sort((a, b) => Number(a.kind === "decor") - Number(b.kind === "decor"))
            .map((el) => (
              <ElementNode key={el.id} el={el} />
            ))}

          {tables
            .filter((t) => !joinedTableIds.has(t.id))
            .map((t) => {
              const st = statuses.get(t.id);
              const meta = TABLE_STATE[st?.state ?? "libero"];
              const extra = t.maxCapacity > t.capacity ? `-${t.maxCapacity}` : "";
              const sub = st?.seating
                ? `${st.seating.partySize}p · ${st.minutesSeated}′`
                : st?.state === "prenotato"
                  ? `${st.reservation?.time} · ${st.reservation?.partySize}p`
                  : `${t.capacity}${extra}p`;
              return (
                <TableNode
                  key={t.id}
                  t={t}
                  tone={meta.card}
                  dotClass={meta.dot}
                  sub={sub}
                  seats={seatsByTable.get(t.id)}
                  onClick={() => handleTableTap(t)}
                />
              );
            })}

          {[...joinedGroups.values()].map(({ seating, tables: group }) => {
            const st = statuses.get(group[0].id);
            const meta = TABLE_STATE[st?.state ?? "occupato"];
            const box = groupBBox(group);
            const label = [...group].sort((a, b) => Number(a.label) - Number(b.label)).map((t) => t.label).join("+");
            return (
              <JoinedNode
                key={seating.id}
                box={box}
                label={label}
                tone={meta.card}
                dotClass={meta.dot}
                sub={`${seating.partySize}p · ${st?.minutesSeated ?? 0}′`}
                onClick={() => handleTableTap(group[0])}
              />
            );
          })}
        </div>

        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          <button
            onClick={() => fit()}
            className="grid h-10 w-10 place-items-center rounded-xl bg-surface shadow ring-1 ring-line active:scale-95"
            aria-label="Ripristina vista"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
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
