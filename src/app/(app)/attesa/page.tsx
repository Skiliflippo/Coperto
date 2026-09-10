"use client";
// LISTA D'ATTESA — walk-in, gente in anticipo, prenotati in ritardo rimasti senza tavolo.
// La stima guarda le liberazioni previste E le prenotazioni in arrivo: il sistema conosce il futuro.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Hourglass, LogOut, MessageCircle, Phone, Plus, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useBootstrap, useDay, useNow } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { estimateWaitMin, walkInSuggestions } from "@/lib/estimates";
import { nowMin, toMin, todayISO } from "@/lib/time";
import { WAIT_STATUS } from "@/lib/meta";
import { Btn, Chip, Empty, Field, Input, Sheet, SkeletonRows } from "@/components/ui";
import { PartyGrid, WalkInSheet } from "@/components/seat-flow";
import { scheduleUndo, toast } from "@/components/toast";
import type { WaitEntry } from "@/lib/types";

export default function AttesaPage() {
  const boot = useBootstrap();
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const qc = useQueryClient();
  const day = useDay(todayISO());
  const now = useNow(20_000);
  const [addOpen, setAddOpen] = useState(false);
  const [seatEntry, setSeatEntry] = useState<WaitEntry | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["day", rid] });

  const rows = useMemo(() => {
    if (!boot.data || !day.data) return [];
    const live = day.data.waitlist.filter((w) => w.status === "in_attesa" || w.status === "avvisato");
    return live.map((w) => {
      const est = estimateWaitMin(
        w.partySize, boot.data!.tables, boot.data!.combos, day.data!.seatings,
        day.data!.reservations.filter((r) => r.status === "confermata"),
        nowMin(), boot.data!.settings, now);
      const freeNow = walkInSuggestions(w.partySize, boot.data!.tables, boot.data!.combos, day.data!.seatings, now).free.length > 0;
      return { w, est, freeNow };
    });
  }, [boot.data, day.data, now]);

  if (!boot.data || !day.data) return <div className="px-4 pt-6"><SkeletonRows n={4} h={88} /></div>;

  return (
    <div className="px-4 pb-6">
      <header className="pt-[calc(env(safe-area-inset-top)+14px)]">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">Coperto</p>
        <h1 className="font-display text-[28px] font-bold leading-tight">Lista d'attesa</h1>
        <p className="text-sm font-semibold text-muted">{rows.filter((r) => r.w.status === "in_attesa").length} in attesa · aggiornata in tempo reale</p>
      </header>

      <div className="mt-4 space-y-2.5">
        {!rows.length && (
          <Empty icon={<Hourglass className="h-6 w-6" />} title="Nessuno in attesa" hint="Se la sala è piena, aggiungi qui i walk-in: l'app sa quando si libera il tavolo giusto." />
        )}
        {rows.map(({ w, est, freeNow }, i) => {
          const meta = WAIT_STATUS[w.status as keyof typeof WAIT_STATUS];
          const waitSoFar = Math.round((now - new Date(w.createdAt).getTime()) / 60000);
          // ordinamento intelligente: evidenzia il PRIMO della fila che entra in un tavolo libero
          const firstFit = freeNow && rows.findIndex((r) => r.w.status === "in_attesa" && r.freeNow && r.w.partySize <= w.partySize) === i && w.status === "in_attesa";
          return (
            <div key={w.id} className={`rounded-3xl border-2 bg-surface p-4 ${firstFit ? "border-ok shadow-md shadow-ok/20" : "border-line"}`}>
              {firstFit && (
                <p className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-ok">
                  <Sparkles className="h-4 w-4" /> C'è un tavolo adatto libero: {w.name} può sedere
                </p>
              )}
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-raised font-display text-lg font-extrabold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold">{w.name} <span className="font-semibold text-muted">· {w.partySize} p.</span></p>
                  <p className="text-[13px] font-medium text-muted">
                    in fila da {waitSoFar}′ {w.roomPreference && <>· preferisce {w.roomPreference}</>}
                    {w.linkedReservationId && <> · aveva prenotato</>}
                  </p>
                </div>
                <div className="text-right">
                  <Chip cls={meta.cls}>{meta.label}</Chip>
                  <p className={`mt-1.5 text-sm font-bold tabular-nums ${est === 0 ? "text-ok" : "text-soon"}`}>
                    {est == null ? "attesa incerta" : est === 0 ? "tavolo pronto" : `~${est}′ stimate`}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Btn variant="ok" onClick={() => setSeatEntry(w)}><Check className="h-5 w-5" /> Siedi</Btn>
                <Btn variant="soft" onClick={() =>
                  api(`/api/waitlist/${w.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "status", status: w.status === "avvisato" ? "in_attesa" : "avvisato" } })
                    .then(refresh)}>
                  <Bell className="h-5 w-5" /> {w.status === "avvisato" ? "In attesa" : "Avvisa"}
                </Btn>
                <Btn variant="soft" onClick={() =>
                  scheduleUndo(`left:${w.id}`, `${w.name} andato via`, () =>
                    api(`/api/waitlist/${w.id}`, { method: "PATCH", body: { restaurantId: rid, staffName: me, action: "status", status: "andato_via" } }).then(refresh))}>
                  <LogOut className="h-5 w-5" /> Andato via
                </Btn>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <a href={w.phone ? `tel:${w.phone.replace(/\s/g, "")}` : undefined}
                  className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-raised text-sm font-semibold active:scale-[0.97] ${!w.phone ? "opacity-40 pointer-events-none" : ""}`}>
                  <Phone className="h-4 w-4" /> {w.phone || "Nessun numero"}
                </a>
                <button onClick={() => {
                  const txt = `Ciao ${w.name}! Si è liberato un tavolo da ${w.partySize} all'Osteria del Vicolo. Passate pure quando volete, vi aspettiamo.`;
                  if (w.phone) window.open(`https://wa.me/${w.phone.replace(/\D/g, "")}?text=${encodeURIComponent(txt)}`, "_blank");
                  navigator.clipboard?.writeText(txt).then(() => toast({ title: "Messaggio WhatsApp copiato", tone: "ok" }));
                }}
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-raised text-sm font-semibold active:scale-[0.97]">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={() => setAddOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+92px)] right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-on-brand shadow-xl shadow-brand/40 active:scale-95 sm:right-[max(1rem,calc(50%-30rem))]"
        aria-label="Aggiungi in attesa">
        <Plus className="h-8 w-8" />
      </button>

      <AddWaitSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <WalkInSheet open={!!seatEntry} onClose={() => setSeatEntry(null)} defaultName={seatEntry?.name} waitlistId={seatEntry?.id} />
    </div>
  );
}

function AddWaitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const boot = useBootstrap();
  const rid = useSession((s) => s.staff?.restaurantId);
  const me = useSession((s) => s.staff?.name) ?? "";
  const day = useDay(todayISO());
  const now = useNow();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [party, setParty] = useState(2);
  const [phone, setPhone] = useState("");
  const [pref, setPref] = useState("");
  const [busy, setBusy] = useState(false);

  const est = boot.data && day.data
    ? estimateWaitMin(party, boot.data.tables, boot.data.combos, day.data.seatings,
        day.data.reservations.filter((r) => r.status === "confermata"), nowMin(), boot.data.settings, now)
    : null;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api("/api/waitlist", {
        method: "POST",
        body: { restaurantId: rid, name, partySize: party, phone, roomPreference: pref, quotedMinutes: est, createdBy: me },
      });
      await qc.invalidateQueries({ queryKey: ["day", rid] });
      toast({ title: `${name.trim()} in attesa`, msg: est != null ? `Attesa stimata ~${est} minuti` : undefined, tone: "ok" });
      setName(""); setPhone(""); setParty(2); setPref("");
      onClose();
    } catch (e: any) { toast({ title: e.message, tone: "err" }); }
    setBusy(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Hourglass className="h-5 w-5 text-brand" /> Aggiungi alla lista d'attesa</span>}>
      <div className="grid gap-4">
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Orlando" autoComplete="off" /></Field>
        <Field label="Coperti"><PartyGrid value={party} onChange={setParty} /></Field>
        <Field label="Telefono (opzionale)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Per il messaggio WhatsApp" /></Field>
        {boot.data && (
          <Field label="Preferenza sala (opzionale)">
            <div className="flex gap-2">
              {boot.data.rooms.map((r) => (
                <button key={r.id} onClick={() => setPref(pref === r.name ? "" : r.name)}
                  className={`min-h-[48px] flex-1 rounded-2xl text-sm font-semibold active:scale-95 ${pref === r.name ? "bg-brand text-on-brand" : "bg-raised"}`}>
                  {r.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        <p className="rounded-2xl bg-raised px-4 py-3 text-center font-bold">
          {est == null ? "Attesa difficile da stimare: di' al cliente un tempo prudente" : est === 0 ? "C'è già un tavolo adatto libero: siedilo subito!" : `Attesa stimata: ~${est} minuti`}
        </p>
        <Btn size="xl" disabled={!name.trim() || busy} onClick={save}><Check className="h-6 w-6" /> Metti in fila{est != null && est > 0 ? ` · digli ~${est} minuti` : ""}</Btn>
      </div>
    </Sheet>
  );
}
