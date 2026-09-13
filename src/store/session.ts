"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setApiIdentity } from "@/lib/api";
import type { StaffSession } from "@/lib/types";

type SessionState = {
  staff: StaffSession | null;
  slug: string | null;          // ristorante attualmente aperto (/r/<slug>)
  theme: "light" | "dark";
  roomId: string | null;        // ultima sala aperta: diventa la vista predefinita
  roomOrder: string[];          // ordine scelto trascinando i nomi delle sale
  hydrated: boolean;            // true quando localStorage è stato letto sul client
  setStaff: (s: StaffSession | null) => void;
  setSlug: (slug: string | null) => void;
  toggleTheme: () => void;
  setRoom: (id: string) => void;
  setRoomOrder: (ids: string[]) => void;
  setHydrated: (value: boolean) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      staff: null,
      slug: null,
      theme: "light",
      roomId: null,
      roomOrder: [],
      hydrated: false,
      setStaff: (staff) => {
        setApiIdentity(staff?.id ?? null);
        set({ staff });
      },
      // Cambiando ristorante la sessione precedente non vale più: si esce.
      setSlug: (slug) => {
        const prev = get().slug;
        if (prev && slug && prev !== slug) {
          setApiIdentity(null);
          set({ slug, staff: null, roomId: null, roomOrder: [] });
          return;
        }
        set({ slug });
      },
      toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
      setRoom: (roomId) => set({ roomId }),
      setRoomOrder: (roomOrder) => set({ roomOrder }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "coperto.session.v3",
      // Il flag è runtime-only: non deve rientrare da localStorage già impostato a true.
      partialize: ({ staff, slug, theme, roomId, roomOrder }) =>
        ({ staff, slug, theme, roomId, roomOrder }) as SessionState,
      onRehydrateStorage: () => (state) => {
        // Al ripristino si riallinea l'identità usata dalle chiamate al server.
        setApiIdentity(state?.staff?.id ?? null);
        state?.setHydrated(true);
      },
    },
  ),
);
