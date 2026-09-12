"use client";
// PRIMO ACCESSO · si dichiara la piantina della sala prima di iniziare il servizio.
// Il percorso è lo stesso usato per aggiungere una sala in seguito (RoomWizard).
import { useSession } from "@/store/session";
import { RoomWizard } from "@/components/room-wizard";
import type { Bootstrap } from "@/lib/types";

export function Onboarding({ boot }: { boot: Bootstrap }) {
  const staff = useSession((s) => s.staff);

  // Solo il titolare configura la sala: al personale si spiega cosa manca.
  if (staff?.role !== "titolare") {
    return (
      <div className="fixed inset-0 z-[95] grid place-items-center bg-bg px-6 text-center">
        <div>
          <p className="font-display text-2xl font-bold">Sala non ancora configurata</p>
          <p className="mt-2 text-muted">Il titolare deve disegnare la piantina prima di iniziare il servizio.</p>
        </div>
      </div>
    );
  }

  return <RoomWizard boot={boot} mode="primo-accesso" onDone={() => { /* il bootstrap si aggiorna da solo */ }} />;
}
