"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StaffSession } from "@/lib/types";

type SessionState = {
  staff: StaffSession | null;
  theme: "light" | "dark";
  setStaff: (s: StaffSession | null) => void;
  toggleTheme: () => void;
};
export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      staff: null,
      theme: "light",
      setStaff: (staff) => set({ staff }),
      toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
    }),
    { name: "coperto.session.v1" }
  )
);
