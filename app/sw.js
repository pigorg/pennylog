const CACHE = 'pennylog-v6';
const VENDOR = 'pennylog-vendor-v1'; // motore di lettura scontrini: grande e immutabile, si scarica una sola volta
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'i18n.js', 'db.js', 'ocr.js', 'config.js', 'drive.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Solo file del nostro dominio: google (login, Drive) e tutto il resto non passano mai di qui.
// App: dalla cache e aggiornata in background (al riavvio successivo si vedono le novità).
// /vendor/: prima la cache, senza ricontrollare (i file non cambiano; per aggiornarli si cambia VENDOR).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open(VENDOR).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.status === 200) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }

  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(res => {
      if (res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
});
