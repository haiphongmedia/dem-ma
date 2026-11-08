/* Service worker v7: trang luôn lấy bản mới khi có mạng; file trong /assets/ có mã băm nên lưu vĩnh viễn. */
var CACHE = 'dem-lk-v7';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/assets/') >= 0) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var c = res.clone(); caches.open(CACHE).then(function (ca) { ca.put(req, c); }); }
        return res;
      });
    }));
    return;
  }
  e.respondWith(fetch(req, { cache: 'no-store' }).then(function (res) {
    if (res.ok) { var c = res.clone(); caches.open(CACHE).then(function (ca) { ca.put(req, c); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) { return r || caches.match('./'); });
  }));
});
