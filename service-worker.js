// Serve a rendere il sito installabile come app e a farlo aprire anche senza connessione.
// Le pagine del sito: prende sempre la versione più recente dalla rete; la copia salvata si usa solo offline.
// Le librerie (Supabase e Sortable) hanno la versione nell'indirizzo, quindi non cambiano: si usa la copia salvata.
// Le richieste al database (Supabase) non passano di qui: i dati offline li salva la pagina.
const CACHE = 'cose-da-fare-v2';
const LIBRERIE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
];

self.addEventListener('install', (evento) => {
  self.skipWaiting();
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', ...LIBRERIE])).catch(() => {}));
});

self.addEventListener('activate', (evento) => {
  // Cancella le copie delle versioni precedenti
  evento.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((nome) => nome !== CACHE).map((nome) => caches.delete(nome))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const richiesta = evento.request;
  if (richiesta.method !== 'GET') return;

  if (LIBRERIE.includes(richiesta.url)) {
    evento.respondWith(
      caches.match(richiesta).then((salvata) => salvata || fetch(richiesta).then((risposta) => {
        const copia = risposta.clone();
        caches.open(CACHE).then((cache) => cache.put(richiesta, copia));
        return risposta;
      }))
    );
    return;
  }

  if (new URL(richiesta.url).origin !== location.origin) return;

  evento.respondWith(
    fetch(richiesta)
      .then((risposta) => {
        const copia = risposta.clone();
        caches.open(CACHE).then((cache) => cache.put(richiesta, copia));
        return risposta;
      })
      // Senza connessione: la copia salvata, anche se l'indirizzo ha parametri diversi (per esempio ?v=2)
      .catch(() => caches.match(richiesta, { ignoreSearch: true })
        .then((salvata) => salvata || (richiesta.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});
