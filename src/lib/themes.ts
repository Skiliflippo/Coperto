// Palette disponibili. Sono dati: aggiungerne una è una riga qui più il blocco
// di colori in globals.css, nessun'altra modifica al codice.
export type ThemeId = "terracotta" | "ardesia" | "bosco" | "bordeaux" | "notte";

export const THEMES: { id: ThemeId; label: string; hint: string; swatch: string[] }[] = [
  { id: "terracotta", label: "Terracotta", hint: "caldo, da trattoria", swatch: ["#E4572E", "#F5F1E8", "#231E16"] },
  { id: "ardesia", label: "Ardesia", hint: "sobrio, molto leggibile", swatch: ["#2F6FED", "#F2F4F7", "#171C24"] },
  { id: "bosco", label: "Bosco", hint: "verde riposante", swatch: ["#2F7D52", "#F1F5EF", "#1A241A"] },
  { id: "bordeaux", label: "Bordeaux", hint: "elegante, da sera", swatch: ["#9B2242", "#F7F1F2", "#241519"] },
  { id: "notte", label: "Notte", hint: "scuro anche di giorno", swatch: ["#E9A13B", "#101114", "#F0F1F4"] },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const isThemeId = (v: unknown): v is ThemeId => THEME_IDS.includes(v as ThemeId);
