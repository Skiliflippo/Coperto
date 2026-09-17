"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "@/store/session";
import { useTenant, withSlug } from "@/lib/tenant";
import { useInteraction } from "@/store/interaction";
import type { Bootstrap, DayData } from "./types";
import { toast } from "@/components/toast";

export function useBootstrap() {
  const staff = useSession((s) => s.staff);
  const slug = useTenant();
  const rid = staff?.restaurantId;
  return useQuery({
    queryKey: ["bootstrap", slug || rid || "default"],
    queryFn: async () => {
      const data = await api<Bootstrap>(withSlug(slug, `/api/bootstrap${rid ? `?rid=${encodeURIComponent(rid)}` : ""}`));
      if (staff && slug && data.restaurant.id !== staff.restaurantId) {
        if (data.restaurant.slug === slug) {
          useSession.getState().setStaff(null);
        }
      }
      return data;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export function useDay(date: string) {
  const rid = useSession((s) => s.staff?.restaurantId);
  return useQuery({
    queryKey: ["day", rid, date],
    queryFn: () => api<DayData>(`/api/day?rid=${rid}&date=${date}`),
    enabled: !!rid,
    // Local-First: durante interazione touch non refetchare per non interrompere gesto
    refetchInterval: () => {
      try {
        if (useInteraction.getState().isInteracting) return false as any;
      } catch {}
      return 30_000;
    },
    refetchIntervalInBackground: false,
  });
}

export function useNow(stepMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

// Realtime SSE Local-First:
// - Aggiorna cache in background
// - Se utente sta trascinando (isInteracting), non invalidare subito: accoda e ritenta
export function useRealtime(): "online" | "offline" | "connecting" {
  const rid = useSession((s) => s.staff?.restaurantId);
  const myName = useSession((s) => s.staff?.name);
  const qc = useQueryClient();
  const [status, setStatus] = useState<"online" | "offline" | "connecting">("connecting");
  const pendingInvalidation = useRef(false);

  useEffect(() => {
    if (!rid) return;
    let es: EventSource | null = null;
    let closed = false;
    let retryTimer: number | null = null;

    const doInvalidate = () => {
      try {
        if (useInteraction.getState().isInteracting) {
          pendingInvalidation.current = true;
          if (retryTimer) window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => {
            if (!useInteraction.getState().isInteracting) {
              pendingInvalidation.current = false;
              qc.invalidateQueries({ queryKey: ["day", rid] });
              qc.invalidateQueries({ queryKey: ["bootstrap"] });
              qc.invalidateQueries({ queryKey: ["summary", rid] });
            } else {
              doInvalidate();
            }
          }, 500) as unknown as number;
          return;
        }
      } catch {}
      qc.invalidateQueries({ queryKey: ["day", rid] });
      qc.invalidateQueries({ queryKey: ["bootstrap"] });
      qc.invalidateQueries({ queryKey: ["summary", rid] });
    };

    const connect = () => {
      if (closed) return;
      setStatus("connecting");
      es = new EventSource(`/api/events?rid=${rid}`);
      es.onopen = () => setStatus("online");
      es.onerror = () => {
        setStatus(navigator.onLine ? "connecting" : "offline");
        es?.close();
        setTimeout(connect, 3000);
      };
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.kind === "ping" || d.kind === "hello") return;
          doInvalidate();
          if (d.msg && d.actor && d.actor !== myName) {
            toast({ title: d.msg, tone: d.kind === "seating" ? "ok" : "info" });
          }
        } catch {}
      };
    };
    connect();

    // Quando finisce interazione, flush pending invalidations
    let unsub: (() => void) | null = null;
    try {
      unsub = useInteraction.subscribe((s) => {
        if (!s.isInteracting && pendingInvalidation.current) {
          pendingInvalidation.current = false;
          qc.invalidateQueries({ queryKey: ["day", rid] });
          qc.invalidateQueries({ queryKey: ["bootstrap"] });
          qc.invalidateQueries({ queryKey: ["summary", rid] });
        }
      });
    } catch {}

    const onOff = () => setStatus(navigator.onLine ? "connecting" : "offline");
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOff);
    return () => {
      closed = true;
      es?.close();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (unsub) unsub();
      window.removeEventListener("offline", onOff);
      window.removeEventListener("online", onOff);
    };
  }, [rid, myName, qc]);
  return status;
}
