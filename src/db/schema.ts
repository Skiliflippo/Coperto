// ─────────────────────────────────────────────────────────────────────────────
// COPERTO · Schema multi-tenant
// OGNI tabella ha restaurant_id → domani il prodotto scala a SaaS senza refactor.
// Prenotazione = intenzione · Seating (occupazione) = realtà in sala.
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

export const restaurants = pgTable("restaurants", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Predisposizione SaaS (schema pronto, UI no)
  plan: text("plan").notNull().default("trial"), // trial | base | pro
  subscriptionStatus: text("subscription_status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // Primo accesso: finché è null mostriamo il percorso guidato di configurazione sala.
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Configurazione = dati, non codice. Nuovo cliente = righe qui, mai codice.
export const restaurantSettings = pgTable("restaurant_settings", {
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }).primaryKey(),
  slotMinutes: integer("slot_minutes").notNull().default(15),        // granularità slot piano
  bufferMinutes: integer("buffer_minutes").notNull().default(15),    // riassetto tra un tavolo e l'altro
  lateThresholdMinutes: integer("late_threshold_minutes").notNull().default(15),   // evidenzia "in ritardo"
  noShowThresholdMinutes: integer("no_show_threshold_minutes").notNull().default(15),
  overbookingPct: integer("overbooking_pct").notNull().default(90),  // alert sforamento coperti
  // Un tavolo diventa "oltre tempo" dopo N minuti dal momento in cui si è seduto:
  // nessuno in servizio ha tempo di aggiornare stati, il conteggio parte da solo.
  overtimeMinutes: integer("overtime_minutes").notNull().default(60),
  // Quanto prima una prenotazione "blocca" il tavolo, togliendolo dai liberi.
  reservationHoldMinutes: integer("reservation_hold_minutes").notNull().default(90),
  // "Unisci tavoli": se il gruppo non entra da nessuna parte, l'app propone di
  // accostare due tavoli vicini e liberi. Alcuni locali non lo vogliono (spazi stretti).
  allowTableJoin: boolean("allow_table_join").notNull().default(true),
  // Distanza massima (cm) fra due tavoli perché siano considerati accostabili.
  joinMaxGapCm: integer("join_max_gap_cm").notNull().default(150),
  // Durate medie occupazione per turno e fascia coperti
  durations: jsonb("durations").notNull().default({
    pranzo: { base: 60, large: 90, xl: 120 },   // large = 7-8 coperti, xl = 9+
    cena: { base: 90, large: 105, xl: 120 },
  }),
  timezone: text("timezone").notNull().default("Europe/Rome"),
});

// Feature flag per tenant (piani futuri Base/Pro)
export const restaurantFeatures = pgTable("restaurant_features", {
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }).primaryKey(),
  flags: jsonb("flags").notNull().default({}),
});

export const staff = pgTable("staff", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  pinHash: text("pin_hash").notNull(),           // sha256 del PIN a 4 cifre
  role: text("role").notNull().default("staff"), // titolare | staff
  color: text("color").notNull().default("#E4572E"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("staff_restaurant_idx").on(t.restaurantId)]);

// Anagrafica clienti essenziale (visit count + no-show history)
export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  visits: integer("visits").notNull().default(0),
  noShows: integer("no_shows").notNull().default(0),
  lastNoShowAt: timestamp("last_no_show_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""), // preferenze persistenti
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("customers_restaurant_idx").on(t.restaurantId)]);

// Planimetria della sala vista dall'alto, in centimetri reali (1 cella griglia = 50 cm).
// Muri e arredi fissi sono elementi rettangolari con posizione, dimensione e rotazione:
// così l'editor può spostarli, ridimensionarli e ruotarli come in Figma.
export type FloorElement = {
  id: string;
  kind: "wall" | "decor";
  x: number; y: number; w: number; h: number; rotation: number;
  label: string;
};
export type RoomLayout = { w: number; h: number; elements: FloorElement[] };
export const rooms = pgTable("rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Sala interna · Dehors · Soppalco
  sortOrder: integer("sort_order").notNull().default(0),
  layout: jsonb("layout").$type<RoomLayout>(), // null → generata al primo accesso
}, (t) => [index("rooms_restaurant_idx").on(t.restaurantId)]);

