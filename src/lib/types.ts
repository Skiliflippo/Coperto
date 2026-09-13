// Tipi condivisi client/server (payload API)
export type Role = "titolare" | "staff";
export type StaffSession = { id: string; name: string; role: Role; color: string; restaurantId: string };

export type Settings = {
  slotMinutes: number; bufferMinutes: number; lateThresholdMinutes: number;
  noShowThresholdMinutes: number; overbookingPct: number;
  overtimeMinutes: number;          // oltre tempo dopo N min dal momento in cui si sono seduti
  reservationHoldMinutes: number;   // quanto prima una prenotazione blocca il tavolo
  standardTableSeats: number;       // posti di un tavolo singolo standard
  theme: string;                    // palette colori del locale
  allowTableJoin: boolean;          // proponi accorpamenti quando il gruppo non entra
  joinMaxGapCm: number;             // distanza max fra tavoli accostabili
  durations: { pranzo: DurationBands; cena: DurationBands; [k: string]: DurationBands };
  timezone: string;
};
export type DurationBands = { base: number; large: number; xl: number };

export type { FloorElement, RoomLayout, TableShape } from "./floor";
import type { RoomLayout, TableShape } from "./floor";
export type Room = { id: string; name: string; sortOrder: number; layout: RoomLayout };
export type TableT = {
  id: string; roomId: string; label: string; capacity: number; minCapacity: number;
  maxCapacity: number;   // con sedie aggiunte (>= capacity)
  splitInto: number;             // in quante parti si stacca (0 = unico)
  splitActive: boolean;          // padre attualmente separato
  splitParentId: string | null;  // parte generata da una separazione
  x: number; y: number; width: number; height: number; rotation: number; shape: TableShape;
  state: "libero" | "fuori_servizio"; note: string;
};
export type Combo = { id: string; roomId: string; label: string; capacity: number; tableIds: string[] };
export type Period = { id: string; name: string; startTime: string; endTime: string; sortOrder: number };

export type Bootstrap = {
  restaurant: { id: string; name: string; slug: string; plan: string; subscriptionStatus: string; onboarded: boolean };
  settings: Settings; rooms: Room[]; tables: TableT[]; combos: Combo[]; periods: Period[];
  features: Record<string, unknown>;
};

export type ResStatus = "confermata" | "seduta" | "no_show" | "cancellata";
export type Reservation = {
  id: string; guestName: string; guestPhone: string; date: string; time: string;
  partySize: number; partySizeActual: number | null; status: ResStatus; source: string;
  assignedTableId: string | null; assignedComboId: string | null;
  preferredRoomId: string | null; joinedTableIds: string[]; notes: string;
  createdBy: string; createdAt: string; customerId: string | null;
};
export type Seating = {
  id: string; reservationId: string | null;
  tableIds: string[]; tableLabel: string; name: string; partySize: number; note: string;
  status: "seduto" | "chiuso";
  seatedAt: string; expectedEndAt: string; actualEndAt: string | null; createdBy: string;
};
export type DayData = { date: string; reservations: Reservation[]; seatings: Seating[] };

// Stato derivato del tavolo. Solo quello che si capisce guardando la sala:
// niente "da pulire" / "si libera" da aggiornare a mano nel pieno del servizio.
export type TableLiveState = "libero" | "occupato" | "oltre_tempo" | "prenotato" | "fuori_servizio";
