/**
 * Counter — bộ đếm vật nhỏ bằng JavaScript thuần (không thư viện ngoài).
 * Quy trình: xám hoá → Otsu sơ bộ → ước lượng nền cục bộ (bỏ qua vật) → tách vật theo
 * độ chênh với nền → làm sạch nhiễu → lấp lỗ (đá trong suốt) → gán nhãn vùng →
 * tách cụm dính bằng distance transform + kiểm tra diện tích.
 * Toạ độ trả về tính theo ảnh đầu vào (đã cắt vùng đếm).
 */
var Counter = (function () {
  'use strict';

  function toGray(rgba, n) {
    var g = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    }
    return g;
  }

  function otsu(hist, total) {
    var sum = 0, i;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = -1, t = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }

  // Trung bình cục bộ chỉ trên các điểm nền (mask = 1), cửa sổ (2r+1)^2, dùng ảnh tích phân.
  function maskedMean(gray, mask, w, h, r) {
    var W = w + 1, S = new Float64Array(W * (h + 1)), C = new Float64Array(W * (h + 1));
    for (var y = 0; y < h; y++) {
      var rs = 0, rc = 0, row = y * w, o = (y + 1) * W, p = y * W;
      for (var x = 0; x < w; x++) {
        if (mask[row + x]) { rs += gray[row + x]; rc++; }
        S[o + x + 1] = S[p + x + 1] + rs;
        C[o + x + 1] = C[p + x + 1] + rc;
      }
    }
    var last = h * W + w, gmean = C[last] > 0 ? S[last] / C[last] : 128;
    var out = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = y - r < 0 ? 0 : y - r, y1 = y + r + 1 > h ? h : y + r + 1;
      var a0 = y0 * W, a1 = y1 * W;
      for (x = 0; x < w; x++) {
        var x0 = x - r < 0 ? 0 : x - r, x1 = x + r + 1 > w ? w : x + r + 1;
        var c = C[a1 + x1] - C[a0 + x1] - C[a1 + x0] + C[a0 + x0];
        if (c > 8) {
          out[y * w + x] = (S[a1 + x1] - S[a0 + x1] - S[a1 + x0] + S[a0 + x0]) / c;
        } else {
          out[y * w + x] = gmean;
        }
      }
    }
    return out;
  }

  // Khớp mặt cong đa thức bậc 4 (15 hệ số) cho nền trên các điểm mask = 1 (mask null = mọi điểm).
  // Mô tả tốt kiểu tối dần ra góc của ống kính điện thoại, kể cả sát mép ảnh.
  var PT = [];
  for (var pd = 0; pd <= 4; pd++) for (var pa = pd; pa >= 0; pa--) PT.push([pa, pd - pa]);
  function polyFit(gray, mask, w, h) {
    var T = PT.length, A = new Float64Array(T * T), B = new Float64Array(T), f = new Float64Array(T);
    var step = Math.max(1, Math.round(Math.sqrt(w * h / 40000))), cnt = 0, x, y, p, q, k;
    for (y = 0; y < h; y += step) {
      var v = 2 * y / (h - 1 || 1) - 1;
      for (x = 0; x < w; x += step) {
        var idx = y * w + x;
        if (mask && !mask[idx]) continue;
        var u = 2 * x / (w - 1 || 1) - 1, g = gray[idx];
        for (k = 0; k < T; k++) f[k] = Math.pow(u, PT[k][0]) * Math.pow(v, PT[k][1]);
        for (p = 0; p < T; p++) { B[p] += f[p] * g; for (q = 0; q < T; q++) A[p * T + q] += f[p] * f[q]; }
        cnt++;
      }
    }
    if (cnt < 60) return null;
    for (p = 0; p < T; p++) A[p * T + p] += 1e-6 * cnt;
    // Khử Gauss có chọn trụ.
    for (p = 0; p < T; p++) {
      var piv = p;
      for (q = p + 1; q < T; q++) if (Math.abs(A[q * T + p]) > Math.abs(A[piv * T + p])) piv = q;
      if (piv !== p) {
        for (k = 0; k < T; k++) { var tmp = A[p * T + k]; A[p * T + k] = A[piv * T + k]; A[piv * T + k] = tmp; }
        var tb = B[p]; B[p] = B[piv]; B[piv] = tb;
      }
      var dg = A[p * T + p]; if (Math.abs(dg) < 1e-12) return null;
      for (q = p + 1; q < T; q++) {
        var fac = A[q * T + p] / dg; if (!fac) continue;
        for (k = p; k < T; k++) A[q * T + k] -= fac * A[p * T + k];
        B[q] -= fac * B[p];
      }
    }
    var c = new Float64Array(T);
    for (p = T - 1; p >= 0; p--) {
      var s = B[p];
      for (k = p + 1; k < T; k++) s -= A[p * T + k] * c[k];
      c[p] = s / A[p * T + p];
    }
    // Tính nhanh: mỗi hàng quy về đa thức bậc 4 theo u, rồi Horner cho từng điểm.
    var out = new Float32Array(w * h), rc = new Float64Array(5), du = 2 / (w - 1 || 1);
    for (y = 0; y < h; y++) {
      var vv = 2 * y / (h - 1 || 1) - 1;
      rc[0] = rc[1] = rc[2] = rc[3] = rc[4] = 0;
      for (k = 0; k < T; k++) rc[PT[k][0]] += c[k] * Math.pow(vv, PT[k][1]);
      var o = y * w;
      for (x = 0; x < w; x++) {
        var uu = x * du - 1;
        out[o + x] = (((rc[4] * uu + rc[3]) * uu + rc[2]) * uu + rc[1]) * uu + rc[0];
      }
    }
    return out;
  }

  /**
   * Tìm vùng nền trắng của light pad: vùng "trắng" (kênh màu nhỏ nhất cao — khung đỏ có kênh
   * xanh lá/xanh dương thấp nên bị loại) lớn nhất, lấy bao lồi để vật nằm sát mép vẫn ở trong,
   * rồi co vào một chút để bỏ dải viền chuyển màu. Trả về null nếu không thấy.
   */
  function findPad(rgba, w, h) {
    var n = w * h, mn = new Uint8Array(n), hist = new Float64Array(256), i, x, y;
    for (i = 0; i < n; i++) {
      var j = i * 4, a = rgba[j], b = rgba[j + 1], c = rgba[j + 2];
      var v = a < b ? (a < c ? a : c) : (b < c ? b : c);
      mn[i] = v; hist[v]++;
    }
    var t = otsu(hist, n);
    // Nền trắng phải thực sự sáng và khác biệt rõ với phần còn lại.
    var sumHi = 0, cntHi = 0, sumLo = 0, cntLo = 0;
    for (i = 0; i < 256; i++) { if (i > t) { sumHi += i * hist[i]; cntHi += hist[i]; } else { sumLo += i * hist[i]; cntLo += hist[i]; } }
    if (!cntHi || !cntLo || sumHi / cntHi < 110 || sumHi / cntHi - sumLo / cntLo < 40) return null;
    var bright = new Uint8Array(n);
    for (i = 0; i < n; i++) bright[i] = mn[i] > t ? 1 : 0;
    return regionFromBinary(bright, w, h, 0.04);
  }

  // ---------- Phân loại vật ----------
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function dist2(a, b) { var s = 0; for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; } return s; }

  function kmeans(X, k, seed) {
    var R = rng(seed), N = X.length, D = X[0].length, cent = [], i, j, it;
    cent.push(X[Math.floor(R() * N)].slice());
    while (cent.length < k) { // k-means++
      var dsum = 0, dd = X.map(function (x) { var m = Infinity; cent.forEach(function (c) { var v = dist2(x, c); if (v < m) m = v; }); dsum += m; return m; });
      var t = R() * dsum, pick = 0;
      for (i = 0; i < N; i++) { t -= dd[i]; if (t <= 0) { pick = i; break; } }
      cent.push(X[pick].slice());
    }
    var as = new Int32Array(N);
    for (it = 0; it < 40; it++) {
      var changed = false;
      for (i = 0; i < N; i++) {
        var best = 0, bd = Infinity;
        for (j = 0; j < k; j++) { var v2 = dist2(X[i], cent[j]); if (v2 < bd) { bd = v2; best = j; } }
        if (as[i] !== best || it === 0) { changed = changed || as[i] !== best; as[i] = best; }
      }
      var sums = [], cnt = new Int32Array(k);
      for (j = 0; j < k; j++) sums.push(new Float64Array(D));
      for (i = 0; i < N; i++) { cnt[as[i]]++; for (var d = 0; d < D; d++) sums[as[i]][d] += X[i][d]; }
      for (j = 0; j < k; j++) if (cnt[j]) for (d = 0; d < D; d++) cent[j][d] = sums[j][d] / cnt[j];
      if (!changed && it > 0) break;
    }
    var inertia = 0;
    for (i = 0; i < N; i++) inertia += dist2(X[i], cent[as[i]]);
    return { as: as, cent: cent, inertia: inertia };
  }

  function bestKmeans(X, k) {
    var best = null;
    for (var s = 1; s <= 4; s++) { var r = kmeans(X, k, s * 7919); if (!best || r.inertia < best.inertia) best = r; }
    return best;
  }

  function silhouette(X, as, k) {
    var N = X.length, tot = 0, i, j;
    for (i = 0; i < N; i++) {
      var sum = new Float64Array(k), cnt = new Int32Array(k);
      for (j = 0; j < N; j++) { if (i === j) continue; sum[as[j]] += Math.sqrt(dist2(X[i], X[j])); cnt[as[j]]++; }
      var a = cnt[as[i]] ? sum[as[i]] / cnt[as[i]] : 0, b = Infinity;
      for (j = 0; j < k; j++) if (j !== as[i] && cnt[j]) b = Math.min(b, sum[j] / cnt[j]);
      if (!cnt[as[i]] || b === Infinity) continue;
      tot += (b - a) / Math.max(a, b);
    }
    return tot / N;
  }

  function colorName(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx, s = mx ? (mx - mn) / mx : 0, hh = 0;
    if (v < 0.22) return 'đen';
    if (s < 0.2) return v > 0.78 ? 'trắng' : 'xám/bạc';
    if (mx === r) hh = 60 * (((g - b) / (mx - mn)) % 6); else if (mx === g) hh = 60 * ((b - r) / (mx - mn) + 2); else hh = 60 * ((r - g) / (mx - mn) + 4);
    if (hh < 0) hh += 360;
    if (hh < 15 || hh >= 345) return 'đỏ';
    if (hh < 40) return 'cam';
    if (hh < 70) return 'vàng';
    if (hh < 165) return 'xanh lá';
    if (hh < 255) return 'xanh dương';
    if (hh < 290) return 'tím';
    return 'hồng';
  }

  /**
   * Gom vật thành các loại theo: kích thước, độ thuôn dài, độ góc cạnh, màu (khi đếm trên nền màu).
   * k = 0 → tự chọn số loại (1–6) theo hệ số silhouette.
   */
  function classify(rgba, lab, keep, comps, markers, w, k, colorMode) {
    var C = comps.length, i, j, n = lab.length;
    if (!C) return [];
    var N = new Float64Array(C), SX = new Float64Array(C), SY = new Float64Array(C), SXX = new Float64Array(C),
      SYY = new Float64Array(C), SXY = new Float64Array(C), SR = new Float64Array(C), SG = new Float64Array(C), SB = new Float64Array(C);
    // Cụm dính nhiều vật: chia điểm ảnh của cụm cho tâm vật gần nhất → mỗi vật có cỡ & màu riêng.
    var M = markers.length, MA = new Float64Array(M), MR = new Float64Array(M), MG = new Float64Array(M), MB = new Float64Array(M);
    var cm = [];
    markers.forEach(function (m, mi) { if (comps[m.c].n > 1 && !comps[m.c].huge) (cm[m.c] = cm[m.c] || []).push(mi); });
    for (i = 0; i < n; i++) {
      var kk = keep[lab[i]]; if (!kk) continue;
      var c = kk - 1, y = (i / w) | 0, x = i - y * w, q = i * 4;
      N[c]++; SX[c] += x; SY[c] += y; SXX[c] += x * x; SYY[c] += y * y; SXY[c] += x * y;
      SR[c] += rgba[q]; SG[c] += rgba[q + 1]; SB[c] += rgba[q + 2];
      var lst = cm[c];
      if (lst) {
        var bm = lst[0], bdm = Infinity;
        for (var t1 = 0; t1 < lst.length; t1++) {
          var mk = markers[lst[t1]], ex = mk.x - x, ey = mk.y - y, dm = ex * ex + ey * ey;
          if (dm < bdm) { bdm = dm; bm = lst[t1]; }
        }
        MA[bm]++; MR[bm] += rgba[q]; MG[bm] += rgba[q + 1]; MB[bm] += rgba[q + 2];
      }
    }
    var cw = colorMode ? 3 : 0.6;
    var info = comps.map(function (cp, ci) {
      var a = N[ci] || 1, mx = SX[ci] / a, my = SY[ci] / a;
      var cxx = SXX[ci] / a - mx * mx + 1 / 12, cyy = SYY[ci] / a - my * my + 1 / 12, cxy = SXY[ci] / a - mx * my;
      var tr = cxx + cyy, det = Math.max(1e-6, cxx * cyy - cxy * cxy), disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      var l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
      var per = a / (cp.n || 1);
      return {
        area: per, elong: Math.sqrt(l1 / l2), fill: cp.n > 1 ? 1 : a / (4 * Math.PI * Math.sqrt(det)),
        rgb: [SR[ci] / a, SG[ci] / a, SB[ci] / a], single: (cp.n || 1) === 1 && !cp.huge
      };
    });
    function vec(f, useShape, ref) {
      return [2.5 * Math.log(f.area), useShape ? 2.0 * Math.log(f.elong) : ref[1], useShape ? 4.0 * Math.min(1.2, f.fill) : ref[2],
        cw * f.rgb[0] / 255, cw * f.rgb[1] / 255, cw * f.rgb[2] / 255];
    }
    var idxS = [], X = [];
    info.forEach(function (f, ci) { if (f.single) { idxS.push(ci); X.push(vec(f, true)); } });
    if (X.length > 400) { // giới hạn để chạy nhanh khi đếm trực tiếp
      var stepS = X.length / 400, X2 = [], I2 = [];
      for (i = 0; i < 400; i++) { var p = Math.floor(i * stepS); X2.push(X[p]); I2.push(idxS[p]); }
      X = X2; idxS = I2;
    }
    var K = 1, model = null;
    if (X.length >= 2) {
      var maxK = Math.min(6, Math.floor(X.length / 2));
      if (k >= 2) { K = Math.min(k, X.length); model = bestKmeans(X, K); }
      else if (X.length >= 6) {
        var bestSil = -1;
        for (var kk2 = 2; kk2 <= maxK; kk2++) {
          var mdl = bestKmeans(X, kk2), sil = silhouette(X, mdl.as, kk2);
          if (sil > bestSil) { bestSil = sil; model = mdl; K = kk2; }
        }
        if (bestSil < 0.55) { K = 1; model = null; }
      }
    }
    var cent = model ? model.cent : [X.length ? X[0].map(function (_, d) { return X.reduce(function (s, v) { return s + v[d]; }, 0) / X.length; }) : [0, 0, 4, 0, 0, 0]];
    // Xếp loại theo kích thước tăng dần → thứ tự ổn định giữa các lần đếm.
    var order = cent.map(function (c2, j2) { return j2; }).sort(function (a2, b2) { return cent[a2][0] - cent[b2][0]; });
    var rank = new Int32Array(order.length);
    order.forEach(function (o, r2) { rank[o] = r2; });
    function nearest(v) {
      var best = 0, bd = Infinity;
      for (var j3 = 0; j3 < cent.length; j3++) { var dd = dist2(v, cent[j3]); if (dd < bd) { bd = dd; best = j3; } }
      return best;
    }
    var compType = new Int32Array(C);
    info.forEach(function (f, ci) {
      var j4 = 0;
      if (cent.length > 1 && f.single) j4 = nearest(vec(f, true));
      if (cent.length > 1 && !f.single) { // cụm dính / vùng lớn: so khớp chỉ theo cỡ (mỗi vật) + màu
        var v = vec(f, false, [0, 0, 0]), best = 0, bd = Infinity;
        for (var j5 = 0; j5 < cent.length; j5++) {
          var dd2 = 0; for (var d2 = 0; d2 < 6; d2++) { if (d2 === 1 || d2 === 2) continue; var e = v[d2] - cent[j5][d2]; dd2 += e * e; }
          if (dd2 < bd) { bd = dd2; best = j5; }
        }
        j4 = best;
      }
      compType[ci] = rank[j4];
      comps[ci].t = rank[j4];
    });
    var types = [];
    for (j = 0; j < cent.length; j++) types.push({ count: 0, area: 0, elong: 0, fill: 0, rgb: [0, 0, 0], ns: 0 });
    markers.forEach(function (m, mi) {
      m.t = compType[m.c];
      if (cent.length > 1 && cm[m.c] && MA[mi] > 0) { // vật trong cụm dính: phân loại riêng theo phần diện tích của nó
        var a = MA[mi], v = vec({ area: a, elong: 1, fill: 1, rgb: [MR[mi] / a, MG[mi] / a, MB[mi] / a] }, false, [0, 0, 0]);
        var best = 0, bd = Infinity;
        for (var j6 = 0; j6 < cent.length; j6++) {
          var dd3 = 0; for (var d3 = 0; d3 < 6; d3++) { if (d3 === 1 || d3 === 2) continue; var e3 = v[d3] - cent[j6][d3]; dd3 += e3 * e3; }
          if (dd3 < bd) { bd = dd3; best = j6; }
        }
        m.t = rank[best];
      }
      types[m.t].count += m.w || 1;
    });
    info.forEach(function (f, ci) {
      if (!f.single) return;
      var T = types[compType[ci]];
      T.ns++; T.area += f.area; T.elong += f.elong; T.fill += Math.min(1.2, f.fill);
      T.rgb[0] += f.rgb[0]; T.rgb[1] += f.rgb[1]; T.rgb[2] += f.rgb[2];
    });
    return types.map(function (T, ti) {
      var m2 = Math.max(1, T.ns), area = T.area / m2, elong = T.elong / m2, fill = T.fill / m2;
      var rgb = [T.rgb[0] / m2, T.rgb[1] / m2, T.rgb[2] / m2];
      return {
        id: ti, count: T.count, diam: 2 * Math.sqrt(area / Math.PI), elong: elong, fill: fill, rgb: rgb,
        shape: elong > 1.6 ? 'thuôn dài' : fill < 0.86 ? 'góc cạnh' : 'tròn',
        color: colorMode ? colorName(rgb) : ''
      };
    });
  }

  // Co / giãn hình chữ thập 3x3 trên ảnh nhị phân.
  function erode(src, w, h) {
    var d = new Uint8Array(w * h);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1, i = y * w + 1; x < w - 1; x++, i++) {
        if (src[i] && src[i - 1] && src[i + 1] && src[i - w] && src[i + w]) d[i] = 1;
      }
    }
    return d;
  }
  function dilate(src, w, h) {
    var d = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0, i = y * w; x < w; x++, i++) {
        if (src[i] || (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) ||
            (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) d[i] = 1;
      }
    }
    return d;
  }

  // Gán nhãn các điểm có bin == val. conn8 = true: 8 hướng, false: 4 hướng.
  function label(bin, w, h, val, conn8) {
    var n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), comps = [], id = 0;
    for (var i = 0; i < n; i++) {
      if (bin[i] !== val || lab[i]) continue;
      id++;
      var sp = 0; stack[sp++] = i; lab[i] = id;
      var area = 0, sx = 0, sy = 0, minx = w, miny = h, maxx = 0, maxy = 0, border = false;
      while (sp) {
        var p = stack[--sp], y = (p / w) | 0, x = p - y * w;
        area++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (!conn8 && dx && dy) continue;
            var xx = x + dx; if (xx < 0 || xx >= w) continue;
            var q = yy * w + xx;
            if (bin[q] === val && !lab[q]) { lab[q] = id; stack[sp++] = q; }
          }
        }
      }
      comps.push({ id: id, area: area, cx: sx / area, cy: sy / area,
        x0: minx, y0: miny, x1: maxx, y1: maxy, border: border });
    }
    return { lab: lab, comps: comps };
  }

  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (p, q) { return p - q; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Distance transform chamfer 3-4 (đơn vị ≈ pixel).
  function distTransform(m, w, h) {
    var d = new Float32Array(w * h), INF = 1e9, x, y, i, v;
    for (i = 0; i < w * h; i++) d[i] = m[i] ? INF : 0;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x; v = d[i]; if (!v) continue;
        if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
        if (y > 0) {
          if (d[i - w] + 3 < v) v = d[i - w] + 3;
          if (x > 0 && d[i - w - 1] + 4 < v) v = d[i - w - 1] + 4;
          if (x < w - 1 && d[i - w + 1] + 4 < v) v = d[i - w + 1] + 4;
        }
        d[i] = v;
      }
    }
    for (y = h - 1; y >= 0; y--) {
      for (x = w - 1; x >= 0; x--) {
        i = y * w + x; v = d[i]; if (!v) continue;
        if (x < w - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
        if (y < h - 1) {
          if (d[i + w] + 3 < v) v = d[i + w] + 3;
          if (x < w - 1 && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
          if (x > 0 && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
        }
        d[i] = v;
      }
    }
    for (i = 0; i < w * h; i++) d[i] /= 3;
    return d;
  }

  // Tách một cụm: trả về danh sách điểm đánh dấu {x, y} (toạ độ ảnh).
  function splitComponent(lab, W, comp, rS, singleArea, mode, uniform, forcedN, dens) {
    var bx = comp.x0 - 1, by = comp.y0 - 1;
    var w = comp.x1 - comp.x0 + 3, h = comp.y1 - comp.y0 + 3;
    var m = new Uint8Array(w * h), x, y;
    for (y = comp.y0; y <= comp.y1; y++) {
      for (x = comp.x0; x <= comp.x1; x++) {
        if (lab[y * W + x] === comp.id) m[(y - by) * w + (x - bx)] = 1;
      }
    }
    var d = distTransform(m, w, h);
    var win = Math.max(1, Math.round(0.2 * rS)), minVal = Math.max(1.5, 0.3 * rS);
    var peaks = [];
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        var v = d[y * w + x];
        if (v < minVal) continue;
        var isMax = true;
        for (var dy = -win; dy <= win && isMax; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -win; dx <= win; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= w) continue;
            if (d[yy * w + xx] > v) { isMax = false; break; }
          }
        }
        if (isMax) peaks.push({ x: x, y: y, v: v });
      }
    }
    peaks.sort(function (a, b) { return b.v - a.v; });
    if (peaks.length > 600) peaks.length = 600;
    // Một đỉnh mới chỉ được giữ nếu giữa nó và mọi đỉnh đã giữ có "eo thắt":
    // khoảng cách tới biên trên đoạn nối tụt xuống rõ rệt (dấu hiệu hai vật chạm nhau,
    // khác với sống lưng của một vật dài/lớn).
    var kept = [];
    for (var i = 0; i < peaks.length; i++) {
      var pk = peaks[i], ok = true;
      for (var k = 0; k < kept.length && ok; k++) {
        var q = kept[k], ex = q.x - pk.x, ey = q.y - pk.y, dist = Math.sqrt(ex * ex + ey * ey);
        if (dist < 0.8 * Math.max(pk.v, 1.5)) { ok = false; break; }
        var steps = Math.ceil(dist), minD = Infinity;
        for (var t = 1; t < steps; t++) {
          var sxp = Math.round(pk.x + ex * t / steps), syp = Math.round(pk.y + ey * t / steps);
          var dv2 = d[syp * w + sxp];
          if (dv2 < minD) minD = dv2;
        }
        if (minD > 0.72 * Math.min(pk.v, q.v)) ok = false;
      }
      if (ok) kept.push(pk);
    }

    var nArea = comp.area / singleArea, n;
    if (forcedN) {
      n = forcedN;
      // Ưu tiên các đỉnh cách nhau xa: bỏ đỉnh thừa yếu nhất nếu nhiều hơn số vật.
    } else if (mode === 'area') {
      n = Math.max(1, Math.round(nArea));
    } else if (mode === 'shape' || !uniform) {
      n = Math.max(1, kept.length);
    } else {
      var lo = nArea >= 2.5 ? Math.floor(nArea * 0.65) : 1;
      var hi = Math.max(lo, Math.ceil(nArea * 1.35));
      n = kept.length ? Math.min(hi, Math.max(lo, kept.length)) : Math.max(1, Math.round(nArea));
    }

    var marks = kept.slice(0, n).map(function (p) { return { x: p.x + bx, y: p.y + by }; });
    // Thiếu điểm → đặt thêm tại điểm trong vùng xa các điểm đã có nhất.
    if (marks.length < n) {
      var pts = [], step = Math.max(1, Math.round(rS / 4));
      for (y = 0; y < h; y += step) {
        for (x = 0; x < w; x += step) {
          if (m[y * w + x] && d[y * w + x] >= 1) pts.push({ x: x + bx, y: y + by });
        }
      }
      if (!marks.length && pts.length) marks.push({ x: comp.cx, y: comp.cy });
      while (marks.length < n && pts.length) {
        var bestP = null, bestD = -1;
        for (i = 0; i < pts.length; i++) {
          var md = Infinity;
          for (k = 0; k < marks.length; k++) {
            var fx = marks[k].x - pts[i].x, fy = marks[k].y - pts[i].y, dd = fx * fx + fy * fy;
            if (dd < md) md = dd;
          }
          if (md > bestD) { bestD = md; bestP = pts[i]; }
        }
        marks.push({ x: bestP.x, y: bestP.y });
      }
    }
    // Số vật đã biết (từ lượng vật) → tinh chỉnh vị trí dấu: k-means có trọng số theo độ tối của vật,
    // để mỗi dấu nằm giữa một hạt (khe trống giữa các hạt có trọng số ≈ 0 nên không kéo dấu ra đó).
    if (forcedN && marks.length > 1) {
      var P = [], Wt = [], st = comp.area > 6000 ? 2 : 1;
      for (y = 0; y < h; y += st) for (x = 0; x < w; x += st) {
        if (!m[y * w + x]) continue;
        var gx = x + bx, gy = y + by, wv = dens ? dens[gy * W + gx] : 1;
        if (wv > 0.02) { P.push(gx, gy); Wt.push(wv); }
      }
      var K = marks.length, NP = Wt.length, asg = new Int32Array(NP), it2, j2;
      if (NP > K) {
        for (it2 = 0; it2 < 12; it2++) {
          var sx = new Float64Array(K), sy = new Float64Array(K), sw = new Float64Array(K);
          for (j2 = 0; j2 < NP; j2++) {
            var px = P[2 * j2], py = P[2 * j2 + 1], bk = 0, bd = Infinity;
            for (k = 0; k < K; k++) { var ddx = marks[k].x - px, ddy = marks[k].y - py, dq = ddx * ddx + ddy * ddy; if (dq < bd) { bd = dq; bk = k; } }
            asg[j2] = bk; sx[bk] += px * Wt[j2]; sy[bk] += py * Wt[j2]; sw[bk] += Wt[j2];
          }
          for (k = 0; k < K; k++) if (sw[k] > 0) { marks[k].x = sx[k] / sw[k]; marks[k].y = sy[k] / sw[k]; }
        }
        // Kéo dấu về điểm tối gần nhất trên thân vật thuộc nhóm của nó.
        var mx2 = new Float64Array(K);
        for (j2 = 0; j2 < NP; j2++) if (Wt[j2] > mx2[asg[j2]]) mx2[asg[j2]] = Wt[j2];
        for (k = 0; k < K; k++) {
          var best2 = -1, bd2 = Infinity;
          for (j2 = 0; j2 < NP; j2++) {
            if (asg[j2] !== k || Wt[j2] < 0.5 * mx2[k]) continue;
            var ex2 = P[2 * j2] - marks[k].x, ey2 = P[2 * j2 + 1] - marks[k].y, dd4 = ex2 * ex2 + ey2 * ey2;
            if (dd4 < bd2) { bd2 = dd4; best2 = j2; }
          }
          if (best2 >= 0 && bd2 > 1) { marks[k].x = P[2 * best2]; marks[k].y = P[2 * best2 + 1]; }
        }
      }
    }
    return marks;
  }

  var COLOR_MODES = { black: 1, red: 1, green: 1, blue: 1 };

  /**
   * Tìm tấm nền màu (đen/đỏ/xanh lá/xanh dương): điểm có màu trội của nền, vùng lớn nhất,
   * lấy bao lồi rồi co mép. Trả về null nếu không thấy.
   */
  function findBoard(rgba, w, h, color) {
    var n = w * h, score = new Uint8Array(n), hist = new Float64Array(256), i;
    var ci = color === 'red' ? 0 : color === 'green' ? 1 : 2;
    for (i = 0; i < n; i++) {
      var j = i * 4, R = rgba[j], G = rgba[j + 1], B = rgba[j + 2], v;
      if (color === 'black') {
        var mx = R > G ? (R > B ? R : B) : (G > B ? G : B);
        v = 255 - mx;                                  // càng tối càng giống nền đen
      } else {
        var c = rgba[j + ci], o1 = rgba[j + (ci + 1) % 3], o2 = rgba[j + (ci + 2) % 3];
        v = c - (o1 > o2 ? o1 : o2);                    // độ trội của kênh màu nền
        v = v < 0 ? 0 : v;
      }
      score[i] = v; hist[v]++;
    }
    var t = otsu(hist, n);
    var hiSum = 0, hiCnt = 0;
    for (i = t + 1; i < 256; i++) { hiSum += i * hist[i]; hiCnt += hist[i]; }
    if (!hiCnt || hiSum / hiCnt < (color === 'black' ? 150 : 45)) return null;
    var bin = new Uint8Array(n);
    for (i = 0; i < n; i++) bin[i] = score[i] > t ? 1 : 0;
    return regionFromBinary(bin, w, h, 0.04);
  }

  // Vùng lớn nhất của ảnh nhị phân → bao lồi → mặt nạ đã co mép. Dùng chung cho light pad và nền màu.
  function regionFromBinary(bin, w, h, minFrac) {
    var n = w * h, x, y, k;
    var L = label(bin, w, h, 1, true), best = null;
    L.comps.forEach(function (cp) { if (!best || cp.area > best.area) best = cp; });
    if (!best || best.area < minFrac * n) return null;
    var pts = [];
    for (y = best.y0; y <= best.y1; y++) {
      var lo = -1, hi = -1, row = y * w;
      for (x = best.x0; x <= best.x1; x++) if (L.lab[row + x] === best.id) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) { pts.push([lo, y]); if (hi !== lo) pts.push([hi, y]); }
    }
    pts.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    var cross = function (o, a2, b2) { return (a2[0] - o[0]) * (b2[1] - o[1]) - (a2[1] - o[1]) * (b2[0] - o[0]); };
    var lower = [], upper = [];
    for (k = 0; k < pts.length; k++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[k]) <= 0) lower.pop();
      lower.push(pts[k]);
    }
    for (k = pts.length - 1; k >= 0; k--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[k]) <= 0) upper.pop();
      upper.push(pts[k]);
    }
    lower.pop(); upper.pop();
    var hull = lower.concat(upper);
    if (hull.length < 3) return null;
    var mask = new Uint8Array(n), m = hull.length;
    for (y = 0; y < h; y++) {
      var yc = y + 0.5, xl = Infinity, xr = -Infinity;
      for (k = 0; k < m; k++) {
        var p1 = hull[k], p2 = hull[(k + 1) % m];
        if ((p1[1] <= yc && p2[1] > yc) || (p2[1] <= yc && p1[1] > yc)) {
          var xi = p1[0] + (yc - p1[1]) / (p2[1] - p1[1]) * (p2[0] - p1[0]);
          if (xi < xl) xl = xi; if (xi > xr) xr = xi;
        }
      }
      if (xl > xr) continue;
      var a0 = Math.max(0, Math.ceil(xl)), a1 = Math.min(w - 1, Math.floor(xr));
      for (x = a0; x <= a1; x++) mask[y * w + x] = 1;
    }
    var shrink = Math.max(3, Math.round(Math.min(w, h) * 0.012));
    for (k = 0; k < shrink; k++) mask = erode(mask, w, h);
    return { mask: mask, hull: hull };
  }

  // Nền ước lượng = mặt cong đa thức trên điểm nền + hiệu chỉnh cục bộ phần dư.
  function estimateBg(ch, bgMask, w, h, r) {
    var n = w * h, P = polyFit(ch, bgMask, w, h), i;
    if (!P) return maskedMean(ch, bgMask, w, h, r);
    var resid = new Float32Array(n);
    for (i = 0; i < n; i++) resid[i] = ch[i] - P[i];
    var corr = maskedMean(resid, bgMask, w, h, r), bg = new Float32Array(n);
    for (i = 0; i < n; i++) bg[i] = P[i] + corr[i];
    return bg;
  }

  function madOf(vals, mask, n, nm) {
    var ah = new Float64Array(256), i, acc = 0;
    for (i = 0; i < n; i++) if (!mask || mask[i]) ah[vals[i]]++;
    for (i = 0; i < 256; i++) { acc += ah[i]; if (acc >= nm / 2) return i; }
    return 0;
  }

  // Độ chênh theo độ sáng (light pad / không nền): trả về diff 0..255 và chiều sáng-tối của vật.
  function grayDiff(rgba, w, h, mask, nm, r, opts) {
    var n = w * h, i, gray = toGray(rgba, n), ones = new Uint8Array(n); ones.fill(1);
    var bg0 = polyFit(gray, mask, w, h) || maskedMean(gray, mask || ones, w, h, r);
    var dev = new Int16Array(n), ad = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var d = Math.round(gray[i] - bg0[i]);
      d = d < -255 ? -255 : d > 255 ? 255 : d;
      dev[i] = d; ad[i] = d < 0 ? -d : d;
    }
    var T0 = Math.max(6, 4 * madOf(ad, mask, n, nm)), darkOut = 0, lightOut = 0;
    for (i = 0; i < n; i++) {
      if (mask && !mask[i]) continue;
      if (dev[i] < -T0) darkOut++; else if (dev[i] > T0) lightOut++;
    }
    var polarity = opts.polarity === 'dark' || opts.polarity === 'light' ? opts.polarity
      : (darkOut >= lightOut ? 'dark' : 'light');
    var dark = polarity === 'dark';
    var obj0 = new Uint8Array(n);
    for (i = 0; i < n; i++) obj0[i] = dark ? (dev[i] < -T0 ? 1 : 0) : (dev[i] > T0 ? 1 : 0);
    obj0 = dilate(obj0, w, h);
    var bgMask = new Uint8Array(n);
    for (i = 0; i < n; i++) bgMask[i] = obj0[i] || (mask && !mask[i]) ? 0 : 1;
    var bg = estimateBg(gray, bgMask, w, h, r), diff = new Uint8Array(n), dens = new Float32Array(n);
    for (i = 0; i < n; i++) {
      if (mask && !mask[i]) continue;
      var dv = dark ? bg[i] - gray[i] : gray[i] - bg[i];
      diff[i] = dv < 0 ? 0 : dv > 255 ? 255 : dv | 0;
      // "Độ cản sáng" (mật độ quang): vật hơi trong chồng lên nhau thì cộng dồn → đếm được cả chỗ gác chéo.
      if (dark) {
        var od = Math.log(Math.max(8, bg[i]) / Math.max(1, gray[i]));
        dens[i] = od < 0 ? 0 : od > 3.2 ? 3.2 : od;
      } else dens[i] = 1;
    }
    return { diff: diff, polarity: polarity, dens: dens };
  }

  // Độ chênh theo MÀU (nền đen/đỏ/xanh lá/xanh dương): khoảng cách màu tới nền ước lượng từng kênh.
  // Vật sáng hơn, tối hơn hay khác sắc đều nổi lên như nhau.
  function colorDiff(rgba, w, h, mask, nm, r) {
    var n = w * h, i, c, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (i = 0; i < n; i++) { var j = i * 4; ch[0][i] = rgba[j]; ch[1][i] = rgba[j + 1]; ch[2][i] = rgba[j + 2]; }
    var ones = new Uint8Array(n); ones.fill(1);
    var b0 = ch.map(function (x) { return polyFit(x, mask, w, h) || maskedMean(x, mask || ones, w, h, r); });
    var d0 = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var e0 = ch[0][i] - b0[0][i], e1 = ch[1][i] - b0[1][i], e2 = ch[2][i] - b0[2][i];
      var dd = Math.sqrt(e0 * e0 + e1 * e1 + e2 * e2);
      d0[i] = dd > 255 ? 255 : dd | 0;
    }
    var T0 = Math.max(8, 4 * madOf(d0, mask, n, nm)), obj0 = new Uint8Array(n);
    for (i = 0; i < n; i++) obj0[i] = d0[i] > T0 ? 1 : 0;
    obj0 = dilate(obj0, w, h);
    var bgMask = new Uint8Array(n);
    for (i = 0; i < n; i++) bgMask[i] = obj0[i] || (mask && !mask[i]) ? 0 : 1;
    var bg = ch.map(function (x) { return estimateBg(x, bgMask, w, h, r); }), diff = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      if (mask && !mask[i]) continue;
      var s = 0;
      for (c = 0; c < 3; c++) { var e = ch[c][i] - bg[c][i]; s += e * e; }
      s = Math.sqrt(s);
      diff[i] = s > 255 ? 255 : s | 0;
    }
    // Nền màu (chiếu từ trên, vật đục): "lượng vật" = diện tích; độ khác màu phụ thuộc màu vật nên không dùng.
    return { diff: diff, polarity: 'color', dens: null };
  }

  /**
   * opts:
   *  background: 'pad' (light pad trắng) | 'black' | 'red' | 'green' | 'blue' | 'none'
   *              (bỏ trống: dùng autoPad như bản cũ)
   *  region: true = chỉ đếm trong vùng nền tự nhận (mặc định true)
   *  polarity: 'auto' | 'dark' | 'light' (chỉ dùng cho pad / none)
   *  sensitivity: -50..50 · minArea: px (0 = tự động) · fillHoles · split: 'auto'|'shape'|'area'|'off'
   *  denoise · mixedSizes
   *  classify: true = đếm theo chủng loại · types: 0 = tự đoán số loại, 2..6 = cố định
   */
  function detect(rgba, w, h, opts) {
    opts = opts || {};
    var t0 = Date.now(), n = w * h, i;
    var mode = opts.background || (opts.autoPad ? 'pad' : 'none');
    var useRegion = opts.region !== false && (opts.background ? true : !!opts.autoPad);

    // 0) Vùng đếm: nền trắng của light pad / tấm nền màu (nếu tìm thấy), ngược lại cả ảnh.
    var region = null;
    if (mode === 'auto') {
      // Tự nhận nền: ưu tiên light pad trắng; không có thì chọn tấm nền màu chiếm vùng lớn nhất.
      region = findPad(rgba, w, h);
      if (region) mode = 'pad';
      else {
        var bestA = 0;
        ['black', 'red', 'green', 'blue'].forEach(function (cname) {
          var rg = findBoard(rgba, w, h, cname);
          if (!rg) return;
          var a = 0; for (var q = 0; q < n; q++) a += rg.mask[q];
          if (a > bestA) { bestA = a; region = rg; mode = cname; }
        });
        if (!region) mode = 'none';
      }
      if (!useRegion) region = null;
    } else if (useRegion && mode === 'pad') region = findPad(rgba, w, h);
    else if (useRegion && COLOR_MODES[mode]) region = findBoard(rgba, w, h, mode);
    var mask = region ? region.mask : null;
    var nm = n;
    if (mask) { nm = 0; for (i = 0; i < n; i++) nm += mask[i]; }

    // 1–3) Ảnh độ chênh so với nền.
    var r = Math.max(8, Math.round(Math.max(w, h) / 12));
    var D = COLOR_MODES[mode] ? colorDiff(rgba, w, h, mask, nm, r) : grayDiff(rgba, w, h, mask, nm, r, opts);
    var diff = D.diff, polarity = D.polarity, dh = new Float64Array(256);
    for (i = 0; i < n; i++) if (!mask || mask[i]) dh[diff[i]]++;
    var t2 = otsu(dh, nm);
    // Mức nhiễu nền ≈ trung vị độ chênh (đa số điểm là nền).
    var acc = 0, medDiff = 0;
    for (i = 0; i < 256; i++) { acc += dh[i]; if (acc >= nm / 2) { medDiff = i; break; } }
    var s = Math.max(-50, Math.min(50, opts.sensitivity || 0));
    var thr = Math.max(0.5 * t2, 3 * medDiff + (COLOR_MODES[mode] ? 8 : 5)) * (1 - s / 100);
    thr = Math.max(4, thr);
    var bin = new Uint8Array(n), fgCount = 0;
    for (i = 0; i < n; i++) if (diff[i] > thr && (!mask || mask[i])) { bin[i] = 1; fgCount++; }

    // 4) Làm sạch: đóng (nối khe nhỏ, giữ viền mảnh của đá trong). Bụi nhỏ bị lọc theo diện tích ở bước 6.
    if (opts.denoise !== false) {
      bin = erode(dilate(bin, w, h), w, h);
    }
    // Bỏ dải sát mép ảnh: mép khung cắt từ video/ảnh hay bị tối hoặc nhoè 1–2 px
    // (nhất là Safari) và sẽ bị hiểu nhầm thành hàng trăm vật nhỏ.
    var band = Math.max(3, Math.round(Math.min(w, h) * 0.006));
    for (var by0 = 0; by0 < h; by0++) {
      var rowEdge = by0 < band || by0 >= h - band;
      for (var bx0 = 0; bx0 < w; bx0++) {
        if (rowEdge || bx0 < band || bx0 >= w - band) bin[by0 * w + bx0] = 0;
      }
    }
    if (mask) for (i = 0; i < n; i++) if (!mask[i]) bin[i] = 0;

    // 5) Lấp lỗ bên trong vật (đá trong suốt soi đèn nền chỉ hiện viền).
    if (opts.fillHoles !== false) {
      var holes = label(bin, w, h, 0, false);
      var holeArea = new Int32Array(holes.comps.length + 1);
      holes.comps.forEach(function (c) { holeArea[c.id] = c.border ? -1 : c.area; });
      var all = new Uint8Array(n);
      for (i = 0; i < n; i++) all[i] = bin[i] || holeArea[holes.lab[i]] > 0 ? 1 : 0;
      var pre = label(all, w, h, 1, true).comps.map(function (c) { return c.area; })
        .filter(function (a) { return a >= 6; });
      var holeMax = 1.5 * median(pre);
      for (i = 0; i < n; i++) {
        if (!bin[i]) { var ha = holeArea[holes.lab[i]]; if (ha > 0 && ha <= holeMax) bin[i] = 1; }
      }
    }

    // 6) Gán nhãn, lọc nhiễu, ước lượng diện tích một vật đơn.
    var L = label(bin, w, h, 1, true);
    // Ngưỡng bụi tự động dựa trên trung vị THEO DIỆN TÍCH (cỡ vật chứa nửa số điểm ảnh),
    // nên hàng trăm chấm nhiễu li ti không kéo lệch được cỡ của vật thật.
    var areas = L.comps.map(function (c) { return c.area; }).filter(function (a) { return a >= 6; })
      .sort(function (p, q) { return p - q; });
    var totA = 0, cumA = 0, wMed = 0;
    for (i = 0; i < areas.length; i++) totA += areas[i];
    for (i = 0; i < areas.length; i++) { cumA += areas[i]; if (cumA >= totA / 2) { wMed = areas[i]; break; } }
    var minArea = opts.minArea > 0 ? opts.minArea : Math.max(6, Math.round(0.04 * wMed));
    var comps = L.comps.filter(function (c) { return c.area >= minArea; });
    var keep = new Int32Array(L.comps.length + 1);
    comps.forEach(function (c, idx) { keep[c.id] = idx + 1; });

    // 6b) "Lượng vật" của từng vùng. Hai thước đo:
    //  - độ cản sáng cộng dồn (đèn nền, vật hơi trong: chồng/gác chéo vẫn cộng đủ),
    //  - diện tích (vật đục, nền màu).
    // Máy chọn thước đo làm các vật đơn đều nhau nhất; vật dính song song, gác chéo vẫn đếm đúng.
    var dens = D.dens, ODS = new Float64Array(comps.length);
    if (dens) for (i = 0; i < n; i++) { var kq = keep[L.lab[i]]; if (kq) ODS[kq - 1] += dens[i]; }
    // Hình dạng từng vùng (độ thuôn, độ đặc kín) để phân biệt "cụm nhiều vật" với "vật đơn cỡ lớn".
    var MS = { n: new Float64Array(comps.length), x: new Float64Array(comps.length), y: new Float64Array(comps.length),
      xx: new Float64Array(comps.length), yy: new Float64Array(comps.length), xy: new Float64Array(comps.length) };
    for (i = 0; i < n; i++) {
      var km = keep[L.lab[i]]; if (!km) continue;
      var cm2 = km - 1, yq = (i / w) | 0, xq = i - yq * w;
      MS.n[cm2]++; MS.x[cm2] += xq; MS.y[cm2] += yq; MS.xx[cm2] += xq * xq; MS.yy[cm2] += yq * yq; MS.xy[cm2] += xq * yq;
    }
    var shapeE = [], shapeF = [];
    comps.forEach(function (c, ci) {
      var a = MS.n[ci] || 1, mx = MS.x[ci] / a, my = MS.y[ci] / a;
      var cxx = MS.xx[ci] / a - mx * mx + 1 / 12, cyy = MS.yy[ci] / a - my * my + 1 / 12, cxy = MS.xy[ci] / a - mx * my;
      var tr = cxx + cyy, det = Math.max(1e-6, cxx * cyy - cxy * cxy), disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      shapeE[ci] = Math.sqrt((tr / 2 + disc) / Math.max(1e-6, tr / 2 - disc));
      shapeF[ci] = a / (4 * Math.PI * Math.sqrt(det));
    });
    function evalMass(mass) {
      var R0 = { unit: 0, cv: 1, singleArea: 0, pop: false, intOk: false, ok: false };
      var lg = [];
      mass.forEach(function (v) { if (v > 0) lg.push(Math.log(v)); });
      if (lg.length < 4) return R0;
      var lo = Math.min.apply(null, lg), hi = Math.max.apply(null, lg), bins = 160, bw = 0.09;
      var pk;
      if (hi - lo < 1e-6) pk = Math.exp(lo);
      else {
        var kd = [], best = -1, bestX = lo, b, q;
        for (b = 0; b <= bins; b++) {
          var xg = lo + (hi - lo) * b / bins, dsum = 0;
          for (q = 0; q < lg.length; q++) { var z = (lg[q] - xg) / bw; if (z > -4 && z < 4) dsum += Math.exp(-0.5 * z * z); }
          kd.push(dsum);
          if (dsum > best) { best = dsum; bestX = xg; }
        }
        // Đơn vị = đỉnh NHỎ NHẤT (đủ cao) mà đa số vùng là bội số nguyên của nó (1, 2, 3… vật).
        pk = Math.exp(bestX);
        for (b = 0; b <= bins; b++) {
          var hgt = kd[b];
          if (hgt < 0.2 * best || (b > 0 && kd[b - 1] > hgt) || (b < bins && kd[b + 1] > hgt)) continue;
          var u = Math.exp(lo + (hi - lo) * b / bins), cn = 0, fit = 0, tot = 0;
          for (q = 0; q < lg.length; q++) {
            var rr = Math.exp(lg[q]) / u;
            if (rr > 0.75 && rr < 1.33) cn++;
            if (rr < 6.5) { tot++; var rk = Math.round(rr); if (rk >= 1 && Math.abs(rr - rk) <= 0.22) fit++; }
          }
          if (cn >= Math.max(3, 0.1 * lg.length) && tot && fit / tot >= 0.6) { pk = u; break; }
        }
      }
      var near = [], nearA = [];
      mass.forEach(function (v, ci) { if (v > 0.75 * pk && v < 1.33 * pk) { near.push(v); nearA.push(comps[ci].area); } });
      var unitV = median(near) || pk;
      R0.unit = unitV; R0.singleArea = median(nearA);
      var band = mass.filter(function (v) { return v > 0.6 * unitV && v < 1.6 * unitV; });
      if (band.length >= 4) {
        var md = median(band);
        R0.cv = 1.4826 * median(band.map(function (v) { return Math.abs(v - md); })) / md;
      }
      var nearUnit = 0, smallish = 0, multi = 0, multiFit = 0, cvU = Math.min(R0.cv, 0.25), gap = 0, low = 0;
      mass.forEach(function (v) {
        var r2 = v / unitV;
        if (r2 < 2.5) { low++; if (r2 > 1.3 && r2 < 1.7) gap++; }
        if (r2 < 1.6) { smallish++; if (r2 > 0.7 && r2 < 1.35) nearUnit++; }
        if (r2 >= 1.5 && r2 <= 6.5) {
          multi++;
          // Dung sai tăng theo độ chênh tự nhiên của vật đơn và số vật trong cụm (tổng k vật dao động √k lần).
          // Dung sai theo độ đều của vật đơn: vật đơn càng đều thì cụm thật càng phải sát số nguyên.
          var kk = Math.round(r2), tol = Math.min(0.33, Math.max(0.1, 2.5 * cvU * Math.sqrt(kk) + 0.06));
          if (Math.abs(r2 - kk) <= tol) multiFit++;
        }
      });
      R0.pop = nearUnit >= 4 && nearUnit >= 0.6 * smallish;
      // Vùng lớn phải ≈ bội số nguyên của đơn vị (đúng là cụm vật dính), không phải vật đơn cỡ khác.
      var relax = !!opts.prevMass; // khung trước đã nhận đồng cỡ → nới nhẹ để không nhảy qua lại
      R0.intOk = multi < 3 || multiFit >= (relax ? 0.45 : 0.55) * multi;
      // "Khoảng trống": vật đồng cỡ thì gần như không có vùng nào cỡ 1,3–1,7 đơn vị (1 vật thì không to vậy,
      // 2 vật thì không nhỏ vậy). Vật trộn hình dạng / cỡ sẽ lấp đầy khoảng này.
      R0.gapFrac = low ? gap / low : 0;
      // "Vật đơn phóng to": vùng ≥ 2 đơn vị mà hình dạng giống hệt vật đơn (cùng độ thuôn, cùng độ đặc)
      // → thực ra là vật đơn cỡ khác, không phải cụm dính.
      var refE = [], refF = [];
      mass.forEach(function (v, ci) { var r4 = v / unitV; if (r4 > 0.75 && r4 < 1.33) { refE.push(shapeE[ci]); refF.push(shapeF[ci]); } });
      var mE = median(refE) || 1, mF = median(refF) || 1, scaled = 0, multi2 = 0;
      mass.forEach(function (v, ci) {
        var r5 = v / unitV;
        if (r5 < 1.6 || r5 > 6.5) return;
        multi2++;
        if (Math.abs(Math.log(shapeE[ci] / mE)) < 0.12 && Math.abs(shapeF[ci] - mF) < 0.05) scaled++;
      });
      R0.scaledFrac = multi2 ? scaled / multi2 : 0;
      if (multi2 >= 3 && R0.scaledFrac >= 0.35) R0.intOk = false;
      R0.ok = R0.pop && R0.intOk && R0.cv <= (relax ? 0.2 : 0.18) && R0.gapFrac <= (relax ? 0.09 : 0.07);
      return R0;
    }
    var cands = [{ name: 'area', mass: comps.map(function (c) { return c.area; }) }];
    if (dens) cands.unshift({ name: 'od', mass: Array.prototype.slice.call(ODS) });
    var chosen = null;
    cands.forEach(function (cd) { cd.ev = evalMass(cd.mass); });
    // Ưu tiên độ cản sáng (đếm đúng cả chỗ gác chéo); chỉ dùng diện tích khi độ cản sáng không hợp lệ
    // hoặc kém đều rõ rệt (vật đục: mỗi viên tối một khác).
    var od = cands.filter(function (cd) { return cd.name === 'od'; })[0], ar = cands.filter(function (cd) { return cd.name === 'area'; })[0];
    if (od && od.ev.ok && (!ar.ev.ok || od.ev.cv <= ar.ev.cv + 0.05)) chosen = od;
    else if (ar.ev.ok) chosen = ar;
    else chosen = cands[0];
    var unit = chosen.ev.unit || 1, unitCV = chosen.ev.cv, integerOk = chosen.ev.intOk, uniformPop = chosen.ev.pop;
    comps.forEach(function (c, idx) { c.mass = chosen.mass[idx]; });
    var singleArea = chosen.ev.singleArea || median(comps.map(function (c) { return c.area; })) || 1;
    var rS = Math.sqrt(singleArea / Math.PI);
    var uniform = !opts.mixedSizes && chosen.ev.ok;
    var massKind = uniform ? chosen.name : 'shape';
    if (!uniform) {
      // Vật khác cỡ / khác hình: giữ cách cũ đã kiểm chứng (tách theo hình dạng, cỡ vật đơn = trung vị diện tích).
      var big = comps.map(function (c) { return c.area; }), m1 = median(big);
      singleArea = median(big.filter(function (a) { return a <= 1.8 * m1; })) || m1 || 1;
      rS = Math.sqrt(singleArea / Math.PI);
    }
    // Cho cách cũ: kiểm tra chéo theo diện tích khi cỡ khá đều (tỉ lệ phân vị 75/25).
    var sortedA = comps.map(function (c) { return c.area; }).sort(function (p, q) { return p - q; });
    var q25 = sortedA[Math.floor(sortedA.length * 0.25)] || 1, q75 = sortedA[Math.floor(sortedA.length * 0.75)] || 1;
    var areaUniform = !opts.mixedSizes && q75 / q25 < 2;

    // 7) Đếm + tách cụm.
    var split = opts.split || 'auto';
    var markers = [], clusterCount = 0, hugeCount = 0;
    comps.forEach(function (c, idx) {
      var nd = c.mass / unit, nMass = Math.max(1, Math.round(nd));
      c.cluster = false;
      if (split === 'off') { c.n = 1; markers.push({ x: c.cx, y: c.cy, c: idx, kind: 'single' }); return; }
      // Vùng quá lớn (thường do nền/ánh sáng sai): không tách, chỉ ước lượng + cảnh báo.
      if (c.area > 40 * singleArea) {
        c.n = nMass; c.cluster = true; c.huge = true; clusterCount++; hugeCount++;
        markers.push({ x: c.cx, y: c.cy, c: idx, kind: 'huge', w: c.n });
        return;
      }
      var forced = null;
      if (split === 'area' || (split === 'auto' && uniform)) forced = nMass;
      var isCluster = forced !== null ? forced > 1 : c.area > 1.5 * singleArea;
      if (!isCluster) {
        c.n = 1;
        markers.push({ x: c.cx, y: c.cy, c: idx, kind: 'single' });
        return;
      }
      var mk = splitComponent(L.lab, w, c, rS, singleArea, split === 'shape' ? 'shape' : 'auto', areaUniform, forced,
        massKind === 'od' ? dens : null);
      c.n = mk.length;
      if (c.n > 1) { c.cluster = true; clusterCount++; }
      mk.forEach(function (p) { markers.push({ x: p.x, y: p.y, c: idx, kind: c.n > 1 ? 'cluster' : 'single' }); });
    });

    // 8) Đếm theo chủng loại (tuỳ chọn).
    var types = opts.classify ? classify(rgba, L.lab, keep, comps, markers, w, opts.types || 0, !!COLOR_MODES[mode]) : null;

    return {
      width: w, height: h, polarity: polarity, threshold: thr,
      singleArea: singleArea, unit: unit, unitCV: unitCV, integerOk: integerOk, uniformPop: uniformPop, massKind: massKind, massEval: cands.map(function (cd) { return { name: cd.name, unit: cd.ev.unit, cv: cd.ev.cv, pop: cd.ev.pop, intOk: cd.ev.intOk, gap: cd.ev.gapFrac, scaled: cd.ev.scaledFrac, ok: cd.ev.ok }; }), radius: rS, minArea: minArea, uniform: uniform,
      comps: comps, markers: markers, clusterCount: clusterCount, hugeCount: hugeCount,
      count: markers.reduce(function (s2, mk) { return s2 + (mk.w || 1); }, 0),
      labels: L.lab, keep: keep, fgRatio: fgCount / Math.max(1, nm), ms: Date.now() - t0,
      background: mode, types: types,
      pad: region ? { hull: region.hull, area: nm, coverage: nm / n } : null
    };
  }

  // Tô lớp phủ: vật đơn = xanh, cụm đã tách = cam. Ghi đè lên rgba (ImageData.data).
  function paintOverlay(rgba, res, alpha) {
    var a = alpha == null ? 0.45 : alpha, lab = res.labels, keep = res.keep, comps = res.comps;
    for (var i = 0, j = 0; i < lab.length; i++, j += 4) {
      var k = keep[lab[i]];
      if (!k) continue;
      var cl = comps[k - 1].cluster;
      var R = cl ? 255 : 0, G = cl ? 140 : 170, B = cl ? 0 : 255;
      rgba[j] = rgba[j] * (1 - a) + R * a;
      rgba[j + 1] = rgba[j + 1] * (1 - a) + G * a;
      rgba[j + 2] = rgba[j + 2] * (1 - a) + B * a;
    }
  }

  return { detect: detect, paintOverlay: paintOverlay, _otsu: otsu, _median: median };
})();
if (typeof module !== 'undefined') module.exports = Counter;
