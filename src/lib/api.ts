// Fetch client con errori parlanti.
// Ogni richiesta che modifica dati porta con sé l'identità di chi la fa: il server
// la usa per verificare che la persona appartenga davvero a quel ristorante.
export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(status: number, payload: any) {
    super(payload?.error ?? "Errore di rete");
    this.status = status;
    this.payload = payload;
  }
}

// Impostata dallo store di sessione a ogni login/logout: evita di dover passare
// staffId a mano in decine di chiamate sparse per l'app.
let currentStaffId: string | null = null;
export function setApiIdentity(staffId: string | null) {
  currentStaffId = staffId;
}

function getStaffId(): string | null {
  if (currentStaffId) return currentStaffId;
  try {
    const { useSession } = require("@/store/session") as any;
    return useSession?.getState?.()?.staff?.id ?? null;
  } catch {
    return null;
  }
}

export async function api<T = any>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const method = opts?.method ?? "GET";
  const staffId = getStaffId();
  const body = opts?.body && typeof opts.body === "object" && !Array.isArray(opts.body)
    ? { staffId, ...(opts.body as Record<string, unknown>) }
    : opts?.body;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: "Sei offline. Riprova tra poco." });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
