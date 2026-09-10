// Orari "da sala": tutto in minuti da mezzanotte, niente fusi lato client.
export const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
export const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

const GIORNI = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
export function dayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`;
}
export function relDay(iso: string): string {
  if (iso === todayISO()) return "Oggi";
  if (iso === todayISO(1)) return "Domani";
  if (iso === todayISO(-1)) return "Ieri";
  return dayLabel(iso);
}
export const addDays = (iso: string, d: number) => {
  const dt = new Date(iso + "T12:00:00");
  dt.setDate(dt.getDate() + d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
export const mmssAgo = (fromIso: string, now = Date.now()) =>
  Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 60000));
