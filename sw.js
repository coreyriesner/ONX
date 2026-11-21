// Northwoods Hunt Map service worker: offline app shell + cache of recently viewed map data.
const V = 'v2';
const SHELL = 'shell-' + V, TILES = 'tiles-' + V, DATA = 'data-' + V, IMGS = 'imgs-' + V;
const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/esri-leaflet@3.0.12/dist/esri-leaflet.js',
  'https://unpkg.com/suncalc@1.9.0/suncalc.js'
];
const LIMITS = { [TILES]: 3000, [IMGS]: 300, [DATA]: 300 };
const lastTrim = {};

self.addEventListener('install', e => {
  // local files must cache; CDN libraries are best-effort (cached on first use otherwise)
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.filter(f => f.startsWith('./')))
    .then(() => Promise.allSettled(SHELL_FILES.filter(f => f.startsWith('http')).map(f => c.add(new Request(f, { mode: 'cors' }))))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !k.endsWith('-' + V)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(name) {
  const max = LIMITS[name]; if (!max) return;
  // enumerating a big cache is expensive, so only check every 30s
  const now = Date.now(); if (lastTrim[name] && now - lastTrim[name] < 30000) return; lastTrim[name] = now;
  const c = await caches.open(name); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // never store opaque (no-CORS) responses: iOS counts each as ~7 MB of storage
  if (res.ok && res.type !== 'opaque') { c.put(req, res.clone()); trim(name); }
  return res;
}
async function networkFirst(req, name) {
  const c = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') { c.put(req, res.clone()); trim(name); }
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: false });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const isTile = /\/tile\/\d+\/\d+\/\d+/.test(u.pathname) || /tile\.(opentopomap|openstreetmap)\.org$/.test(u.hostname);
  const isExport = /\/MapServer\/export$/.test(u.pathname);
  const isData = /\/(query|suggest|findAddressCandidates)$/.test(u.pathname) || u.hostname === 'api.open-meteo.com' || /\/(MapServer|FeatureServer)(\/\d+)?\/?$/.test(u.pathname);
  if (u.origin === location.origin) {
    // app files: network first so updates show up, cached copy when offline
    e.respondWith(networkFirst(req, SHELL).catch(() => caches.match('./index.html')));
  } else if (u.hostname === 'unpkg.com') {
    e.respondWith(cacheFirst(req, SHELL));
  } else if (isTile) {
    e.respondWith(cacheFirst(req, TILES));
  } else if (isExport) {
    e.respondWith(networkFirst(req, IMGS));
  } else if (isData) {
    e.respondWith(networkFirst(req, DATA));
  }
});
