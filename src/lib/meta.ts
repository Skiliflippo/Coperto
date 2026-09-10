// Metadati di presentazione: colori/etichette degli stati, terminologia da sala.
import type { TableLiveState, ResStatus } from "./types";

export const TABLE_STATE: Record<TableLiveState, { label: string; dot: string; card: string; text: string }> = {
  libero:         { label: "Libero",        dot: "bg-ok",    card: "border-ok/50",     text: "text-ok" },
  occupato:       { label: "Occupato",      dot: "bg-busy",  card: "border-busy/50",   text: "text-busy" },
  in_liberazione: { label: "Si libera",     dot: "bg-soon",  card: "border-soon/60",   text: "text-soon" },
  oltre_tempo:    { label: "Oltre tempo",   dot: "bg-over",  card: "border-over/60",   text: "text-over" },
  da_pulire:      { label: "Da pulire",     dot: "bg-clean", card: "border-clean/60",  text: "text-clean" },
  fuori_servizio: { label: "Fuori servizio",dot: "bg-oos",   card: "border-oos/60",    text: "text-oos" },
};

export const RES_STATUS: Record<ResStatus | "da_sistemare" | "sistemata" | "in_ritardo", { label: string; cls: string }> = {
  da_sistemare: { label: "Da sistemare", cls: "bg-soon/15 text-soon border-soon/40" },
  sistemata:    { label: "Sistemata",    cls: "bg-busy/15 text-busy border-busy/40" },
  seduta:       { label: "Seduta",       cls: "bg-ok/15 text-ok border-ok/40" },
  in_ritardo:   { label: "In ritardo",   cls: "bg-brand/15 text-brand border-brand/40" },
  no_show:      { label: "No-show",      cls: "bg-over/15 text-over border-over/40" },
  cancellata:   { label: "Cancellata",   cls: "bg-clean/15 text-clean border-clean/40" },
  confermata:   { label: "Confermata",   cls: "bg-busy/15 text-busy border-busy/40" },
};

export const WAIT_STATUS = {
  in_attesa:  { label: "In attesa",  cls: "bg-soon/15 text-soon border-soon/40" },
  avvisato:   { label: "Avvisato",   cls: "bg-busy/15 text-busy border-busy/40" },
  seduto:     { label: "Seduto",     cls: "bg-ok/15 text-ok border-ok/40" },
  andato_via: { label: "Andato via", cls: "bg-clean/15 text-clean border-clean/40" },
} as const;

export const fmtCovers = (n: number) => `${n} copert${n === 1 ? "o" : "i"}`;
