"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { setApiIdentity } from "@/lib/api";
import type { StaffSession } from "@/lib/types";

type SessionState = {
  staff: StaffSession | null;
  slug: string | null;          // ristorante attualmente aperto (/r/<slug>)
  /** Locale memorizzato sul dispositivo: sopravvive al logout e riapre la sala. */
  rememberedSlug: string | null;
  theme: "light" | "dark";
  roomId: string | null;        // ultima sala aperta: diventa la vista predefinita
  roomOrder: string[];          // ordine scelto trascinando i nomi delle sale
  hydrated: boolean;            // true quando localStorage è stato letto sul client
  setStaff: (s: StaffSession | null) => void;
  setSlug: (slug: string | null) => void;
  rememberLocale: (slug: string) => void;
  forgetLocale: () => void;
  toggleTheme: () => void;
  setRoom: (id: string) => void;
  setRoomOrder: (ids: string[]) => void;
  setHydrated: (value: boolean) => void;
};

// Storage sicuro per iOS Safari: in private mode o PWA, localStorage può lanciare SecurityError
// e bloccare la hydration di zustand → l'app resta chiodata su "sta aprendo la sala"
const safeStorage = {
  getItem: (name: string) => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(name, value);
    } catch {
      // quota exceeded o SecurityError su iOS private → ignora, l'app funziona in memoria
    }
  },
  removeItem: (name: string) => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.removeItem(name);
    } catch {
      // ignora
    }
  },
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      staff: null,
      slug: null,
      rememberedSlug: null,
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
      // Login riuscito: il dispositivo ricorda questo locale per la prossima
      // apertura da / o dall'icona sulla home.
      rememberLocale: (slug) => set({ rememberedSlug: slug }),
      // "Cambia locale": si dimentica il locale e si torna alla landing.
      forgetLocale: () => set({ rememberedSlug: null, slug: null, staff: null, roomId: null, roomOrder: [] }),
      toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
      setRoom: (roomId) => set({ roomId }),
      setRoomOrder: (roomOrder) => set({ roomOrder }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "coperto.session.v4",
      storage: createJSONStorage(() => safeStorage as any),
      // Il flag è runtime-only: non deve rientrare da localStorage già impostato a true.
      partialize: ({ staff, slug, rememberedSlug, theme, roomId, roomOrder }) =>
        ({ staff, slug, rememberedSlug, theme, roomId, roomOrder }) as SessionState,
      // Fix iPhone: se l'utente fa login prima che la rehydration finisca (iOS lento),
      // la merge di default sovrascriverebbe staff con null dal vecchio storage → torna al login.
      merge: (persisted, current) => {
        const p = persisted as Partial<SessionState> | undefined;
        if (!p) return current as SessionState;
        return {
          ...current,
          ...p,
          staff: (current as SessionState).staff ?? p.staff ?? null,
          slug: (current as SessionState).slug ?? p.slug ?? null,
          rememberedSlug: p.rememberedSlug ?? (current as SessionState).rememberedSlug ?? null,
          theme: p.theme ?? (current as SessionState).theme,
          roomId: p.roomId ?? (current as SessionState).roomId ?? null,
          roomOrder: p.roomOrder ?? (current as SessionState).roomOrder ?? [],
          hydrated: (current as SessionState).hydrated,
        } as SessionState;
      },
      onRehydrateStorage: () => (state, error) => {
        try {
          const currentStaff = useSession.getState().staff ?? state?.staff ?? null;
          setApiIdentity(currentStaff?.id ?? null);
          if (currentStaff && state && !state.staff) {
            // preserva login avvenuto durante rehydration lenta
            state.staff = currentStaff;
          }
        } catch {}
        if (error) {
          try {
            safeStorage.removeItem("coperto.session.v4");
          } catch {}
        }
        state?.setHydrated(true);
        try {
          const s = useSession.getState();
          if (!s.hydrated) s.setHydrated(true);
        } catch {}
      },
    },
  ),
);
