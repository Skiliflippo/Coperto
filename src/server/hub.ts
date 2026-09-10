// Hub realtime in-process (SSE). Costo zero, sostituibile con Supabase Realtime in fase SaaS
// senza toccare i client: basterà ricollegare broadcast() al canale.
type Listener = (data: string) => void;
const g = globalThis as unknown as { __copertoHub?: Map<string, Set<Listener>> };
const hub = (g.__copertoHub ??= new Map());

export function broadcast(restaurantId: string, payload: { actor?: string; msg?: string; kind?: string }) {
  const set = hub.get(restaurantId);
  if (!set?.size) return;
  const data = JSON.stringify({ ...payload, at: Date.now() });
  for (const l of set) { try { l(data); } catch { /* connessione chiusa */ } }
}
export function subscribe(restaurantId: string, l: Listener): () => void {
  const set = hub.get(restaurantId) ?? new Set();
  set.add(l); hub.set(restaurantId, set);
  return () => { set.delete(l); };
}
