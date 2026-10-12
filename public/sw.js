// public/sw.js — the precache service worker (ARCHITECTURE §13.11): the game plays offline once it has loaded. Owner: WP-H.
// Registered by main.ts in production builds only (ui/platform.ts registerWorker), from the app's own folder, so its scope
// is that folder (a GitHub Pages sub-path, e.g. /Roma2/): every URL here is relative to it. The build writes the two
// constants below (vite.config.ts → scripts/precache.ts): BUILD, a hash of every file of the build, and PRECACHE, the
// build's files. A new build is a new BUILD, so this file's bytes change, the browser installs it, and its cache replaces
// the old one. Cache Storage is the origin's, shared by every folder of it (each Pages repo of an account): the cache's
// name carries this folder, and activate deletes only this folder's older ones. Install fetches past the HTTP cache (an
// older page kept there must never be stored beside this build's files). Requests: the app's page (a navigation to the
// folder or its index.html) network first, revalidated, so an online launch runs the newest build, falling back to the
// cached page offline; any other file of the folder opened in a tab goes to the network untouched (it never replaces the
// page); anything else of this folder cache first (the hashed assets never change under their name; the icons and the
// manifest are precached); other origins, and other folders of the same origin, are never touched.
const BUILD = 'dev';
const PRECACHE = [];

const SCOPE = new URL('./', self.location.href).href;
const FOLDER = new URL(SCOPE).pathname;   // e.g. /Roma2/
const PREFIX = `castra-${FOLDER}-`;        // this folder's caches, apart from another folder's of the same origin
const CACHE = `${PREFIX}${BUILD}`;
const PAGE = SCOPE;   // the page is kept under the folder's own URL, whatever query a launch adds (?dev)
const INDEX = new URL('index.html', SCOPE).href;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([PAGE, ...PRECACHE.map((f) => new URL(f, SCOPE).href)].map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  if (req.mode !== 'navigate') e.respondWith(asset(req));
  else if (url.pathname === FOLDER || url.pathname === `${FOLDER}index.html`) e.respondWith(page(req));
  // (any other file of the folder opened in a tab, sw.js or an icon: the network's, untouched)
});

/** The app's page: the network's when it answers (revalidated past the HTTP cache, and kept for offline when it is a
 *  page), else the cached one. */
async function page(req) {
  const cache = await caches.open(CACHE);
  try {
    // (a navigation's own redirect mode: a redirect goes back to the browser to follow)
    const res = await fetch(req.url, { cache: 'no-cache', redirect: 'manual' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) await cache.put(PAGE, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(PAGE)) ?? (await cache.match(INDEX));
    if (hit) return hit;
    throw err;
  }
}

/** Anything else of this folder: the cached copy, else the network's (kept: the folder holds only the build's files). */
async function asset(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') await cache.put(req, res.clone());
  return res;
}
