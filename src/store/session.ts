"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StaffSession } from "@/lib/types";

type SessionState = {
  staff: StaffSession | null;
  theme: "light" | "dark";
  roomId: string | null;        // ultima sala aperta: diventa la vista predefinita
  roomOrder: string[];          // ordine scelto trascinando i nomi delle sale
  hydrated: boolean;            // true quando localStorage è stato letto sul client
  setStaff: (s: StaffSession | null) => void;
  toggleTheme: () => void;
  setRoom: (id: string) => void;
  setRoomOrder: (ids: string[]) => void;
  setHydrated: (value: boolean) => void;
};
export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      staff: null,
      theme: "light",
      roomId: null,
      roomOrder: [],
      hydrated: false,
      setStaff: (staff) => set({ staff }),
      toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
      setRoom: (roomId) => set({ roomId }),
      setRoomOrder: (roomOrder) => set({ roomOrder }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "coperto.session.v2",
      // Il flag è runtime-only: non deve rientrare da localStorage già impostato a true.
      partialize: ({ staff, theme, roomId, roomOrder }) => ({ staff, theme, roomId, roomOrder }) as SessionState,
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
    }
  )
);
