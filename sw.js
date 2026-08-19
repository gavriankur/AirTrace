const CACHE_NAME = "airtrace-v17";
const MAP_CACHE = "airtrace-map-v1";
const APP_FILES = ["./", "./index.html", "./styles.css", "./config.js", "./app.js", "./manifest.webmanifest", "./vendor/maplibre-gl.js", "./vendor/maplibre-gl.css", "./vendor/maplibre-LICENSE.txt"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => ![CACHE_NAME, MAP_CACHE].includes(key)).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.hostname === "tiles.openfreemap.org") {
    event.respondWith(
      caches.open(MAP_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok || response.type === "opaque") cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
  );
});
