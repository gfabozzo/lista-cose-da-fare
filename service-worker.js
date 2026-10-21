// Serve a rendere il sito installabile come app.
// Prende sempre la versione più recente dalla rete; la copia salvata si usa solo senza connessione.
// Le richieste al database (Supabase) non passano di qui.
const CACHE = 'cose-da-fare-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (evento) => {
  const richiesta = evento.request;
  if (richiesta.method !== 'GET' || new URL(richiesta.url).origin !== location.origin) return;

  evento.respondWith(
    fetch(richiesta)
      .then((risposta) => {
        const copia = risposta.clone();
        caches.open(CACHE).then((cache) => cache.put(richiesta, copia));
        return risposta;
      })
      .catch(() => caches.match(richiesta))
  );
});
