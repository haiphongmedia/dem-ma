/* Chạy bộ đếm ở luồng nền để giao diện không bị đứng. */
importScripts('counter.js');
self.onmessage = function (e) {
  var d = e.data;
  try {
    var r = Counter.detect(new Uint8ClampedArray(d.buf), d.w, d.h, d.opts);
    self.postMessage({ id: d.id, res: r }, [r.labels.buffer, r.keep.buffer]);
  } catch (err) {
    self.postMessage({ id: d.id, err: String(err) });
  }
};
