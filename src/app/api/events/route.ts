// Server-Sent Events: cambio dato → tutti i dispositivi aggiornano entro ~1s.
import { subscribe } from "@/server/hub";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const rid = new URL(req.url).searchParams.get("rid");
  if (!rid) return new Response("rid mancante", { status: 400 });
  let off: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (d: string) => controller.enqueue(enc.encode(`data: ${d}\n\n`));
      off = subscribe(rid, send);
      send(JSON.stringify({ kind: "hello" }));
      const ping = setInterval(() => { try { send(JSON.stringify({ kind: "ping" })); } catch { /* chiusa */ } }, 25000);
      req.signal.addEventListener("abort", () => { clearInterval(ping); off?.(); try { controller.close(); } catch { /* noop */ } });
    },
    cancel() { off?.(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
