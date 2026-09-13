"use client";
// ─────────────────────────────────────────────────────────────────────────────
// RITORNO AL TAVOLONE
// Staccare un tavolo è una soluzione temporanea: serve per non sprecare coperti
// con un gruppo piccolo. Quando l'ultima parte si libera, la sala dovrebbe
// tornare com'era, altrimenti la sera dopo nessuno si ricorda di riunire e il
// tavolo da 8 non esiste più.
//
// SCELTA DI DESIGN: non un popup bloccante. Durante il servizio si hanno le mani
// occupate e una finestra modale davanti alla mappa è un ostacolo. Si usa la
// stessa notifica con azione già usata per "Annulla": compare, si può toccare
// "Riunisci", e se la si ignora sparisce da sola. Il comando resta comunque
// sempre disponibile toccando il tavolo sulla mappa.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { toast } from "@/components/toast";
import type { TableStatus } from "@/lib/estimates";
import type { TableT } from "@/lib/types";

type Args = {
  tables: TableT[];
  statuses: Map<string, TableStatus>;
  enabled?: boolean;
};

export function useSplitMergePrompt({ tables, statuses, enabled = true }: Args) {
  const qc = useQueryClient();
  const me = useSession((s) => s.staff?.name) ?? "";
  const rid = useSession((s) => s.staff?.restaurantId);
  // Gruppi che abbiamo visto occupati: solo quelli meritano la proposta.
  // Un tavolo appena staccato e ancora vuoto non deve chiedere nulla.
  const wasUsed = useRef(new Set<string>());
  // Gruppi per cui l'operatore ha già detto di no in questo ciclo.
  const dismissed = useRef(new Set<string>());
  // Evita di riproporre lo stesso gruppo a ogni tick dell'orologio.
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;

    // Raggruppa le parti per tavolo di origine.
    const groups = new Map<string, TableT[]>();
    for (const t of tables) {
      if (!t.splitParentId) continue;
      const list = groups.get(t.splitParentId) ?? [];
      list.push(t);
      groups.set(t.splitParentId, list);
    }

    // Pulisce la memoria dei gruppi che non esistono più (già riuniti).
    for (const ref of [wasUsed, dismissed, asked]) {
      for (const id of ref.current) if (!groups.has(id)) ref.current.delete(id);
    }

    for (const [parentId, parts] of groups) {
      const states = parts.map((p) => statuses.get(p.id)?.state ?? "libero");
      const occupied = states.some((s) => s === "occupato" || s === "oltre_tempo");
      const reserved = states.some((s) => s === "prenotato");
      const outOfService = states.some((s) => s === "fuori_servizio");

      if (occupied) {
        // Il gruppo è in uso: al prossimo svuotamento si potrà riproporre.
        wasUsed.current.add(parentId);
        dismissed.current.delete(parentId);
        asked.current.delete(parentId);
        continue;
      }
      // Niente proposta se una parte serve ancora: prenotata o fuori servizio.
      if (reserved || outOfService) continue;
      if (!wasUsed.current.has(parentId)) continue;      // mai usato: non disturbare
      if (dismissed.current.has(parentId) || asked.current.has(parentId)) continue;

      asked.current.add(parentId);
      const labels = parts.map((p) => p.label).sort().join(" e ");
      toast({
        title: `${labels} sono liberi`,
        msg: "Li rimetto insieme come tavolo unico?",
        tone: "info",
        barMs: 12_000,
        actionLabel: "Riunisci",
        onAction: async () => {
          try {
            const res = await api<{ label: string }>(`/api/tables/${parts[0].id}/split`, {
              method: "DELETE",
              body: { staffName: me },
            });
            await qc.invalidateQueries({ queryKey: ["bootstrap"] });
            toast({ title: `Tavolo ${res.label} riunito`, tone: "ok" });
          } catch (error: unknown) {
            toast({ title: error instanceof Error ? error.message : "Non riuscito", tone: "err" });
          }
        },
      });
      // Se non tocca "Riunisci" non lo si richiede più finché il tavolo non
      // viene riusato: il comando resta nella scheda del tavolo.
      dismissed.current.add(parentId);
    }
  }, [tables, statuses, enabled, me, rid, qc]);
}
