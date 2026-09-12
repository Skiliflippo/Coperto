"use client";
// GESTIONE SALE — aggiungere un ambiente o rimuoverlo. Solo il titolare.
// L'eliminazione cancella la piantina: si conferma riscrivendo il PIN.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/store/session";
import { Btn, Input, Sheet } from "@/components/ui";
import { toast } from "@/components/toast";
import { RoomWizard } from "@/components/room-wizard";
import type { Bootstrap, Room } from "@/lib/types";

export function RoomsManager({ boot }: { boot: Bootstrap }) {
  const staff = useSession((s) => s.staff);
  const qc = useQueryClient();
  const [wizard, setWizard] = useState(false);
  const [target, setTarget] = useState<Room | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const tablesIn = (roomId: string) => boot.tables.filter((t) => t.roomId === roomId).length;

  const remove = async () => {
    if (!target || pin.length !== 4) return;
    setBusy(true);
    try {
      await api("/api/rooms", {
        method: "DELETE",
        body: { restaurantId: boot.restaurant.id, staffId: staff?.id, pin, roomId: target.id },
      });
      await qc.invalidateQueries({ queryKey: ["bootstrap", staff?.restaurantId] });
      toast({ title: `Sala "${target.name}" eliminata`, tone: "ok" });
      setTarget(null); setPin("");
    } catch (error: unknown) {
      toast({ title: error instanceof Error ? error.message : "Eliminazione non riuscita", tone: "err" });
    }
    setBusy(false);
  };

  return (
    <>
      <p className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Sale</p>
      <div className="mt-2 space-y-2">
        {boot.rooms.map((room) => (
          <div key={room.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{room.name}</p>
              <p className="text-[13px] text-muted">
                {tablesIn(room.id)} tavoli · {(room.layout.w / 100).toFixed(1)}×{(room.layout.h / 100).toFixed(1)} m
              </p>
            </div>
            <button onClick={() => { setPin(""); setTarget(room); }} aria-label={`Elimina ${room.name}`}
              disabled={boot.rooms.length <= 1}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-over/15 text-over active:scale-95 disabled:opacity-30">
              <Trash2 className="h-[18px] w-[18px]" />
            </button>
          </div>
        ))}

        <button onClick={() => setWizard(true)}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line font-bold text-muted active:scale-[0.98]">
          <Plus className="h-5 w-5" /> Aggiungi una sala
        </button>
      </div>

      {wizard && (
        <RoomWizard boot={boot} mode="nuova-sala"
          onDone={() => setWizard(false)} onCancel={() => setWizard(false)} />
      )}

      <Sheet open={!!target} onClose={() => setTarget(null)} title={`Eliminare "${target?.name ?? ""}"?`}>
        <div className="grid gap-4">
          <div className="flex items-start gap-3 rounded-2xl border-2 border-over/50 bg-over/10 p-3.5">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-over" />
            <p className="text-sm font-semibold">
              Spariscono la piantina e i {target ? tablesIn(target.id) : 0} tavoli di questa sala.
              Lo storico dei servizi passati resta nel riepilogo. L&apos;operazione non si annulla.
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">Scrivi il tuo PIN per confermare</span>
            <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric" placeholder="4 cifre" autoComplete="off" />
          </label>
          <Btn variant="danger" size="xl" disabled={busy || pin.length !== 4} onClick={remove}>
            <Trash2 className="h-5 w-5" /> Elimina la sala
          </Btn>
        </div>
      </Sheet>
    </>
  );
}
