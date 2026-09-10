// Tipi condivisi client/server (payload API)
export type Role = "titolare" | "staff";
export type StaffSession = { id: string; name: string; role: Role; color: string; restaurantId: string };

export type Settings = {
  slotMinutes: number; bufferMinutes: number; lateThresholdMinutes: number;
  noShowThresholdMinutes: number; overbookingPct: number;
  durations: { pranzo: DurationBands; cena: DurationBands; [k: string]: DurationBands };
  timezone: string;
};
export type DurationBands = { base: number; large: number; xl: number };

export type Room = { id: string; name: string; sortOrder: number };
export type TableT = {
  id: string; roomId: string; label: string; capacity: number; minCapacity: number;
  x: number; y: number; state: "libero" | "da_pulire" | "fuori_servizio"; note: string;
};
export type Combo = { id: string; roomId: string; label: string; capacity: number; tableIds: string[] };
export type Period = { id: string; name: string; startTime: string; endTime: string; sortOrder: number };

export type Bootstrap = {
  restaurant: { id: string; name: string; slug: string; plan: string; subscriptionStatus: string };
  settings: Settings; rooms: Room[]; tables: TableT[]; combos: Combo[]; periods: Period[];
  features: Record<string, unknown>;
};

export type ResStatus = "confermata" | "seduta" | "no_show" | "cancellata";
export type Reservation = {
  id: string; guestName: string; guestPhone: string; date: string; time: string;
  partySize: number; partySizeActual: number | null; status: ResStatus; source: string;
  assignedTableId: string | null; assignedComboId: string | null; notes: string;
  createdBy: string; createdAt: string; customerId: string | null;
};
export type Seating = {
  id: string; reservationId: string | null; waitlistId: string | null;
  tableIds: string[]; tableLabel: string; name: string; partySize: number; note: string;
  billRequested: boolean; status: "seduto" | "chiuso";
  seatedAt: string; expectedEndAt: string; actualEndAt: string | null; createdBy: string;
};
export type WaitEntry = {
  id: string; name: string; partySize: number; phone: string; roomPreference: string;
  notes: string; status: "in_attesa" | "avvisato" | "seduto" | "andato_via";
  quotedMinutes: number | null; linkedReservationId: string | null; createdAt: string;
};
export type DayData = { date: string; reservations: Reservation[]; seatings: Seating[]; waitlist: WaitEntry[] };

// Stato derivato del tavolo in un dato momento (client + server)
export type TableLiveState = "libero" | "occupato" | "in_liberazione" | "oltre_tempo" | "da_pulire" | "fuori_servizio";
