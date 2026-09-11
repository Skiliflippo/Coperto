"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StaffSession } from "@/lib/types";

type SessionState = {
  staff: StaffSession | null;
  theme: "light" | "dark";
  roomId: string | null;        // ultima sala aperta: diventa la vista predefinita
  roomOrder: string[];          // ordine scelto trascinando i nomi delle sale
  setStaff: (s: StaffSession | null) => void;
  toggleTheme: () => void;
  setRoom: (id: string) => void;
  setRoomOrder: (ids: string[]) => void;
};
export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      staff: null,
      theme: "light",
      roomId: null,
      roomOrder: [],
      setStaff: (staff) => set({ staff }),
      toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
      setRoom: (roomId) => set({ roomId }),
      setRoomOrder: (roomOrder) => set({ roomOrder }),
    }),
    { name: "coperto.session.v2" }
  )
);
