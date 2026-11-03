/* ExpenseFlow — intro.js
   A short film about what this site does, made from the visitor's own numbers:
   1. Your money for the month sits there as one big number.
   2. Your real expenses scroll past and the number drains while the category bars fill.
   3. The number turns into the wallet (ASCII), glitches into the real photo, and the name slams in.
   4. The screen dissolves away in halftone dither onto whatever is underneath (the wallet gate, or the hero).
   About 5 seconds, plays once per browser session, skippable. ?nointro skips it, ?intro forces it.
   Reduced-motion visitors never see it. */
(function () {
  'use strict';

  var root = document.documentElement;
  var el = document.getElementById('intro');
  window.EF = window.EF || {};
  if (!el) { window.EF.Intro = { play: function () {} }; return; }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.getElementById('intro-canvas');
  var ctx = canvas.getContext('2d');
  var buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  var bufR = document.createElement('canvas'), rctx = bufR.getContext('2d');
  var bufC = document.createElement('canvas'), cctx = bufC.getContext('2d');
  var logEl = el.querySelector('.i-log'), countEl = el.querySelector('.i-count');
  var fillEl = el.querySelector('.i-fill'), skipBtn = el.querySelector('.i-skip');

  /* timeline (ms) */
  var T_DRAIN0 = 300, T_DRAIN1 = 1900;     // the number drains
  var T_ASCII0 = 1850, T_ASCII1 = 2900;    // number -> ASCII wallet
  var T_GL0 = 2700, T_GL1 = 3500;          // glitch, ASCII -> real photo
  var T_TITLE = 3050;                      // EXPENSEFLOW slams in
  var T_END = 4200;                        // dissolve into the site
  var DISSOLVE = 1000;

  var BG = '#0d0e10', BONE = '#e8e5df', STEEL = '#9a9ea6', RED = '#ef4036';
  var RAMP = ['.', ':', '-', '=', '+', '*', '#', '@'];
  var LEVEL_COLORS = ['#552a19', '#7a3a22', '#a04c2a', '#c46234', '#e07b42', '#f19a60', '#f8c394', '#fdeedd'];

  var W = 0, H = 0, dpr = 1, S = 0, cx = 0, cy = 0, ac = 8, narrow = false, pad = 40;
  var running = false, ending = false, t0 = 0, raf = 0, microUntil = 0, nextMicro = 0, safety = 0;
  var closedImg = null, imgReady = false, loadedCount = 0, allLoaded = false, gray = null;
  var levels = [], titleSize = 0, D = null, lines = [];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeIO(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function hash(i, seed) { var x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); }
  function money(n) { return (window.EF && EF.Store) ? EF.Store.fmt(n, { whole: true }) : String(Math.round(n)); }

  /* ---------- the visitor's own numbers ---------- */
  function buildDrain() {
    var out = null;
    try {
      var St = EF.Store, st = St.state, ym = St.currentYM(), m = St.monthStats(ym), i;
      for (i = 1; i <= 3 && !(m.spent > 0); i++) { ym = St.shiftYM(St.currentYM(), -i); m = St.monthStats(ym); }
      if (m.spent > 0) {
        var ids = {}; st.accounts.forEach(function (a) { if (a.counted) ids[a.id] = 1; });
        var rows = st.transactions.filter(function (t) { return t.type === 'expense' && t.date.slice(0, 7) === ym && ids[t.accountId]; })
          .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        if (rows.length > 26) { var pick = [], step = rows.length / 26; for (i = 0; i < 26; i++) pick.push(rows[Math.floor(i * step)]); rows = pick; }
        out = {
          label: St.monthLabel(ym).split(' ')[0].toUpperCase(),
          income: m.income > 0 ? m.income : m.spent * 1.6, spent: m.spent,
          rows: rows.map(function (t) { return { desc: t.description, amt: t.amount, cat: t.category, date: t.date.slice(8) + '/' + t.date.slice(5, 7) }; }),
          cats: m.cats.slice(0, 5), accounts: st.accounts.length, entries: st.transactions.length
        };
      }
    } catch (e) {}
    if (!out) { // nothing logged yet: show a believable sample
      var s = [['Rent', 'Housing', 32000], ['Groceries', 'Food', 6400], ['Electricity', 'Bills', 2100], ['Cab', 'Transport', 850], ['Dinner out', 'Food', 2300], ['Streaming', 'Fun', 649], ['Shopping', 'Shopping', 4800], ['Pharmacy', 'Health', 540]];
      var tot = {}, spent = 0;
      s.forEach(function (r) { tot[r[1]] = (tot[r[1]] || 0) + r[2]; spent += r[2]; });
      out = {
        label: 'THIS MONTH', income: 90000, spent: spent, accounts: 2, entries: 0,
        rows: s.map(function (r, i) { return { desc: r[0], amt: r[2], cat: r[1], date: ('0' + (i * 3 + 1)).slice(-2) + '/00' }; }),
        cats: Object.keys(tot).map(function (k) { return { name: k, total: tot[k] }; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 5)
      };
    }
    var sum = 0; out.rows.forEach(function (r) { sum += r.amt; });
    var acc = 0; out.rows.forEach(function (r) { r.start = acc / sum; acc += r.amt; r.end = acc / sum; });
    return out;
  }

  function logLines() {
    var a = D.accounts, e = D.entries;
    return [
      { at: 60, text: 'EXPENSEFLOW // BOOT 2.0' },
      { at: 360, text: '> reading ' + a + (a === 1 ? ' account' : ' accounts') + ' ........ ok' },
      { at: 800, text: '> pulling ' + (e ? e + ' entries' : 'your entries') + ' ........ ok' },
      { at: 1250, text: '> adding up ' + D.label.toLowerCase() + ' ........ ok' },
      { at: 1900, text: '> asking where it went ..... ?' }
    ];
  }
  function renderLog(t) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (t < l.at) break;
      out.push(l.text.slice(0, Math.min(l.text.length, Math.floor((t - l.at) / 16))));
    }
    logEl.textContent = out.join('\n');
  }

  /* ---------- layout ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    [canvas, buf, bufR, bufC].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
    narrow = W < 760;
    pad = Math.max(20, Math.min(64, W * 0.042));
    var walletW = narrow ? W * 0.86 : clamp(W * 0.54, 360, 800);
    S = walletW / 0.78; cx = W / 2; cy = H * (narrow ? 0.34 : 0.43);   // same geometry as the hero
    ac = narrow ? 5 : Math.max(6, Math.round(S / 130));
    titleSize = 0;
    if (imgReady && closedImg) buildAscii();
  }

  /* ---------- assets ---------- */
  function feather(c) {
    var x = c.getContext('2d'), e = c.width * 0.07, g;
    x.globalCompositeOperation = 'destination-in';
    g = x.createLinearGradient(0, 0, c.width, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(e / c.width, '#000'); g.addColorStop(1 - e / c.width, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(e / c.height, '#000'); g.addColorStop(1 - e / c.height, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-over';
  }

  function buildAscii() {
    var n = Math.round(S / ac);
    var off = document.createElement('canvas'); off.width = off.height = n;
    var o = off.getContext('2d');
    o.drawImage(closedImg, 0, 0, n, n);
    var d = o.getImageData(0, 0, n, n).data;
    var x0 = cx - S / 2, y0 = cy - S / 2;
    var tmp = RAMP.map(function () { return []; });
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var k = (j * n + i) * 4;
        var lum = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
        if (lum < 0.1) continue;
        lum = Math.pow(lum, 0.72);
        tmp[Math.min(7, Math.floor(lum * 8))].push({ x: x0 + i * ac, y: y0 + (j + 1) * ac, r: hash(j * n + i, 5) });
      }
    }
    levels = tmp.map(function (arr) {
      var xs = new Float32Array(arr.length), ys = new Float32Array(arr.length), rs = new Float32Array(arr.length);
      arr.forEach(function (c, m) { xs[m] = c.x; ys[m] = c.y; rs[m] = c.r; });
      return { xs: xs, ys: ys, rs: rs };
    });
    gray = document.createElement('canvas'); gray.width = gray.height = 720;
    var g = gray.getContext('2d');
    g.drawImage(closedImg, 0, 0, 720, 720);
    g.globalCompositeOperation = 'saturation'; g.fillStyle = '#808080'; g.fillRect(0, 0, 720, 720);
    g.globalCompositeOperation = 'source-over';
    feather(gray);
  }

  function loadImages() {
    imgReady = false; closedImg = null; loadedCount = 0; allLoaded = false;
    ['closed', 'open_cash', 'open_empty'].forEach(function (name, idx) {
      var im = new Image();
      var done = function () { if (++loadedCount === 3) allLoaded = true; };
      im.onload = function () { if (idx === 0) { closedImg = im; imgReady = true; try { buildAscii(); } catch (e) {} } done(); };
      im.onerror = function () { if (idx === 0) imgReady = true; done(); };
      im.src = 'assets/frames/' + name + '.jpg';
    });
  }

  /* ---------- scene 1: the money drains ---------- */
  function drawDrain(t, alpha) {
    if (alpha <= 0.01 || !D) return;
    var p = easeIO(clamp((t - T_DRAIN0) / (T_DRAIN1 - T_DRAIN0), 0, 1));
    var rows = D.rows, idx = 0, i;
    for (i = 0; i < rows.length; i++) if (rows[i].start <= p) idx = i + 1;
    var cur = rows[Math.max(0, idx - 1)];
    var frac = idx ? clamp((p - cur.start) / Math.max(0.0001, cur.end - cur.start), 0, 1) : 0;
    var hit = p > 0 && p < 1 && frac < 0.16;

    bctx.save();
    bctx.globalAlpha = alpha;
    bctx.textBaseline = 'alphabetic';

    // the big number
    var fs = narrow ? Math.min(W * 0.2, 96) : Math.min(W * 0.17, H * 0.34);
    var nx = pad, ny = narrow ? H * 0.2 : H * 0.5;
    bctx.font = '500 ' + (narrow ? 11 : 12) + 'px "DM Mono", ui-monospace, monospace';
    bctx.fillStyle = STEEL;
    bctx.fillText('MONEY IN, ' + D.label, nx, ny - fs * 0.86);
    bctx.font = '900 ' + fs + 'px "Big Shoulders Display", Impact, sans-serif';
    var val = D.income - D.spent * p;
    var jx = hit ? (Math.random() - 0.5) * 6 : 0;
    if (hit) { bctx.fillStyle = 'rgba(239,64,54,.9)'; bctx.fillText(money(val), nx + 5, ny); }
    bctx.fillStyle = hit ? '#f6d2cf' : BONE;
    bctx.fillText(money(val), nx + jx, ny);
    bctx.font = '500 ' + (narrow ? 12 : 14) + 'px "DM Mono", ui-monospace, monospace';
    bctx.fillStyle = RED;
    bctx.fillText('\u2212' + money(D.spent * p) + ' spent', nx, ny + (narrow ? 22 : 30));

    // the ticker of real expenses
    var K = narrow ? 6 : 9, lh = narrow ? 20 : 24;
    var tw = narrow ? W - pad * 2 : Math.min(400, W * 0.3);
    var tx = narrow ? pad : W - pad - tw;
    var tyBottom = narrow ? H * 0.36 + K * lh : H * 0.5 + (K * lh) / 2 - 8;
    bctx.font = '400 ' + (narrow ? 11 : 13) + 'px "DM Mono", ui-monospace, monospace';
    var slide = idx ? (1 - easeIO(clamp(frac * 5, 0, 1))) * lh : 0;
    for (i = 0; i < K; i++) {
      var ri = idx - 1 - i;
      if (ri < 0) break;
      var r = rows[ri], y = tyBottom - i * lh + slide;
      bctx.globalAlpha = alpha * (1 - i / (K + 0.5)) * (i === 0 ? 1 : 0.85);
      bctx.fillStyle = i === 0 ? BONE : STEEL;
      var d = r.desc.length > 20 ? r.desc.slice(0, 19) + '\u2026' : r.desc;
      bctx.textAlign = 'left'; bctx.fillText(r.date + '  ' + d, tx, y);
      bctx.textAlign = 'right'; bctx.fillStyle = i === 0 ? RED : STEEL;
      bctx.fillText('\u2212' + money(r.amt), tx + tw, y);
    }
    bctx.textAlign = 'left';
    bctx.globalAlpha = alpha;

    // category dot bars filling up (the same halftone bars as the site)
    var by = narrow ? H * 0.58 : H * 0.74, bl = narrow ? 22 : 28;
    var bx = pad + (narrow ? 84 : 110), bw = narrow ? W - bx - pad : Math.min(W * 0.42, 440);
    var maxT = D.cats.length ? D.cats[0].total : 1;
    bctx.font = '400 ' + (narrow ? 11 : 12) + 'px "DM Mono", ui-monospace, monospace';
    D.cats.forEach(function (c, ci) {
      var y = by + ci * bl;
      bctx.fillStyle = ci === 0 ? RED : BONE;
      bctx.globalAlpha = alpha * 0.9;
      bctx.fillText(c.name.length > 10 ? c.name.slice(0, 9) + '.' : c.name, pad, y + 4);
      var len = bw * (c.total / maxT) * p, dots = Math.floor(len / 7);
      for (var q = 0; q < dots; q++) bctx.fillRect(bx + q * 7, y - 3, 4, 4);
    });
    bctx.restore();
  }

  /* ---------- scene 2: the wallet ---------- */
  function randRamp() { return RAMP[(Math.random() * RAMP.length) | 0]; }

  function drawAscii(reveal, alpha) {
    if (!levels.length || alpha <= 0.01 || reveal <= 0) return;
    bctx.font = '500 ' + (ac + 1) + 'px "DM Mono", ui-monospace, monospace';
    bctx.textBaseline = 'alphabetic';
    bctx.globalAlpha = alpha;
    for (var L = 0; L < levels.length; L++) {
      var lv = levels[L];
      bctx.fillStyle = LEVEL_COLORS[L];
      var ch = RAMP[L];
      for (var m = 0; m < lv.rs.length; m++) {
        var r = lv.rs[m];
        if (r > reveal) continue;
        bctx.fillText(r > reveal - 0.07 ? randRamp() : ch, lv.xs[m], lv.ys[m]);
      }
    }
    bctx.globalAlpha = 1;
  }

  function drawPhoto(alpha) {
    if (!gray || alpha <= 0.01) return;
    bctx.globalAlpha = alpha;
    bctx.drawImage(gray, cx - S / 2, cy - S / 2, S, S);
    bctx.globalAlpha = 1;
  }

  function drawTitle(t) {
    if (t < T_TITLE) return;
    var u = clamp((t - T_TITLE) / 240, 0, 1), e = 1 - Math.pow(1 - u, 3);
    var txt = 'EXPENSEFLOW';
    if (!titleSize) {
      bctx.font = '900 100px "Big Shoulders Display", Impact, sans-serif';
      titleSize = Math.min(100 * (W * 0.9) / bctx.measureText(txt).width, H * 0.5);
    }
    var jit = t < T_TITLE + 420 ? (Math.random() - 0.5) * 14 : 0;
    var sc = 1 + (1 - e) * 0.5;
    bctx.save();
    bctx.translate(W / 2, H * 0.5);
    bctx.scale(sc, sc);
    bctx.font = '900 ' + titleSize + 'px "Big Shoulders Display", Impact, sans-serif';
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
    bctx.globalAlpha = e;
    bctx.globalCompositeOperation = 'lighter';
    bctx.fillStyle = 'rgba(239,64,54,.85)'; bctx.fillText(txt, -7 + jit, 0);
    bctx.fillStyle = 'rgba(80,230,255,.7)'; bctx.fillText(txt, 7 - jit, 0);
    bctx.globalCompositeOperation = 'source-over';
    bctx.fillStyle = BONE; bctx.fillText(txt, 0, 0);
    bctx.restore();
    bctx.globalAlpha = 1;
    if (t > T_TITLE + 350) {
      bctx.save();
      bctx.font = '500 ' + (narrow ? 12 : 15) + 'px "DM Mono", ui-monospace, monospace';
      bctx.textAlign = 'center'; bctx.fillStyle = RED;
      var q = 'where did it go?', n = Math.min(q.length, Math.floor((t - T_TITLE - 350) / 28));
      bctx.fillText(q.slice(0, n) + (n < q.length ? '_' : ''), W / 2, H * 0.5 + titleSize * 0.52);
      bctx.restore();
    }
  }

  /* ---------- glitch composite ---------- */
  function glitchAt(t, now) {
    var I = 0;
    if (t > T_GL0 && t < T_GL1) I = Math.pow(Math.sin(Math.PI * (t - T_GL0) / (T_GL1 - T_GL0)), 0.8) * 0.9;
    if (t > T_TITLE && t < T_TITLE + 320) I = Math.max(I, 0.85 * (1 - (t - T_TITLE) / 320));
    if (t < T_GL0 && now > nextMicro) { microUntil = now + 100; nextMicro = now + 500 + Math.random() * 800; }
    if (now < microUntil) I = Math.max(I, 0.2);
    if (t > T_DRAIN1 - 150 && t < T_DRAIN1 + 200) I = Math.max(I, 0.55); // the number lets go
    return I;
  }

  function tint(dst, dctx, color) {
    dctx.globalCompositeOperation = 'source-over';
    dctx.drawImage(buf, 0, 0);
    dctx.globalCompositeOperation = 'multiply';
    dctx.fillStyle = color; dctx.fillRect(0, 0, dst.width, dst.height);
    dctx.globalCompositeOperation = 'source-over';
  }

  function composite(I, now) {
    var w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (I < 0.03) { ctx.drawImage(buf, 0, 0); return; }
    if (I > 0.08) { tint(bufR, rctx, '#ff0000'); tint(bufC, cctx, '#00ffff'); }
    var tick = Math.floor(now / 80), N = 16, bounds = [0], sum = 0, hs = [], i;
    for (i = 0; i < N; i++) { var v = 0.4 + hash(i, tick) * 1.6; hs.push(v); sum += v; }
    var acc = 0;
    for (i = 0; i < N; i++) { acc += hs[i] / sum * h; bounds.push(acc); }
    for (i = 0; i < N; i++) {
      var sy = Math.floor(bounds[i]), sh = Math.ceil(bounds[i + 1]) - sy;
      if (sh <= 0) continue;
      if (hash(i, tick + 3) >= I * 1.05) { ctx.drawImage(buf, 0, sy, w, sh, 0, sy, w, sh); continue; }
      var dx = (hash(i, tick + 5) - 0.5) * I * 0.22 * w;
      var sp = (hash(i, tick + 9) > 0.5 ? 1 : -1) * I * 0.02 * w;
      ctx.fillStyle = BG; ctx.fillRect(0, sy, w, sh);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(bufR, 0, sy, w, sh, dx + sp, sy, w, sh);
      ctx.drawImage(bufC, 0, sy, w, sh, dx - sp, sy, w, sh);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* ---------- frame ---------- */
  function paint(t, now) {
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.globalAlpha = 1; bctx.textAlign = 'left';
    bctx.fillStyle = BG; bctx.fillRect(0, 0, W, H);
    drawDrain(t, 1 - smooth(T_ASCII0, T_ASCII0 + 650, t));
    drawAscii(smooth(T_ASCII0, T_ASCII1, t), 1 - smooth(T_GL0 + 250, T_GL1, t));
    drawPhoto(smooth(T_GL0 + 250, T_GL1, t));
    var sy = (t * 0.35) % H;
    bctx.fillStyle = 'rgba(232,229,223,.16)'; bctx.fillRect(0, sy, W, 1);
    drawTitle(t);
    composite(glitchAt(t, now), now);
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    try {
      var t = now - t0;
      if (!imgReady && t > T_DRAIN1) { t0 = now - T_DRAIN1; t = T_DRAIN1; }      // wait for the wallet photo
      if (t >= T_END) {
        if (allLoaded) { startDissolve(now); return; }
        t0 = now - T_END; t = T_END;                                              // hold until every frame is cached
      }
      paint(t, now);
      renderLog(t);
      var tp = clamp(t / T_END, 0, 1), pct = allLoaded ? tp : Math.min(tp, 0.99);
      countEl.textContent = ('000' + Math.floor(pct * 100)).slice(-3);
      fillEl.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
    } catch (e) { finishNow(); return; }
    raf = requestAnimationFrame(frame);
  }

  /* ---------- the hand-off: halftone dither dissolve onto what is underneath ---------- */
  function bayer8() {
    var m = [[0]], n = 1;
    while (n < 8) {
      var nn = n * 2, next = [];
      for (var y = 0; y < nn; y++) { next.push([]); for (var x = 0; x < nn; x++) { var b = m[y % n][x % n] * 4; next[y].push(b + (y < n ? (x < n ? 0 : 2) : (x < n ? 3 : 1))); } }
      m = next; n = nn;
    }
    return m;
  }

  function startDissolve(now) {
    if (ending) return;
    ending = true; running = false;
    cancelAnimationFrame(raf);
    el.classList.add('hud-off');
    countEl.textContent = '100'; fillEl.style.transform = 'scaleX(1)';

    // last frame: photo + title, with a final burst of glitch
    paint(T_END, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    composite(0.6, now);

    el.style.background = 'transparent';         // the canvas is opaque; it now gets holes punched in it
    root.classList.remove('intro-lock');          // the page underneath starts moving
    document.dispatchEvent(new CustomEvent('ef:intro-dissolve'));

    var cell = narrow ? 12 : 16, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    var bm = bayer8(), maxD = Math.sqrt(cx * cx + cy * cy) + Math.max(W, H) * 0.4, cells = [];
    for (var j = 0; j < gh; j++) for (var i = 0; i < gw; i++) {
      var dx = i * cell + cell / 2 - cx, dy = j * cell + cell / 2 - cy;
      var dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / maxD);
      cells.push({ x: i, y: j, k: (bm[j & 7][i & 7] / 64) * 0.55 + dist * 0.45 });
    }
    cells.sort(function (a, b) { return a.k - b.k; });

    var start = performance.now(), done = 0, total = cells.length, cw = cell * dpr;
    (function step(n) {
      var u = clamp((n - start) / DISSOLVE, 0, 1), target = Math.floor(easeIO(u) * total);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (; done < target; done++) { var c = cells[done]; ctx.clearRect(Math.floor(c.x * cw), Math.floor(c.y * cw), Math.ceil(cw) + 1, Math.ceil(cw) + 1); }
      if (u < 1) raf = requestAnimationFrame(step); else finishNow();
    })(start);
  }

  function finishNow() {
    running = false; ending = true;
    cancelAnimationFrame(raf);
    clearTimeout(safety);
    root.classList.remove('intro-lock');
    el.classList.add('hud-off');
    el.style.display = 'none';
    document.removeEventListener('keydown', onKey);
    document.dispatchEvent(new CustomEvent('ef:intro-done'));
  }

  function skipNow() {
    if (!running || ending) return;
    if (!allLoaded) { finishNow(); return; }
    startDissolve(performance.now());
  }
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skipNow(); }
  }

  /* ---------- play ---------- */
  function play() {
    if (running) return;
    try { sessionStorage.setItem('ef-intro', '1'); } catch (e) {}
    if (reduce) { finishNow(); return; }
    ending = false; el.style.display = ''; el.style.background = ''; el.classList.remove('hud-off');
    root.classList.add('intro-lock');
    window.scrollTo(0, 0);
    D = buildDrain(); lines = logLines();
    resize();
    loadImages();
    document.addEventListener('keydown', onKey);
    clearTimeout(safety);
    safety = setTimeout(function () { if (!ending || running) finishNow(); }, 14000);   // can never get stuck
    var fonts = (document.fonts && document.fonts.load) ? Promise.all([
      document.fonts.load('900 100px "Big Shoulders Display"', 'EXPENSEFLOW0123456789\u20B9'),
      document.fonts.load('500 14px "DM Mono"', '0123456789\u20B9$\u20AC\u00A5\u2212')
    ]) : Promise.resolve();
    var go = function () {
      if (running || ending) return;
      running = true; t0 = performance.now(); nextMicro = t0 + 700;
      raf = requestAnimationFrame(frame);
    };
    Promise.race([fonts, new Promise(function (r) { setTimeout(r, 900); })]).then(go, go);
  }

  skipBtn.addEventListener('click', skipNow);
  window.addEventListener('resize', function () { if (running && !ending) resize(); });

  window.EF.Intro = { play: play };

  if (root.classList.contains('intro-lock')) play();
  else { el.style.display = 'none'; }
})();
