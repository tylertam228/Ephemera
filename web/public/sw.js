const shell = "ephemera-shell-v1";
const assets = ["/", "/index.html", "/manifest.webmanifest", "/logo.png", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(shell).then((cache) => cache.addAll(assets)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== shell).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/assets/"))) {
          const copy = res.clone();
          caches.open(shell).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html"))),
  );
});
