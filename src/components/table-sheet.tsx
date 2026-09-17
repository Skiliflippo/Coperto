"use client";
// Bottom sheet del tavolo: Optimistic UI + Local-First
// - Azioni operative (occupa, libera, sposta, coperti, note) aggiornano UI ALL'ISTANTE
// - API inviata in background, realtime agli altri via /api/events
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check, Clock, DoorOpen, ArrowLeftRight, Ban, StickyNote, Users, Timer, Undo2, Scissors, Link2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { useTenant } from "@/lib/tenant";
import { computeTableStatuses } from "@/lib/estimates";
import { nowMin, todayISO } from "@/lib/time";
import { TABLE_STATE, fmtCovers } from "@/lib/meta";
import { Btn, Sheet, Chip } from "@/components/ui";
import { toast } from "@/components/toast";
import { PartyGrid, SuggestedTables, useSeat } from "@/components/seat-flow";
import type { TableT, DayData, Bootstrap } from "@/lib/types";

export function TableSheet({ table, onClose }: { table: TableT | null; onClose: () => void }) {
  const boot = useBootstrap();
  const day = useDay(todayISO());
  const now = useNow();
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const slug = useTenant();
  const qc = useQueryClient();
  const seat = useSeat();
  const [mode, setMode] = useState<"main" | "seat" | "move" | "party" | "note">("main");
  const [party, setParty] = useState(2);
  const [note, setNote] = useState("");

  if (!table || !boot.data || !day.data) return null;
  const statuses = computeTableStatuses({
    tables: boot.data.tables, combos: boot.data.combos,
    seatings: day.data.seatings, reservations: day.data.reservations,
    settings: boot.data.settings, nowMs: now, nowMinOfDay: nowMin(),
  });
  const status = statuses.get(table.id) ?? { state: "libero" as const };
  const seating = status.seating;
  const state = status.state;
  const meta = TABLE_STATE[state];
  const date = todayISO();

  const splitTable = async () => {
    if (!table) return;
    try {
      await api(`/api/tables/${table.id}/split`, { method: "POST", body: { restaurantId: rid, staffName: me } });
      await qc.invalidateQueries({ queryKey: ["bootstrap"] });
      toast({ title: `Tavolo ${table.label} staccato`, msg: "Ora sono tavoli indipendenti.", tone: "ok" });
      onClose();
    } catch (e: any) { toast({ title: e?.message ?? "Non riuscito", tone: "err" }); }
  };
  const mergeTable = async () => {
    if (!table) return;
    try {
      const res = await api<{ label: string }>(`/api/tables/${table.id}/split`, {
        method: "DELETE", body: { staffName: me },
      });
      await qc.invalidateQueries({ queryKey: ["bootstrap"] });
      toast({ title: `Tavolo ${res.label} riunito`, tone: "ok" });
      onClose();
    } catch (e: any) { toast({ title: e?.message ?? "Non riuscito", tone: "err" }); }
  };

  // Optimistic act: aggiorna cache day/bootstrap immediatamente, poi API in background
  const actOptimistic = async (
    path: string,
    body: any,
    optimisticUpdater?: (dayData: DayData) => DayData,
    bootstrapUpdater?: (bootData: Bootstrap) => Bootstrap,
  ) => {
    const prevDay = qc.getQueryData<DayData>(["day", rid, date]);
    const prevBoot = qc.getQueryData<Bootstrap>(["bootstrap", slug || rid || "default"]);

    // 1) Optimistic UI istantaneo
    if (optimisticUpdater && prevDay) {
      qc.setQueryData(["day", rid, date], optimisticUpdater(prevDay));
    }
    if (bootstrapUpdater && prevBoot) {
      qc.setQueryData(["bootstrap", slug || rid || "default"], bootstrapUpdater(prevBoot));
    }

    try {
      // 2) API in background
      await api(path, { method: "PATCH", body: { restaurantId: rid, staffName: me, ...body } });
      // 3) Sync leggero in background (non blocca UI)
      qc.invalidateQueries({ queryKey: ["day", rid] });
      qc.invalidateQueries({ queryKey: ["bootstrap"] });
    } catch (e: any) {
      // Rollback su errore
      if (prevDay) qc.setQueryData(["day", rid, date], prevDay);
      if (prevBoot) qc.setQueryData(["bootstrap", slug || rid || "default"], prevBoot);
      toast({ title: e?.message ?? "Errore", tone: "err" });
      throw e;
    }
  };

  return (
    <Sheet open={!!table} onClose={() => { setMode("main"); onClose(); }}
      title={
        <span className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-raised font-display text-xl font-bold">{table.label}</span>
          <span>
            <span className="flex items-center gap-2">{seating && seating.tableIds.length > 1 ? `Tavoli ${seating.tableLabel}` : `Tavolo ${table.label}`} <Chip cls={meta.dot.replace("bg-", "border-").concat(" bg-raised text-inherit")}><span className={`h-2 w-2 rounded-full ${meta.dot}`} />{meta.label}</Chip></span>
            <span className="block text-sm font-medium text-muted">
              {seating && seating.tableIds.length > 1 ? "tavoli accostati" : fmtCovers(table.capacity)}
              {table.maxCapacity > table.capacity && !seating ? ` (fino a ${table.maxCapacity})` : ""}
              {" · "}{boot.data.rooms.find((r) => r.id === table.roomId)?.name}
            </span>
          </span>
        </span>
      }>

      {mode === "main" && (
        <div className="grid gap-3">
          {seating && (
            <div className="rounded-2xl bg-raised p-4">
              <p className="text-lg font-bold">{seating.name || "Walk-in"} · {seating.partySize} p.</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-muted">
                <Timer className="h-4 w-4" /> Seduti da {status.minutesSeated} min
                {state === "oltre_tempo" && <span className="font-bold text-over">· oltre l&apos;ora</span>}
              </p>
              {seating.note && <p className="mt-1 text-sm text-muted">Nota: {seating.note}</p>}
            </div>
          )}
          {seating ? (
            <>
              <Btn variant="ok" size="xl" onClick={async () => {
                const label = seating.tableIds.length > 1 ? `Tavoli ${seating.tableLabel} liberati` : `Tavolo ${table.label} liberato`;
                onClose();
                // Optimistic: libera subito
                const prev = qc.getQueryData<DayData>(["day", rid, date]);
                if (prev) {
                  qc.setQueryData(["day", rid, date], {
                    ...prev,
                    seatings: prev.seatings.map((s) => s.id === seating.id ? { ...s, status: "chiuso" as const, actualEndAt: new Date().toISOString() } : s),
                  });
                }
                toast({ title: label, tone: "ok" });
                try {
                  await api(`/api/seatings/${seating.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "libera" } });
                  qc.invalidateQueries({ queryKey: ["day", rid] });
                } catch (e: any) {
                  if (prev) qc.setQueryData(["day", rid, date], prev);
                  toast({ title: e?.message ?? "Errore", tone: "err" });
                }
              }}>
                <DoorOpen className="h-6 w-6" /> Libera il tavolo
              </Btn>
              <div className="grid grid-cols-2 gap-3">
                <Btn variant="soft" onClick={() => {
                  const prev = qc.getQueryData<DayData>(["day", rid, date]);
                  if (prev) {
                    qc.setQueryData(["day", rid, date], {
                      ...prev,
                      seatings: prev.seatings.map((s) => s.id === seating.id ? { ...s, expectedEndAt: new Date(new Date(s.expectedEndAt).getTime() + 15*60000).toISOString() } : s),
                    });
                  }
                  actOptimistic(`/api/seatings/${seating.id}`, { action: "extend", minutes: 15 });
                }}><Clock className="h-5 w-5" /> +15 min</Btn>
                <Btn variant="soft" onClick={() => {
                  const prev = qc.getQueryData<DayData>(["day", rid, date]);
                  if (prev) {
                    qc.setQueryData(["day", rid, date], {
                      ...prev,
                      seatings: prev.seatings.map((s) => s.id === seating.id ? { ...s, expectedEndAt: new Date(new Date(s.expectedEndAt).getTime() + 30*60000).toISOString() } : s),
                    });
                  }
                  actOptimistic(`/api/seatings/${seating.id}`, { action: "extend", minutes: 30 });
                }}><Clock className="h-5 w-5" /> +30 min</Btn>
                <Btn variant="soft" onClick={() => { setParty(seating.partySize); setMode("party"); }}><Users className="h-5 w-5" /> Coperti: {seating.partySize}</Btn>
                <Btn variant="soft" onClick={() => setMode("move")}><ArrowLeftRight className="h-5 w-5" /> Sposta tavolo</Btn>
                <Btn variant="soft" onClick={() => { setNote(seating.note); setMode("note"); }}><StickyNote className="h-5 w-5" /> Nota veloce</Btn>
              </div>
            </>
          ) : state === "libero" ? (
            <>
              <Btn size="xl" onClick={() => { setParty(2); setMode("seat"); }}><Users className="h-6 w-6" /> Siedi qualcuno qui</Btn>

              {table.splitInto >= 2 && (
                <Btn variant="soft" onClick={() => splitTable()}>
                  <Scissors className="h-5 w-5" />
                  Stacca in {table.splitInto} tavoli da {boot.data.settings.standardTableSeats ?? 4}
                </Btn>
              )}
              {table.splitParentId && (
                <Btn variant="soft" onClick={() => mergeTable()}>
                  <Link2 className="h-5 w-5" /> Riunisci il tavolo
                </Btn>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Btn variant="soft" onClick={() => { setNote(table.note); setMode("note"); }}><StickyNote className="h-5 w-5" /> Nota tavolo</Btn>
                <Btn variant="soft" onClick={async () => {
                  const prevBoot = qc.getQueryData<Bootstrap>(["bootstrap", slug || rid || "default"]);
                  if (prevBoot) {
                    qc.setQueryData(["bootstrap", slug || rid || "default"], {
                      ...prevBoot,
                      tables: prevBoot.tables.map((t) => t.id === table.id ? { ...t, state: "fuori_servizio" as const } : t),
                    });
                  }
                  onClose();
                  toast({ title: `Tavolo ${table.label} fuori servizio`, tone: "info" });
                  try {
                    await api(`/api/tables/${table.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "fuori_servizio" } });
                    qc.invalidateQueries({ queryKey: ["bootstrap"] });
                  } catch (e: any) {
                    if (prevBoot) qc.setQueryData(["bootstrap", slug || rid || "default"], prevBoot);
                    toast({ title: e?.message ?? "Errore", tone: "err" });
                  }
                }}>
                  <Ban className="h-5 w-5" /> Fuori servizio
                </Btn>
              </div>
              {table.note && <p className="rounded-xl bg-raised px-3 py-2 text-sm text-muted">Nota: {table.note}</p>}
            </>
          ) : state === "prenotato" ? (
            <>
              <div className="rounded-2xl border-2 border-soon/50 bg-soon/10 p-3.5">
                <p className="font-bold text-soon">Tenuto per {status.reservation?.guestName}</p>
                <p className="text-sm font-semibold text-muted">
                  {status.reservation?.time} · {status.reservation?.partySize} coperti. Non compare fra i tavoli liberi.
                </p>
              </div>
              <Btn size="xl" onClick={() => { setParty(status.reservation?.partySize ?? 2); setMode("seat"); }}>
                <Users className="h-6 w-6" /> Siedi qui comunque
              </Btn>
            </>
          ) : (
            <Btn size="xl" onClick={async () => {
              const prevBoot = qc.getQueryData<Bootstrap>(["bootstrap", slug || rid || "default"]);
              if (prevBoot) {
                qc.setQueryData(["bootstrap", slug || rid || "default"], {
                  ...prevBoot,
                  tables: prevBoot.tables.map((t) => t.id === table.id ? { ...t, state: "libero" as const } : t),
                });
              }
              toast({ title: `Tavolo ${table.label} rimesso in servizio`, tone: "ok" });
              try {
                await api(`/api/tables/${table.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "in_servizio" } });
                qc.invalidateQueries({ queryKey: ["bootstrap"] });
              } catch (e: any) {
                if (prevBoot) qc.setQueryData(["bootstrap", slug || rid || "default"], prevBoot);
                toast({ title: e?.message ?? "Errore", tone: "err" });
              }
            }}><Undo2 className="h-6 w-6" /> Rimetti in servizio</Btn>
          )}
        </div>
      )}

      {mode === "seat" && (
        <div className="grid gap-4">
          <p className="text-sm font-semibold text-muted">Quanti coperti al tavolo {table.label}?</p>
          <PartyGrid value={party} onChange={setParty} />
          {party > table.capacity && <p className="rounded-xl bg-over/10 px-3 py-2 text-sm font-semibold text-over">Il tavolo ha {table.capacity} posti: serviranno sedie aggiunte.</p>}
          <Btn size="xl" onClick={async () => { if (await seat({ tableIds: [table.id], tableLabel: table.label, partySize: party })) { setMode("main"); onClose(); } }}>
            <Check className="h-6 w-6" /> Siedi {party} qui
          </Btn>
          <Btn variant="ghost" onClick={() => setMode("main")}>Indietro</Btn>
        </div>
      )}

      {mode === "move" && seating && (
        <div className="grid gap-3">
          <p className="text-sm font-semibold text-muted">Sposta {seating.name || "il gruppo"} ({seating.partySize} p.) su:</p>
          <SuggestedTables party={seating.partySize} excludeIds={seating.tableIds}
            onPick={async (t) => {
              const prev = qc.getQueryData<DayData>(["day", rid, date]);
              if (prev) {
                qc.setQueryData(["day", rid, date], {
                  ...prev,
                  seatings: prev.seatings.map((s) => s.id === seating.id ? { ...s, tableIds: t.tableIds, tableLabel: t.tableLabel } : s),
                });
              }
              setMode("main"); onClose();
              try {
                await api(`/api/seatings/${seating.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "move", ...t } });
                qc.invalidateQueries({ queryKey: ["day", rid] });
              } catch (e: any) {
                if (prev) qc.setQueryData(["day", rid, date], prev);
                toast({ title: e?.message ?? "Errore", tone: "err" });
              }
            }} />
          <Btn variant="ghost" onClick={() => setMode("main")}>Indietro</Btn>
        </div>
      )}

      {mode === "party" && seating && (
        <div className="grid gap-4">
          <PartyGrid value={party} onChange={setParty} />
          <Btn onClick={async () => {
            const prev = qc.getQueryData<DayData>(["day", rid, date]);
            if (prev) {
              qc.setQueryData(["day", rid, date], {
                ...prev,
                seatings: prev.seatings.map((s) => s.id === seating.id ? { ...s, partySize: party } : s),
              });
            }
            setMode("main");
            try {
              await api(`/api/seatings/${seating.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "party", partySize: party } });
              qc.invalidateQueries({ queryKey: ["day", rid] });
            } catch (e: any) {
              if (prev) qc.setQueryData(["day", rid, date], prev);
              toast({ title: e?.message ?? "Errore", tone: "err" });
            }
          }}><Check className="h-5 w-5" /> Conferma {party} coperti</Btn>
          <Btn variant="ghost" onClick={() => setMode("main")}>Indietro</Btn>
        </div>
      )}

      {mode === "note" && (
        <div className="grid gap-3">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. compleanno, allergia, abituale…"
            className="min-h-[56px] w-full rounded-2xl border border-line bg-bg px-4 font-medium outline-none focus:border-brand" />
          <Btn onClick={async () => {
            const prev = qc.getQueryData<DayData>(["day", rid, date]);
            if (seating && prev) {
              qc.setQueryData(["day", rid, date], {
                ...prev,
                seatings: prev.seatings.map((s) => s.id === seating.id ? { ...s, note } : s),
              });
            }
            const prevBoot = qc.getQueryData<Bootstrap>(["bootstrap", slug || rid || "default"]);
            if (!seating && prevBoot) {
              qc.setQueryData(["bootstrap", slug || rid || "default"], {
                ...prevBoot,
                tables: prevBoot.tables.map((t) => t.id === table.id ? { ...t, note } : t),
              });
            }
            setMode("main"); onClose();
            try {
              await api(seating ? `/api/seatings/${seating.id}` : `/api/tables/${table.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "note", note } });
              qc.invalidateQueries({ queryKey: ["day", rid] });
              qc.invalidateQueries({ queryKey: ["bootstrap"] });
            } catch (e: any) {
              if (prev) qc.setQueryData(["day", rid, date], prev);
              if (prevBoot) qc.setQueryData(["bootstrap", slug || rid || "default"], prevBoot);
              toast({ title: e?.message ?? "Errore", tone: "err" });
            }
          }}>
            <Check className="h-5 w-5" /> Salva nota
          </Btn>
          <Btn variant="ghost" onClick={() => setMode("main")}>Indietro</Btn>
        </div>
      )}
    </Sheet>
  );
}
