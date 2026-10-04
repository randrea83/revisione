// Service worker: rende l'app utilizzabile offline.
// VERSIONE_DATI viene aggiornata da esporta_smartphone.py a ogni nuova esportazione delle domande.
const VERSIONE_APP = "1.0.0";
const VERSIONE_DATI = "8123f697a7";
const CACHE = `quiz-revisione-${VERSIONE_APP}-${VERSIONE_DATI}`;
const FILE = [
  "./", "index.html", "app.js", "stile.css", "manifest.webmanifest", "domande.json",
  "vendor/bootstrap.min.css", "icone/icona-192.png", "icone/icona-512.png", "icone/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // elimina le cache delle versioni precedenti
  e.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  // prima la cache (funziona offline), altrimenti la rete
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request))
  );
});
