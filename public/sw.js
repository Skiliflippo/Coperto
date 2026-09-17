// Service worker: app installabile + navigazioni resilienti.
// Le API restano network-only: i dati di sala devono essere freschi anche con
// wifi che balla. Le pagine cadono di nuovo in cache, così l'icona sulla home
// non mostra un 404 quando la rete manca.
const CACHE = "coperto-v3-iphone-fix";
const SHELL = ["/icon.svg", "/manifest.webmanifest", "/", "/app"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigazioni: rete, poi cache, poi la landing: mai una schermata 404.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached ?? caches.match("/app").then((app) => app ?? caches.match("/"))),
        ),
    );
    return;
  }

  // Risorsa statica: cache prima, rete dopo (aggiornata in background).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      });
    }),
  );
});
