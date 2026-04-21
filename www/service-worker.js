const CACHE_NAME = 'dolibarr-pwa-v8'; // Aggiornato a v8 per fix password visibility
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './logo.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Forza l'installazione immediata
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  return self.clients.claim(); // Prende subito il controllo della pagina
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
