"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setApiIdentity } from "@/lib/api";
import type { StaffSession } from "@/lib/types";

type SessionState = {
  staff: StaffSession | null;
  slug: string | null;          // ristorante attualmente aperto (/r/<slug>)
  /** Locale memorizzato sul dispositivo: sopravvive al logout e riapre la sala. */
  rememberedSlug: string | null;
  theme: "light" | "dark";
  /** Palette scelta su QUESTO dispositivo. Se assente si usa il tema del locale. */
  deviceTheme?: string;
  /** Palette effettiva in uso: serve al ThemeScript per il no-flash all'apertura */
  restaurantTheme?: string;
  /** Scala font (accessibilità): 75 = molto piccolo, 100 = standard, 125 = grande */
  fontScale?: number;
  roomId: string | null;        // ultima sala aperta: diventa la vista predefinita
  roomOrder: string[];          // ordine scelto trascinando i nomi delle sale
  hydrated: boolean;            // true quando localStorage è stato letto sul client
  setStaff: (s: StaffSession | null) => void;
  setSlug: (slug: string | null) => void;
  rememberLocale: (slug: string) => void;
  forgetLocale: () => void;
  toggleTheme: () => void;
  setDeviceTheme: (theme: string | undefined) => void;
  setRestaurantTheme: (theme: string) => void;
  setFontScale: (value: number) => void;
  setRoom: (id: string) => void;
  setRoomOrder: (ids: string[]) => void;
  setHydrated: (value: boolean) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      staff: null,
      slug: null,
      rememberedSlug: null,
      theme: "light",
      deviceTheme: undefined,
      restaurantTheme: undefined,
      fontScale: undefined,
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
          set({ slug, staff: null, restaurantTheme: undefined, roomId: null, roomOrder: [] });
          return;
        }
        set({ slug });
      },
      // Login riuscito: il dispositivo ricorda questo locale per la prossima
      // apertura da / o dall'icona sulla home.
      rememberLocale: (slug) => set({ rememberedSlug: slug }),
      // "Cambia locale": si dimentica il locale e si torna alla landing.
      forgetLocale: () => set({ rememberedSlug: null, slug: null, staff: null, restaurantTheme: undefined, roomId: null, roomOrder: [] }),
      toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
      setDeviceTheme: (deviceTheme) => set({ deviceTheme }),
      setRestaurantTheme: (restaurantTheme) => set({ restaurantTheme }),
      setFontScale: (fontScale) => set({ fontScale }),
      setRoom: (roomId) => set({ roomId }),
      setRoomOrder: (roomOrder) => set({ roomOrder }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "coperto.session.v4",
      // Il flag è runtime-only: non deve rientrare da localStorage già impostato a true.
      partialize: ({ staff, slug, rememberedSlug, theme, deviceTheme, restaurantTheme, fontScale, roomId, roomOrder }) =>
        ({ staff, slug, rememberedSlug, theme, deviceTheme, restaurantTheme, fontScale, roomId, roomOrder }) as SessionState,
      onRehydrateStorage: () => (state) => {
        // Al ripristino si riallinea l'identità usata dalle chiamate al server.
        setApiIdentity(state?.staff?.id ?? null);
        state?.setHydrated(true);
      },
    },
  ),
);
