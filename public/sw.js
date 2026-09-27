/*
 * Sampolio service worker — lightweight & deploy-safe.
 *
 * Scope rules (see AGENTS.md "Responsive & PWA"):
 *  - GET only. POSTs (server actions) and RSC payloads are NEVER touched — a
 *    replayed/cached mutation could corrupt financial data.
 *  - Never cache: /api/*, /auth/*, RSC requests (?_rsc / RSC header), /_next/data/*.
 *  - Navigations (HTML): network-first → cached offline page when offline. This is
 *    what keeps a fresh deploy's app shell from being served stale.
 *  - /_next/static/* and self-hosted fonts: cache-first (filenames are content
 *    hashed, so a new build emits new URLs). Only successful same-origin
 *    responses are stored (never a 404/5xx from a deploy restart), and the
 *    /_next/static/ entries are capped at MAX_STATIC_ENTRIES (oldest first), so
 *    dead chunks from earlier builds don't pile up between CACHE_VERSION bumps.
 *  - /themes/*.css and /icons/*: stale-while-revalidate (stable, non-hashed names).
 *
 * Updates: bump CACHE_VERSION whenever cached assets change. install→skipWaiting,
 * activate→drop old caches + clients.claim. /sw.js is served no-cache (next.config.ts)
 * so the browser re-checks this script every load.
 */
const CACHE_VERSION = 'v11';
const CACHE = `sampolio-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
// ~3 builds' worth of hashed chunks (one build emits ~100 files under /_next/static/).
const MAX_STATIC_ENTRIES = 300;

// Belt-and-suspenders: never let an accidentally-installed SW poison local dev.
const DISABLED = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

self.addEventListener('install', (event) => {
  if (DISABLED) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => trimStaticEntries())
      .then(() => self.clients.claim()),
  );
});

// Drop the oldest /_next/static/ entries beyond MAX_STATIC_ENTRIES. Cache
// keys() lists entries in insertion order, so the front of the list is the
// oldest build. An evicted chunk that is still in use is simply re-fetched.
// Calls are chained so concurrent puts never trim in parallel.
let trimChain = Promise.resolve();
function trimStaticEntries() {
  trimChain = trimChain
    .then(() => caches.open(CACHE))
    .then((cache) =>
      cache.keys().then((requests) => {
        const statics = requests.filter((r) => new URL(r.url).pathname.startsWith('/_next/static/'));
        const excess = statics.length - MAX_STATIC_ENTRIES;
        return excess > 0 ? Promise.all(statics.slice(0, excess).map((r) => cache.delete(r))) : undefined;
      }),
    )
    .catch(() => {});
  return trimChain;
}

function isRsc(request, url) {
  return request.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle GETs. Mutations / non-GET fall straight through to network.
  if (DISABLED || request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only.
  if (url.origin !== self.location.origin) return;

  // Never intercept dynamic / sensitive routes.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/_next/data/') ||
    isRsc(request, url)
  ) {
    return;
  }

  // Navigations (HTML documents): network-first, offline page as fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
    );
    return;
  }

  // Content-hashed immutable assets: cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            // Never persist a failed (404/5xx) or opaque/redirected response:
            // cache-first would serve it forever for that hashed URL.
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              event.waitUntil(
                caches
                  .open(CACHE)
                  .then((c) => c.put(request, copy))
                  .then(() => trimStaticEntries()),
              );
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Stable-named static assets (theme CSS, icons): stale-while-revalidate.
  if (url.pathname.startsWith('/themes/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((res) => {
              if (res && res.ok) cache.put(request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        }),
      ),
    );
    return;
  }

  // Everything else: let the network handle it (no caching).
});

// Local check-in notification (shown by the app via registration.showNotification —
// there is no push service). Clicking it focuses an open Sampolio tab and takes it
// to /overview, or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL('/overview', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c);
      if (existing) {
        return existing.focus().then((focused) => {
          if (focused && 'navigate' in focused) return focused.navigate(targetUrl);
          return focused;
        });
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
