/* Service worker: lưu sẵn giao diện để app mở được cả khi mạng chập chờn.
 * Luôn ưu tiên bản mới trên mạng (network-first), mất mạng mới dùng bản đã lưu.
 * Không đụng tới các lệnh gọi Apps Script. */
var CACHE = 'dem-mat-v1';
var SHELL = ['./', 'index.html', 'counter.js', 'worker.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) { return r || caches.match('index.html'); });
  }));
});
