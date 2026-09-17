"use client";
// Optimistic UI helpers per azioni operative sui tavoli
// Local-First: aggiorna cache React Query immediatamente, poi sync in background
import type { QueryClient } from "@tanstack/react-query";
import type { DayData, Seating, Bootstrap, TableT } from "./types";
import { todayISO } from "./time";

export function optimisticDayUpdate(
  qc: QueryClient,
  rid: string | undefined,
  date: string,
  updater: (old: DayData) => DayData,
) {
  if (!rid) return;
  qc.setQueryData<DayData>(["day", rid, date], (old) => {
    if (!old) return old as any;
    return updater(old);
  });
}

export function optimisticBootstrapUpdate(
  qc: QueryClient,
  slug: string | undefined,
  rid: string | undefined,
  updater: (old: Bootstrap) => Bootstrap,
) {
  const key = ["bootstrap", slug || rid || "default"];
  qc.setQueryData<Bootstrap>(key, (old) => {
    if (!old) return old as any;
    return updater(old);
  });
}

// Crea seating ottimistico per UI istantanea
export function makeOptimisticSeating(args: {
  id: string;
  tableIds: string[];
  tableLabel: string;
  partySize: number;
  name?: string;
  reservationId?: string;
  note?: string;
  expectedEndAt: string;
  createdBy: string;
}): Seating {
  return {
    id: args.id,
    reservationId: args.reservationId ?? null,
    tableIds: args.tableIds,
    tableLabel: args.tableLabel,
    name: args.name ?? "",
    partySize: args.partySize,
    note: args.note ?? "",
    status: "seduto",
    seatedAt: new Date().toISOString(),
    expectedEndAt: args.expectedEndAt,
    actualEndAt: null,
    createdBy: args.createdBy,
  };
}

export function rollbackDay(qc: QueryClient, rid: string | undefined, date: string, prev: DayData) {
  if (!rid) return;
  qc.setQueryData(["day", rid, date], prev);
}

export function rollbackBootstrap(qc: QueryClient, slug: string | undefined, rid: string | undefined, prev: Bootstrap) {
  const key = ["bootstrap", slug || rid || "default"];
  qc.setQueryData(key, prev);
}
