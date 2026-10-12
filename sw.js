const CACHE = 'spese-v12';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'ocr.js', 'config.js', 'drive.js', 'privacy.html',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App: dalla cache e aggiornata in background (al riavvio successivo si vedono le novità).
// Motore OCR (jsdelivr): cache-first. Google (login, Drive) e tutto il resto: mai intercettati.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  if (!own && url.hostname !== 'cdn.jsdelivr.net') return;

  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    });
    if (hit) { if (own) net.catch(() => {}); return hit; }
    return net;
  }));
});
