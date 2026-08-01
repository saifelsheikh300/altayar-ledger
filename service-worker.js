const CACHE_NAME = "altayar-ledger-v1";
const CORE_ASSETS = [
  "./index.html",
  "./admin.html",
  "./driver.html",
  "./css/style.css",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/admin.js",
  "./js/driver.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first عشان بيانات Supabase والصفحات تفضل محدثة، مع fallback للكاش لو النت وقع
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // سيب طلبات Supabase الخارجية زي ما هي

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
