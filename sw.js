/* 另一个我 · service worker
 * Lets the app open and work offline. Memories and sign-in never pass through this cache:
 * requests to Supabase always go straight to the network.
 */
const VERSION = 'another-me-6';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'sync.js', 'sky.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.all(LIBS.map(url => cache.add(new Request(url, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Pinned libraries and font files never change: serve them from the cache.
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') (await caches.open(VERSION)).put(request, res.clone());
  return res;
}

// The app's own files: try the network so updates arrive, fall back to the cache when offline or slow.
// `no-cache` makes the browser revalidate with GitHub Pages instead of reusing its 10-minute HTTP cache,
// so a new release reaches installed devices on the next launch.
async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
    ]);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true }) ||
      (request.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;
  if (LIBS.includes(request.url) || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
