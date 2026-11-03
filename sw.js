/* ExpenseFlow service worker: works offline after the first visit.
   Bump CACHE when you ship changes so everyone gets the new files. */
var CACHE = 'expenseflow-v8';
var SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "css/gate.css",
  "js/store.js",
  "js/hero.js",
  "js/cursor.js",
  "js/intro.js",
  "js/gate.js",
  "js/app.js",
  "manifest.webmanifest",
  "assets/frames/closed.jpg",
  "assets/frames/open_cash.jpg",
  "assets/frames/open_empty.jpg",
  "assets/fonts/big-shoulders-display-latin-700-normal.woff2",
  "assets/fonts/big-shoulders-display-latin-800-normal.woff2",
  "assets/fonts/big-shoulders-display-latin-900-normal.woff2",
  "assets/fonts/big-shoulders-display-latin-ext-700-normal.woff2",
  "assets/fonts/big-shoulders-display-latin-ext-800-normal.woff2",
  "assets/fonts/big-shoulders-display-latin-ext-900-normal.woff2",
  "assets/fonts/dm-mono-latin-400-normal.woff2",
  "assets/fonts/dm-mono-latin-500-normal.woff2",
  "assets/fonts/dm-mono-latin-ext-400-normal.woff2",
  "assets/fonts/dm-mono-latin-ext-500-normal.woff2"
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  var isAsset = /\/assets\//.test(req.url);
  if (isAsset) { // fonts and images never change: cache first
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
    return;
  }
  e.respondWith(fetch(req).then(function (res) { // pages and code: network first so updates show
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () { return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); }); }));
});
