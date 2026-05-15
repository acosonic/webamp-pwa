const CACHE_VERSION = 'v23';
const CACHE_NAME = `webamp-${CACHE_VERSION}`;

const SCOPE = new URL(self.registration.scope).pathname;

const SHELL = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'app.js',
  SCOPE + 'style.css',
  SCOPE + 'manifest.json',
  SCOPE + 'vendor_js/webamp.bundle.min.js',
  SCOPE + 'icons/icon-192.png',
  SCOPE + 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('webamp-') && n !== CACHE_NAME)
           .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

function isSameOrigin(req) { return new URL(req.url).origin === self.location.origin; }

function isCacheableSkin(url) {
  return url.hostname === 'r2.webampskins.org';
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const net = fetch(req).then((r) => {
    if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
    return r;
  }).catch(() => null);
  return cached || net || fetch(req);
}

async function networkFirst(req) {
  try {
    const r = await fetch(req);
    if (r && r.ok) (await caches.open(CACHE_NAME)).put(req, r.clone());
    return r;
  } catch (e) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match(SCOPE + 'index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isSameOrigin(request)) {
    const isNav = request.mode === 'navigate' ||
                  (request.headers.get('accept') || '').includes('text/html');
    event.respondWith(isNav ? networkFirst(request) : staleWhileRevalidate(request));
    return;
  }

  // Cache skin assets (screenshots + .wsz) so once loaded they work offline
  if (isCacheableSkin(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('webamp-')).map((n) => caches.delete(n)));
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)));
      event.source && event.source.postMessage({ type: 'CACHE_CLEARED' });
    })());
  }
});
