/* Omega Nannies service worker.
 * Privacy rule: only public, versioned static assets are cached. Pages, RSC payloads, API responses, documents,
 * photos and anything authenticated always go to the network and are never stored. */
const VERSION = "omega-static-v1";
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/omega-logo.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE))); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
  if (e.data === "clear") caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
});
const isStatic = (url) => url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/") || url.pathname === "/omega-logo.png");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    // Network only; show the offline page if the network is unavailable. Never cache HTML.
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (isStatic(url)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
