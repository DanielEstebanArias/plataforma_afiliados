const BASE = new URL(self.registration.scope).pathname;
const CACHE = 'afiliados-shell-v3-' + BASE;
const FILES = [
  '',
  'index.html',
  'style.css',
  'tree.css',
  'tree.js',
  'features-ui.js',
  'features.css',
  'paging.js',
  'local.css',
  'app.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest',
].map((p) => BASE + p);
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k === 'afiliados-shell-v1' || (k.endsWith('-' + BASE) && k !== CACHE))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (
    e.request.method !== 'GET' ||
    u.origin !== location.origin ||
    u.pathname.startsWith('/api/') ||
    !FILES.includes(u.pathname)
  )
    return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
