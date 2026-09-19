"use client";
// Selettore delle sale: la sala scelta diventa quella predefinita (anche cambiando
// vista mappa/lista). Tenendo premuto si trascina per riordinarle.
import { useRef, useState } from "react";
import { useSession } from "@/store/session";
import type { Room } from "@/lib/types";

export function useOrderedRooms(rooms: Room[]): Room[] {
  const order = useSession((s) => s.roomOrder);
  // order può arrivare null da un localStorage di una versione vecchia/corrotto
  if (!order?.length) return rooms;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...rooms].sort((a, b) => (pos.get(a.id) ?? 99) - (pos.get(b.id) ?? 99));
}

// La sala attiva: l'ultima scelta se esiste ancora, altrimenti la prima.
export function useActiveRoom(rooms: Room[]): [string, (id: string) => void] {
  const saved = useSession((s) => s.roomId);
  const setRoom = useSession((s) => s.setRoom);
  const ordered = useOrderedRooms(rooms);
  const active = ordered.find((r) => r.id === saved)?.id ?? ordered[0]?.id ?? "";
  return [active, setRoom];
}

export function RoomTabs({ rooms, active, onPick, right }: {
  rooms: Room[]; active: string; onPick: (id: string) => void; right?: React.ReactNode;
}) {
  const setRoomOrder = useSession((s) => s.setRoomOrder);
  const ordered = useOrderedRooms(rooms);
  const [dragId, setDragId] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);

  // pressione lunga = riordino; tocco breve = cambio sala
  const onDown = (id: string) => {
    moved.current = false;
    holdTimer.current = setTimeout(() => { setDragId(id); if (navigator.vibrate) navigator.vibrate(15); }, 350);
  };
  const clearHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; };
  const onEnter = (overId: string) => {
    if (!dragId || dragId === overId) return;
    moved.current = true;
    const ids = ordered.map((r) => r.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(overId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setRoomOrder(ids);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
        {ordered.map((r) => (
          <button key={r.id}
            onPointerDown={() => onDown(r.id)}
            onPointerUp={() => { clearHold(); if (!dragId) onPick(r.id); setDragId(null); }}
            onPointerCancel={() => { clearHold(); setDragId(null); }}
            onPointerEnter={() => onEnter(r.id)}
            className={`min-h-[42px] shrink-0 rounded-2xl px-3.5 text-[15px] font-semibold transition-all active:scale-95
              ${r.id === active ? "bg-brand text-on-brand shadow-sm" : "bg-raised text-muted"}
              ${dragId === r.id ? "scale-105 ring-2 ring-brand" : ""}`}>
            {r.name}
          </button>
        ))}
      </div>
      {right}
    </div>
  );
}
