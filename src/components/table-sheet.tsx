"use client";
// Bottom sheet del tavolo: tutte le azioni a portata di pollice, pulsanti grandi.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check, Clock, DoorOpen, Receipt, ArrowLeftRight, Sparkles, Ban, StickyNote, Users, Timer, Undo2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { activeSeatingByTable, liveState } from "@/lib/estimates";
import { mmssAgo, todayISO } from "@/lib/time";
import { TABLE_STATE, fmtCovers } from "@/lib/meta";
import { Btn, Sheet, Chip } from "@/components/ui";
import { scheduleUndo, usePending } from "@/components/toast";
import { PartyGrid, SuggestedTables, useSeat } from "@/components/seat-flow";
import type { TableT } from "@/lib/types";

export function TableSheet({ table, onClose }: { table: TableT | null; onClose: () => void }) {
  const boot = useBootstrap();
  const day = useDay(todayISO());
  const now = useNow();
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const qc = useQueryClient();
  const pending = usePending((s) => s.keys);
  const seat = useSeat();
  const [mode, setMode] = useState<"main" | "seat" | "move" | "party" | "note">("main");
  const [party, setParty] = useState(2);
  const [note, setNote] = useState("");

  if (!table || !boot.data || !day.data) return null;
  const byTable = activeSeatingByTable(day.data.seatings);
  const seating = byTable.get(table.id);
  const state = liveState(table, seating, now);
  const meta = TABLE_STATE[state];
  const isPendingFree = seating && pending.has(`libera:${seating.id}`);

  const act = async (path: string, body: unknown) => {
    await api(path, { method: "PATCH", body: { restaurantId: rid, staffName: me, ...(body as object) } });
    await Promise.all([qc.invalidateQueries({ queryKey: ["day", rid] }), qc.invalidateQueries({ queryKey: ["bootstrap", rid] })]);
  };

  const expected = seating ? new Date(seating.expectedEndAt) : null;

  return (
    <Sheet open={!!table} onClose={() => { setMode("main"); onClose(); }}
      title={
        <span className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-raised font-display text-xl font-bold">{table.label}</span>
          <span>
            <span className="flex items-center gap-2">Tavolo {table.label} <Chip cls={meta.dot.replace("bg-", "border-").concat(" bg-raised text-inherit")}><span className={`h-2 w-2 rounded-full ${meta.dot}`} />{meta.label}</Chip></span>
            <span className="block text-sm font-medium text-muted">{fmtCovers(table.capacity)} · {boot.data.rooms.find((r) => r.id === table.roomId)?.name}</span>
          </span>
        </span>
      }>

      {mode === "main" && (
        <div className="grid gap-3">
          {seating && (
            <div className="rounded-2xl bg-raised p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-bold">{seating.name || "Walk-in"} · {seating.partySize} p.</p>
                {seating.billRequested && <Chip cls="bg-soon/15 text-soon border-soon/40"><Receipt className="h-3.5 w-3.5" />Conto</Chip>}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-muted">
                <Timer className="h-4 w-4" /> Seduti da {mmssAgo(seating.seatedAt, now)} min · liberazione prevista {expected?.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
              </p>
              {seating.note && <p className="mt-1 text-sm text-muted">Nota: {seating.note}</p>}
            </div>
          )}
          {isPendingFree ? (
            <div className="rounded-2xl border-2 border-soon/50 bg-soon/10 p-4 text-center">
              <p className="font-bold text-soon">Liberazione in corso…</p>
              <p className="text-sm text-muted">Tocca Annulla nel riquadro giallo per tornare indietro</p>
            </div>
          ) : seating ? (
            <>
              <Btn variant="ok" size="xl" onClick={() =>
                scheduleUndo(`libera:${seating.id}`, `Tavolo ${table.label} liberato → da pulire`, () => act(`/api/seatings/${seating.id}`, { action: "libera" }))}>
                <DoorOpen className="h-6 w-6" /> Libera il tavolo
              </Btn>
              <div className="grid grid-cols-2 gap-3">
                <Btn variant="soft" onClick={() => act(`/api/seatings/${seating.id}`, { action: "extend", minutes: 15 })}><Clock className="h-5 w-5" /> +15 min</Btn>
                <Btn variant="soft" onClick={() => act(`/api/seatings/${seating.id}`, { action: "extend", minutes: 30 })}><Clock className="h-5 w-5" /> +30 min</Btn>
                <Btn variant="soft" onClick={() => { setParty(seating.partySize); setMode("party"); }}><Users className="h-5 w-5" /> Coperti: {seating.partySize}</Btn>
                <Btn variant="soft" onClick={() => setMode("move")}><ArrowLeftRight className="h-5 w-5" /> Sposta tavolo</Btn>
                <Btn variant={seating.billRequested ? "ok" : "soft"} onClick={() => act(`/api/seatings/${seating.id}`, { action: "bill" })}><Receipt className="h-5 w-5" /> {seating.billRequested ? "Conto richiesto ✓" : "Conto richiesto"}</Btn>
                <Btn variant="soft" onClick={() => { setNote(seating.note); setMode("note"); }}><StickyNote className="h-5 w-5" /> Nota veloce</Btn>
              </div>
            </>
          ) : state === "libero" ? (
            <>
              <Btn size="xl" onClick={() => { setParty(2); setMode("seat"); }}><Users className="h-6 w-6" /> Siedi qualcuno qui</Btn>
              <div className="grid grid-cols-2 gap-3">
                <Btn variant="soft" onClick={() => { setNote(table.note); setMode("note"); }}><StickyNote className="h-5 w-5" /> Nota tavolo</Btn>
                <Btn variant="soft" onClick={() => scheduleUndo(`oos:${table.id}`, `Tavolo ${table.label} fuori servizio`, () => act(`/api/tables/${table.id}`, { action: "fuori_servizio" }))}>
                  <Ban className="h-5 w-5" /> Fuori servizio
                </Btn>
              </div>
              {table.note && <p className="rounded-xl bg-raised px-3 py-2 text-sm text-muted">Nota: {table.note}</p>}
            </>
          ) : state === "da_pulire" ? (
            <Btn size="xl" variant="ok" onClick={() => act(`/api/tables/${table.id}`, { action: "pronto" })}><Sparkles className="h-6 w-6" /> Pulito · Pronto</Btn>
          ) : (
            <Btn size="xl" onClick={() => act(`/api/tables/${table.id}`, { action: "in_servizio" })}><Undo2 className="h-6 w-6" /> Rimetti in servizio</Btn>
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
            onPick={(t) => act(`/api/seatings/${seating.id}`, { action: "move", ...t }).then(() => { setMode("main"); onClose(); })} />
          <Btn variant="ghost" onClick={() => setMode("main")}>Indietro</Btn>
        </div>
      )}

      {mode === "party" && seating && (
        <div className="grid gap-4">
          <PartyGrid value={party} onChange={setParty} />
          <Btn onClick={() => act(`/api/seatings/${seating.id}`, { action: "party", partySize: party }).then(() => { setMode("main"); })}><Check className="h-5 w-5" /> Conferma {party} coperti</Btn>
          <Btn variant="ghost" onClick={() => setMode("main")}>Indietro</Btn>
        </div>
      )}

      {mode === "note" && (
        <div className="grid gap-3">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. compleanno, allergia, abituale…"
            className="min-h-[56px] w-full rounded-2xl border border-line bg-bg px-4 font-medium outline-none focus:border-brand" />
          <Btn onClick={() => act(seating ? `/api/seatings/${seating.id}` : `/api/tables/${table.id}`, { action: "note", note }).then(() => { setMode("main"); onClose(); })}>
            <Check className="h-5 w-5" /> Salva nota
          </Btn>
          <Btn variant="ghost" onClick={() => setMode("main")}>Indietro</Btn>
        </div>
      )}
    </Sheet>
  );
}
