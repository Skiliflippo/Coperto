"use client";
// Blocca zoom pagina su iOS Safari per feel PWA nativa.
// - gesturestart/change/end -> blocca pinch-zoom pagina (iOS)
// - doppio tap rapido -> blocca zoom fuori da input/button
import { useEffect } from "react";

export function PwaGuard() {
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();

    // iOS Safari pinch-zoom pagina (non-standard ma supportato)
    document.addEventListener("gesturestart", prevent as EventListener, { passive: false } as any);
    document.addEventListener("gesturechange", prevent as EventListener, { passive: false } as any);
    document.addEventListener("gestureend", prevent as EventListener, { passive: false } as any);

    let lastTouchEnd = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        const target = e.target as HTMLElement;
        if (!target.closest("input, textarea, button, a, [contenteditable], [role='button']")) {
          e.preventDefault();
        }
      }
      lastTouchEnd = now;
    };
    document.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", prevent as EventListener);
      document.removeEventListener("gesturechange", prevent as EventListener);
      document.removeEventListener("gestureend", prevent as EventListener);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
  return null;
}
