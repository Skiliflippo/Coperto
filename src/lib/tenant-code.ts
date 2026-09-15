import { randomBytes } from "node:crypto";

// Gruppi di caratteri che si leggono senza ambiguità: via I/l/1, O/0, U/V.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Codice locale: identificatore pubblico, non il nome del ristorante.
 * Non è un segreto (chi lo ha entra nel flusso di login col PIN), ma non deve
 * essere indovinabile dal nome del locale. 10 caratteri = ~57 bit di spazio.
 */
export function generateTenantCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Converte un input in codice locale: maiuscole, via spazi e punteggiatura. */
export function normalizeTenantCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

export function isTenantCode(value: string): boolean {
  const normalized = normalizeTenantCode(value);
  return /^[A-Z0-9]{6,16}$/.test(normalized) && /[A-Z]/.test(normalized) && /[0-9]/.test(normalized);
}
