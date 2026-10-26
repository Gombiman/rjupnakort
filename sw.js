/* Rjúpnakort — service worker: vistar síðuna og kortaflísar svo kortið opnist án nets */
const SHELL = "rk-shell-v4";
const TILES = "rk-tiles";
const SHELL_URLS = [
  "./",
  "./rjupnakort.html",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];
const TILE_HOSTS = /(tile\.opentopomap\.org|tile\.openstreetmap\.org|server\.arcgisonline\.com)/;
const FONT_HOSTS = /(fonts\.googleapis\.com|fonts\.gstatic\.com)/;

// Sama flís af a./b./c. undirléni á að vera ein færsla
const tileKey = url => url.replace(/\/\/[abc]\.tile\.opentopomap\.org/, "//a.tile.opentopomap.org");

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map(async u => {
      try { const r = await fetch(u, {cache: "reload"}); if (r.ok) await c.put(u, r); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("rk-shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirstPage(req) {
  const c = await caches.open(SHELL);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(req, {signal: ctl.signal});
    clearTimeout(t);
    if (r.ok) c.put("./rjupnakort.html", r.clone());
    return r;
  } catch (_) {
    return (await c.match("./rjupnakort.html")) || (await c.match("./")) ||
      new Response("<h1>Rjúpnakort</h1><p>Ekkert net og síðan hefur ekki verið vistuð enn. Opnaðu hana einu sinni á neti.</p>",
                   {headers: {"Content-Type": "text/html; charset=utf-8"}});
  }
}

async function cacheFirst(req, cacheName, key) {
  const c = await caches.open(cacheName);
  const hit = await c.match(key || req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") c.put(key || req, r.clone());
  return r;
}

async function tile(req) {
  const c = await caches.open(TILES);
  const key = tileKey(req.url);
  const hit = await c.match(key);
  if (hit) return hit;
  try { return await fetch(req); }
  catch (_) { return new Response("", {status: 504}); }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;
  if (req.mode === "navigate") return e.respondWith(networkFirstPage(req));
  if (TILE_HOSTS.test(url)) return e.respondWith(tile(req));
  if (FONT_HOSTS.test(url) || url.includes("cdnjs.cloudflare.com/ajax/libs/leaflet/") || url.includes("cdn.jsdelivr.net/npm/shpjs"))
    return e.respondWith(cacheFirst(req, SHELL).catch(() => new Response("", {status: 504})));
});
