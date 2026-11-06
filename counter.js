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
  function splitComponent(lab, W, comp, rS, singleArea, mode, uniform) {
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
    if (mode === 'area') {
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
    return marks;
  }

  /**
   * opts:
   *  polarity: 'auto' | 'dark' (vật tối trên nền sáng) | 'light' (vật sáng trên nền tối)
   *  sensitivity: -50..50 (dương = nhạy hơn, bắt vật mờ)
   *  minArea: px, 0 = tự động
   *  fillHoles: true/false (đá trong suốt cho viền + lõi sáng)
   *  split: 'auto' | 'shape' | 'area' | 'off'
   *  denoise: true/false
   */
  function detect(rgba, w, h, opts) {
    opts = opts || {};
    var t0 = Date.now(), n = w * h, i;
    var gray = toGray(rgba, n);

    // 1) Nền thô = mặt cong đa thức khớp trên toàn ảnh (vật chỉ là thiểu số điểm ảnh).
    var r = Math.max(8, Math.round(Math.max(w, h) / 12));
    var ones = new Uint8Array(n); ones.fill(1);
    var bg0 = polyFit(gray, null, w, h) || maskedMean(gray, ones, w, h, r);
    var dev = new Int16Array(n), ah = new Float64Array(256);
    for (i = 0; i < n; i++) {
      var dd0 = Math.round(gray[i] - bg0[i]);
      dev[i] = dd0; ah[dd0 < 0 ? -dd0 : dd0]++;
    }
    var acc0 = 0, madAbs = 0;
    for (i = 0; i < 256; i++) { acc0 += ah[i]; if (acc0 >= n / 2) { madAbs = i; break; } }
    var T0 = Math.max(6, 4 * madAbs), darkOut = 0, lightOut = 0;
    for (i = 0; i < n; i++) { if (dev[i] < -T0) darkOut++; else if (dev[i] > T0) lightOut++; }

    // 2) Chiều của vật: phía nào có nhiều điểm lệch mạnh hơn.
    var polarity = opts.polarity === 'dark' || opts.polarity === 'light' ? opts.polarity
      : (darkOut >= lightOut ? 'dark' : 'light');
    var dark = polarity === 'dark';

    // 3) Nền tinh = trung bình cục bộ chỉ trên điểm nền (bỏ vật + viền) → không bị vật kéo lệch.
    var obj0 = new Uint8Array(n);
    for (i = 0; i < n; i++) obj0[i] = dark ? (dev[i] < -T0 ? 1 : 0) : (dev[i] > T0 ? 1 : 0);
    obj0 = dilate(obj0, w, h);
    var bgMask = new Uint8Array(n);
    for (i = 0; i < n; i++) bgMask[i] = obj0[i] ? 0 : 1;
    // Nền = mặt cong đa thức (chỉ trên điểm nền) + hiệu chỉnh cục bộ phần dư (vệt đèn, bóng mờ).
    var bgP = polyFit(gray, bgMask, w, h), bg;
    if (bgP) {
      var resid = new Float32Array(n);
      for (i = 0; i < n; i++) resid[i] = gray[i] - bgP[i];
      var corr = maskedMean(resid, bgMask, w, h, r);
      bg = new Float32Array(n);
      for (i = 0; i < n; i++) bg[i] = bgP[i] + corr[i];
    } else {
      bg = maskedMean(gray, bgMask, w, h, r);
    }

    // 3) Độ chênh với nền → Otsu lần 2.
    var diff = new Uint8Array(n), dh = new Float64Array(256);
    for (i = 0; i < n; i++) {
      var dv = dark ? bg[i] - gray[i] : gray[i] - bg[i];
      dv = dv < 0 ? 0 : dv > 255 ? 255 : dv | 0;
      diff[i] = dv; dh[dv]++;
    }
    var t2 = otsu(dh, n);
    // Mức nhiễu nền ≈ trung vị độ chênh (đa số điểm là nền).
    var acc = 0, medDiff = 0;
    for (i = 0; i < 256; i++) { acc += dh[i]; if (acc >= n / 2) { medDiff = i; break; } }
    var s = Math.max(-50, Math.min(50, opts.sensitivity || 0));
    var thr = Math.max(0.5 * t2, 3 * medDiff + 5) * (1 - s / 100);
    thr = Math.max(4, thr);
    var bin = new Uint8Array(n), fgCount = 0;
    for (i = 0; i < n; i++) if (diff[i] > thr) { bin[i] = 1; fgCount++; }

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
    var big = comps.map(function (c) { return c.area; });
    var m1 = median(big);
    var singleArea = median(big.filter(function (a) { return a <= 1.8 * m1; })) || m1 || 1;
    var rS = Math.sqrt(singleArea / Math.PI);
    // Kích thước đồng đều? (tỉ lệ phân vị 75/25 của diện tích nhỏ) → được phép dùng diện tích để kiểm tra chéo.
    var sorted = big.slice().sort(function (p, q) { return p - q; });
    var q25 = sorted[Math.floor(sorted.length * 0.25)] || 1, q75 = sorted[Math.floor(sorted.length * 0.75)] || 1;
    var uniform = opts.mixedSizes ? false : q75 / q25 < 2;

    // 7) Đếm + tách cụm.
    var split = opts.split || 'auto';
    var markers = [], clusterCount = 0, hugeCount = 0;
    comps.forEach(function (c, idx) {
      var isCluster = split !== 'off' && c.area > 1.5 * singleArea;
      c.cluster = false;
      // Vùng quá lớn (thường do nền/ánh sáng sai): không tách, chỉ ước lượng theo diện tích + cảnh báo.
      if (split !== 'off' && c.area > 40 * singleArea) {
        c.n = Math.max(1, Math.round(c.area / singleArea));
        c.cluster = true; c.huge = true; clusterCount++; hugeCount++;
        markers.push({ x: c.cx, y: c.cy, c: idx, kind: 'huge', w: c.n });
        return;
      }
      if (!isCluster) {
        c.n = 1;
        markers.push({ x: c.cx, y: c.cy, c: idx, kind: 'single' });
        return;
      }
      var mk = splitComponent(L.lab, w, c, rS, singleArea, split, uniform);
      c.n = mk.length;
      if (c.n > 1) { c.cluster = true; clusterCount++; }
      mk.forEach(function (p) { markers.push({ x: p.x, y: p.y, c: idx, kind: c.n > 1 ? 'cluster' : 'single' }); });
    });

    var keep = new Int32Array(L.comps.length + 1);
    comps.forEach(function (c, idx) { keep[c.id] = idx + 1; });

    return {
      width: w, height: h, polarity: polarity, threshold: thr,
      singleArea: singleArea, radius: rS, minArea: minArea, uniform: uniform,
      comps: comps, markers: markers, clusterCount: clusterCount, hugeCount: hugeCount,
      count: markers.reduce(function (s2, mk) { return s2 + (mk.w || 1); }, 0),
      labels: L.lab, keep: keep, fgRatio: fgCount / n, ms: Date.now() - t0
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