// state = stato "di base" del tavolo. "occupato" è derivato dalle seatings attive,
// "in_liberazione"/"oltre_tempo" derivati dal confronto con l'orologio.
export const tables = pgTable("tables", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  label: text("label").notNull(),          // numero tavolo mostrato in sala
  capacity: integer("capacity").notNull(), // coperti "normali", con le sedie che ci stanno sempre
  minCapacity: integer("min_capacity").notNull().default(1),
  // Coperti massimi aggiungendo sedie: un 2 può diventare un 4 stringendosi.
  // Usato per walk-in e per valutare gli accorpamenti.
  maxCapacity: integer("max_capacity").notNull().default(0), // 0 = come capacity
  // Geometria sulla piantina: x/y = centro del tavolo in unità stanza
  x: integer("x").notNull().default(0),
  y: integer("y").notNull().default(0),
  width: integer("width").notNull().default(120),
  height: integer("height").notNull().default(120),
  rotation: integer("rotation").notNull().default(0),        // gradi
  shape: text("shape").notNull().default("square"),          // round | square | rect
  archived: boolean("archived").notNull().default(false),    // tavolo rimosso dalla mappa (storico intatto)
  state: text("state").notNull().default("libero"), // libero | fuori_servizio
  note: text("note").notNull().default(""),         // nota veloce ("compleanno", "allergia")
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tables_restaurant_idx").on(t.restaurantId), index("tables_room_idx").on(t.roomId)]);

// Accorpamenti: 12+13 → tavolo da 8
export const tableCombinations = pgTable("table_combinations", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  label: text("label").notNull(), // "12+13"
  capacity: integer("capacity").notNull(),
  tableIds: jsonb("table_ids").notNull().$type<string[]>(),
}, (t) => [index("combos_restaurant_idx").on(t.restaurantId)]);

// Turni del giorno (pranzo / cena)
export const servicePeriods = pgTable("service_periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(), // "12:00"
  endTime: text("end_time").notNull(),     // "23:30"
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("periods_restaurant_idx").on(t.restaurantId)]);

// PRENOTAZIONE = intenzione. Gli stati "da sistemare"/"in ritardo" sono derivati.
export const reservations = pgTable("reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  guestName: text("guest_name").notNull(),     // denormalizzato: la sala ragiona per nome
  guestPhone: text("guest_phone").notNull().default(""),
  date: text("date").notNull(),                // "YYYY-MM-DD" (giorno del locale)
  time: text("time").notNull(),                // "HH:MM"
  partySize: integer("party_size").notNull(),          // coperti dichiarati
  partySizeActual: integer("party_size_actual"),       // coperti reali al check-in (deviazione!)
  status: text("status").notNull().default("confermata"), // confermata | seduta | no_show | cancellata
  source: text("source").notNull().default("telefono"),   // telefono | walk_in | online (fase 2)
  assignedTableId: uuid("assigned_table_id").references(() => tables.id, { onDelete: "set null" }),
  assignedComboId: uuid("assigned_combo_id").references(() => tableCombinations.id, { onDelete: "set null" }),
  // Sala chiesta dal cliente al telefono ("fuori se possibile"): guida l'auto-sistema.
  preferredRoomId: uuid("preferred_room_id").references(() => rooms.id, { onDelete: "set null" }),
  // Tavoli accostati per questo gruppo (oltre ad assigned_table_id): accorpamento
  // deciso al momento, senza doverlo predefinire in configurazione.
  joinedTableIds: jsonb("joined_table_ids").notNull().default([]).$type<string[]>(),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default(""), // chi ha risposto al telefono
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("reservations_restaurant_date_idx").on(t.restaurantId, t.date),
  index("reservations_status_idx").on(t.restaurantId, t.status),
]);

// SEATING = realtà: l'occupazione effettiva del tavolo (anche walk-in, senza prenotazione)
export const seatings = pgTable("seatings", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  tableIds: jsonb("table_ids").notNull().$type<string[]>(), // >1 se accorpato
  tableLabel: text("table_label").notNull(),
  name: text("name").notNull().default(""),   // nome prenotazione o "Walk-in"
  partySize: integer("party_size").notNull(),
  note: text("note").notNull().default(""),
  billRequested: boolean("bill_requested").notNull().default(false),
  status: text("status").notNull().default("seduto"), // seduto | chiuso
  seatedAt: timestamp("seated_at", { withTimezone: true }).notNull().defaultNow(),
  expectedEndAt: timestamp("expected_end_at", { withTimezone: true }).notNull(),
  actualEndAt: timestamp("actual_end_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("seatings_restaurant_status_idx").on(t.restaurantId, t.status)]);

// Chi ha fatto cosa: fine alle "non ero stato io"
export const activityLog = pgTable("activity_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  staffName: text("staff_name").notNull().default(""),
  action: text("action").notNull(),  // reservation_created, seating_libera, ...
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("activity_restaurant_idx").on(t.restaurantId, t.createdAt)]);
