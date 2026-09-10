"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 8_000, refetchOnWindowFocus: true, retry: 1 } },
  }));
  // PWA: service worker basilare (cache shell + network-first sulle API)
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
