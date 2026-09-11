"use client";
// PIANTINA IN SERVIZIO — sola lettura: pan, zoom, tap sul tavolo per agire.
// Il tap ha la precedenza sul pan: si distingue trascinamento da tocco con una
// soglia di 8px. I tavoli accostati si vedono come un blocco unico finché sono occupati.
import { useEffect, useRef, useState } from "react";
import { Maximize2, Pencil, ZoomIn, ZoomOut } from "lucide-react";
import { useSession } from "@/store/session";
import { useViewport } from "@/lib/use-viewport";
import { normalizeLayout } from "@/lib/floor";
import { LEGEND_STATES, TABLE_STATE } from "@/lib/meta";
import { GridBackdrop, RoomShell, TableNode, ElementNode, JoinedNode } from "@/components/floor-shapes";
import { FloorEditor } from "@/components/floor-editor";
import { RoomTabs, useActiveRoom } from "@/components/room-tabs";
import { StatusBar, type Tally } from "@/app/(app)/sala/page";
import type { TableStatus } from "@/lib/estimates";
import type { Bootstrap, Seating, TableT } from "@/lib/types";

export function FloorView({ boot, statuses, onPick, viewToggle, counts }: {
  boot: Bootstrap;
  statuses: Map<string, TableStatus>;
  onPick: (t: TableT) => void;
  viewToggle?: React.ReactNode;
  counts: Tally;
}) {
  const staff = useSession((s) => s.staff);
  const isOwner = staff?.role === "titolare";
  const [roomId, setRoomId] = useActiveRoom(boot.rooms);
  const [editing, setEditing] = useState(false);
  const room = boot.rooms.find((r) => r.id === roomId) ?? boot.rooms[0];
  const layout = normalizeLayout(room?.layout);
  const tables = boot.tables.filter((t) => t.roomId === room?.id);
  const { ref, vp, fit, zoomBy, isPanning, bind, cancelPan } = useViewport(layout.w, layout.h, { padding: 26 });

  // Tocco vs trascinamento: sotto gli 8px è un tap → apre la scheda del tavolo.
  const tapRef = useRef<{ x: number; y: number; key: string } | null>(null);
  const startTap = (e: React.PointerEvent, key: string) => { tapRef.current = { x: e.clientX, y: e.clientY, key }; };
  const endTap = (e: React.PointerEvent, key: string, table: TableT) => {
    const s = tapRef.current;
    tapRef.current = null;
    if (!s || s.key !== key) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) return;  // stava spostando la mappa
    e.stopPropagation();
    // ferma il pan: senza questo la mappa continuerebbe a seguire il dito
    // mentre il popup del tavolo è già aperto.
    cancelPan();
    onPick(table);
  };

  // Gruppi di tavoli accostati attualmente occupati: si disegnano come uno solo.
  const joinedGroups = new Map<string, { seating: Seating; tables: TableT[] }>();
  for (const t of tables) {
    const seat = statuses.get(t.id)?.seating;
    if (!seat || seat.tableIds.length < 2) continue;
    const g = joinedGroups.get(seat.id) ?? { seating: seat, tables: [] };
    g.tables.push(t);
    joinedGroups.set(seat.id, g);
  }
  const joinedTableIds = new Set([...joinedGroups.values()].flatMap((g) => g.tables.map((t) => t.id)));

  useEffect(() => { fit(); }, [roomId, fit]);
  if (!room) return null;

  return (
    <div className="mt-2.5">
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

      <div ref={ref} {...bind}
        className={`relative -mx-3 mt-2 h-[min(66dvh,620px)] touch-none overflow-hidden rounded-2xl border border-line bg-bg ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}>
        <GridBackdrop vp={vp} />
        <div className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate3d(${vp.panX}px, ${vp.panY}px, 0) scale(${vp.zoom})` }}>
          <RoomShell w={layout.w} h={layout.h} polygon={layout.polygon} />
          {layout.elements.map((el) => <ElementNode key={el.id} el={el} />)}

          {/* tavoli singoli */}
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
              <TableNode key={t.id} t={t} tone={meta.card} dotClass={meta.dot} sub={sub}
                onPointerDown={(e) => startTap(e, t.id)}
                onPointerUp={(e) => endTap(e, t.id, t)} />
            );
          })}

          {/* tavoli accostati: un blocco unico finché il gruppo è seduto */}
          {[...joinedGroups.values()].map(({ seating, tables: group }) => {
            const st = statuses.get(group[0].id);
            const meta = TABLE_STATE[st?.state ?? "occupato"];
            const pad = 14;
            const x1 = Math.min(...group.map((t) => t.x - t.width / 2)) - pad;
            const y1 = Math.min(...group.map((t) => t.y - t.height / 2)) - pad;
            const x2 = Math.max(...group.map((t) => t.x + t.width / 2)) + pad;
            const y2 = Math.max(...group.map((t) => t.y + t.height / 2)) + pad;
            const label = group.map((t) => t.label).sort((a, b) => Number(a) - Number(b)).join("+");
            return (
              <JoinedNode key={seating.id} box={{ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }}
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

      {editing && isOwner && <FloorEditor boot={boot} roomId={room.id} onClose={() => setEditing(false)} />}
    </div>
  );
}
