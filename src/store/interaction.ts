"use client";
import { create } from "zustand";

type InteractionState = {
  isInteracting: boolean; // true durante drag tavolo, resize muro, pan mappa
  isPanning: boolean; // true solo durante pan/zoom mappa
  setInteracting: (v: boolean) => void;
  setPanning: (v: boolean) => void;
};

export const useInteraction = create<InteractionState>((set) => ({
  isInteracting: false,
  isPanning: false,
  setInteracting: (isInteracting) => set({ isInteracting }),
  setPanning: (isPanning) => set({ isPanning, isInteracting: isPanning }),
}));
