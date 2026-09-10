// Fetch client con errori parlanti
export class ApiError extends Error {
  status: number; payload: any;
  constructor(status: number, payload: any) {
    super(payload?.error ?? "Errore di rete");
    this.status = status; this.payload = payload;
  }
}
export async function api<T = any>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts?.method ?? "GET",
      headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: "Sei offline. Riprova tra poco." });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
