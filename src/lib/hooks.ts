"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "@/store/session";
import { useTenant, withSlug } from "@/lib/tenant";
import type { Bootstrap, DayData } from "./types";
import { toast } from "@/components/toast";

export function useBootstrap() {
  const staff = useSession((s) => s.staff);
  const slug = useTenant();
  const rid = staff?.restaurantId;
  return useQuery({
    // La cache è per ristorante: aprendo un altro locale non si riusa la sua.
    queryKey: ["bootstrap", slug || rid || "default"],
    queryFn: async () => {
      const data = await api<Bootstrap>(withSlug(slug, `/api/bootstrap${rid ? `?rid=${encodeURIComponent(rid)}` : ""}`));
      // Dopo clone/reseed il browser può conservare UUID di ristorante e staff
      // appartenenti al vecchio DB. Non trasferiamo un'identità fra tenant:
      // azzeriamo la sessione e AppShell riporta al login del database corrente.
      // Fix iPhone: se slug è vuoto (fallback server al primo ristorante), non cancellare lo staff
      // appena loggato — altrimenti si torna al login in loop.
      if (staff && slug && data.restaurant.id !== staff.restaurantId) {
        // Solo se lo slug nell'URL è autorevole e non corrisponde al ristorante dello staff,
        // allora lo staff è di un altro locale → logout
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
    refetchInterval: 30_000, // rete di riserva se il realtime cade
  });
}

// Clock vivo per i timer della sala
export function useNow(stepMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

// Realtime SSE: ogni cambiamento di un collega → invalida + notifica "chi ha fatto cosa"
export function useRealtime(): "online" | "offline" | "connecting" {
  const rid = useSession((s) => s.staff?.restaurantId);
  const myName = useSession((s) => s.staff?.name);
  const qc = useQueryClient();
  const [status, setStatus] = useState<"online" | "offline" | "connecting">("connecting");

  useEffect(() => {
    if (!rid) return;
    let es: EventSource | null = null;
    let closed = false;
    const connect = () => {
      if (closed) return;
      setStatus("connecting");
      es = new EventSource(`/api/events?rid=${rid}`);
      es.onopen = () => setStatus("online");
      es.onerror = () => { setStatus(navigator.onLine ? "connecting" : "offline"); es?.close(); setTimeout(connect, 3000); };
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.kind === "ping" || d.kind === "hello") return;
          qc.invalidateQueries({ queryKey: ["day", rid] });
          qc.invalidateQueries({ queryKey: ["bootstrap"] });
          qc.invalidateQueries({ queryKey: ["summary", rid] });
          if (d.msg && d.actor && d.actor !== myName) {
            toast({ title: d.msg, tone: d.kind === "seating" ? "ok" : "info" });
          }
        } catch { /* json non valido */ }
      };
    };
    connect();
    const onOff = () => setStatus(navigator.onLine ? "connecting" : "offline");
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOff);
    return () => {
      closed = true; es?.close();
      window.removeEventListener("offline", onOff);
      window.removeEventListener("online", onOff);
    };
  }, [rid, myName, qc]);
  return status;
}
