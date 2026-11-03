/* TrueLedger — hero.js
   A scroll-scrubbed canvas: closed wallet -> full wallet -> empty wallet.
   Transitions are glitch slices with an RGB split instead of a cross-fade. */
(function () {
  'use strict';

  var FRAMES = {
    closed: 'assets/frames/closed.jpg',
    cash: 'assets/frames/open_cash.jpg',
    empty: 'assets/frames/open_empty.jpg'
  };
  var SRC = 720; // source frames are 720 x 720
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var section, canvas, ctx, stage, tagsEl, cue, railFill, scenes;
  var imgs = {}, loaded = 0;
  var W = 0, H = 0, dpr = 1, S = 0, cx = 0, cy = 0, zoomK = 0.2;
  var target = 0, cur = 0, inView = true, running = false;
  var sceneIdx = -1, data = null, lastFilter = '';
  var bump = 0, bumpAt = 0, nextBump = 0;
  var burstUntil = 0, pmx = 0, pmy = 0, px = 0, py = 0, parallax = false;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hash(i, seed) { var x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---------- image prep ---------- */
  function channelCanvas(img, color) {
    var c = document.createElement('canvas');
    c.width = c.height = SRC;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0, SRC, SRC);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = color;
    x.fillRect(0, 0, SRC, SRC);
    return c;
  }

  // soften the outer edge of a frame so its rectangle never shows against the page
  function feather(c) {
    var x = c.getContext('2d'), e = SRC * 0.07, g;
    x.globalCompositeOperation = 'destination-in';
    g = x.createLinearGradient(0, 0, SRC, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(e / SRC, '#000'); g.addColorStop(1 - e / SRC, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, SRC, SRC);
    g = x.createLinearGradient(0, 0, 0, SRC);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(e / SRC, '#000'); g.addColorStop(1 - e / SRC, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, SRC, SRC);
    x.globalCompositeOperation = 'source-over';
    return c;
  }

  function baseCanvas(img) {
    var c = document.createElement('canvas');
    c.width = c.height = SRC;
    c.getContext('2d').drawImage(img, 0, 0, SRC, SRC);
    return feather(c);
  }

  function loadImages(done) {
    var keys = Object.keys(FRAMES);
    keys.forEach(function (k) {
      var im = new Image();
      im.onload = function () {
        imgs[k] = { img: baseCanvas(im), r: feather(channelCanvas(im, '#ff0000')), gb: feather(channelCanvas(im, '#00ffff')) };
        if (++loaded === keys.length) done();
      };
      im.src = FRAMES[k];
    });
  }

  /* ---------- layout ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    var narrow = W < 760;
    zoomK = narrow ? 0.07 : 0.2;
    var walletW = narrow ? W * 0.86 : clamp(W * 0.54, 360, 800);
    S = walletW / 0.78; // open wallet is about 78% of the frame width
    cx = W / 2;
    cy = H * (narrow ? 0.34 : 0.43);
    placeTags();
    schedule();
  }

  /* ---------- drawing ---------- */
  var sliceCache = { tick: -1, bounds: [] };
  function sliceBounds(tick, n) {
    if (sliceCache.tick === tick) return sliceCache.bounds;
    var hs = [], sum = 0, i;
    for (i = 0; i < n; i++) { var v = 0.4 + hash(i, tick) * 1.6; hs.push(v); sum += v; }
    var b = [0], acc = 0;
    for (i = 0; i < n; i++) { acc += hs[i] / sum * SRC; b.push(acc); }
    sliceCache = { tick: tick, bounds: b };
    return b;
  }

  function draw(a, b, t, intensity, zoom) {
    var A = imgs[a], B = imgs[b];
    if (!A || !B) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var size = S * zoom, k = size / SRC;
    var x0 = cx - size / 2, y0 = cy - size / 2;

    if (reduce) { // soft cross-fade only
      ctx.globalAlpha = 1; ctx.drawImage(A.img, x0, y0, size, size);
      if (a !== b) { ctx.globalAlpha = t; ctx.drawImage(B.img, x0, y0, size, size); ctx.globalAlpha = 1; }
      return;
    }

    if (intensity < 0.01) {
      ctx.drawImage((t > 0.5 ? B : A).img, x0, y0, size, size);
      return;
    }

    var now = performance.now();
    var tick = Math.floor(now / 85);
    var N = 22;
    var bounds = sliceBounds(tick, N);
    var cut = smooth(0.0, 1.0, t);

    for (var i = 0; i < N; i++) {
      var sy = bounds[i], sh = bounds[i + 1] - sy;
      var src = (hash(i, 99) < cut) ? B : A;
      var glitchy = hash(i, tick + 3) < intensity * 1.05;
      var dy = y0 + sy * k, dh = sh * k + 0.6;
      if (!glitchy) {
        ctx.drawImage(src.img, 0, sy, SRC, sh, x0, dy, size, dh);
        continue;
      }
      var dx = (hash(i, tick + 5) - 0.5) * intensity * 0.3 * size;
      var split = (hash(i, tick + 9) > 0.5 ? 1 : -1) * intensity * 0.028 * size;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, dy, W, dh); ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, dy, W, dh);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(src.r, 0, sy, SRC, sh, x0 + dx + split, dy, size, dh);
      ctx.drawImage(src.gb, 0, sy, SRC, sh, x0 + dx - split, dy, size, dh);
      ctx.restore();
    }

    // a couple of hot bars while the glitch is strong
    if (intensity > 0.35) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (var j = 0; j < 3; j++) {
        if (hash(j, tick + 21) < intensity) {
          var by = y0 + hash(j, tick + 31) * size;
          ctx.fillStyle = hash(j, tick + 41) > 0.5 ? 'rgba(232,52,43,.55)' : 'rgba(232,229,223,.5)';
          ctx.fillRect(x0 + size * 0.1, by, size * 0.8 * hash(j, tick + 51), 2 + hash(j, tick + 61) * 5);
        }
      }
      ctx.restore();
    }
  }

  /* ---------- timeline ---------- */
  function timeline(p) {
    var zoom = 1 + p * zoomK;
    if (p < 0.2) return { a: 'closed', b: 'closed', t: 0, i: 0, gray: 1, zoom: zoom };
    if (p < 0.42) {
      var t1 = (p - 0.2) / 0.22;
      return { a: 'closed', b: 'cash', t: t1, i: Math.pow(Math.sin(Math.PI * t1), 0.8), gray: 1 - smooth(0.45, 0.9, t1), zoom: zoom };
    }
    if (p < 0.58) return { a: 'cash', b: 'cash', t: 0, i: 0, gray: 0, zoom: zoom };
    if (p < 0.8) {
      var t2 = (p - 0.58) / 0.22;
      return { a: 'cash', b: 'empty', t: t2, i: Math.pow(Math.sin(Math.PI * t2), 0.8), gray: 0.85 * smooth(0.3, 0.8, t2), zoom: zoom };
    }
    return { a: 'empty', b: 'empty', t: 0, i: 0, gray: 0.85, zoom: zoom };
  }

  function setScene(i) {
    if (i === sceneIdx) return;
    sceneIdx = i;
    for (var s = 0; s < scenes.length; s++) scenes[s].classList.toggle('is-on', s === i);
    if (data) {
      if (i === 1) countTo(document.getElementById('h-balance'), data.balance);
      if (i === 2) countTo(document.getElementById('h-spent'), data.spent);
    }
  }

  function countTo(el, to) {
    if (!el) return;
    var from = el._v || 0, start = performance.now(), dur = reduce ? 1 : 900;
    el._v = to;
    if (el._raf) cancelAnimationFrame(el._raf);
    (function step(now) {
      var k = clamp((now - start) / dur, 0, 1);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = EF.Store.fmt(from + (to - from) * e, { whole: true });
      if (k < 1) el._raf = requestAnimationFrame(step);
    })(start);
  }

  /* ---------- tags around the open wallet ---------- */
  function placeTags() {
    if (!tagsEl) return;
    var half = S * 0.43;
    var spots = [
      { side: 'l', x: cx - half, y: cy - S * 0.1 },
      { side: 'l', x: cx - half, y: cy + S * 0.09 },
      { side: 'r', x: cx + half, y: cy - S * 0.1 },
      { side: 'r', x: cx + half, y: cy + S * 0.09 }
    ];
    var els = tagsEl.children;
    for (var i = 0; i < els.length; i++) {
      var sp = spots[i];
      els[i].style.left = sp.x + 'px';
      els[i].style.top = sp.y + 'px';
    }
  }

  function renderTags() {
    if (!data || !tagsEl) return;
    var list = data.accounts.slice().sort(function (a, b) { return b.balance - a.balance; }).slice(0, 4);
    var order = [0, 2, 1, 3]; // spread across both sides
    tagsEl.innerHTML = '';
    for (var i = 0; i < 4; i++) {
      var acc = list[order[i]] || list[i];
      var d = document.createElement('div');
      d.className = 'tag ' + (i < 2 ? 'tag-l' : 'tag-r');
      if (!acc || (order[i] >= list.length)) { d.hidden = true; }
      else {
        d.innerHTML = '<span class="tag-name"></span><span class="tag-val num money"></span>';
        d.setAttribute('data-id', acc.id || '');
        d.setAttribute('title', 'Show entries in ' + acc.name);
        d.firstChild.textContent = acc.name;
        d.lastChild.textContent = EF.Store.fmt(acc.balance, { whole: true });
      }
      tagsEl.appendChild(d);
    }
    placeTags();
  }

  /* ---------- frame loop ---------- */
  function readScroll() {
    var r = section.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    target = total > 0 ? clamp(-r.top / total, 0, 1) : 0;
    inView = r.bottom > -50 && r.top < window.innerHeight + 50;
  }

  function frame(now) {
    running = false;
    if (!imgs.closed || !imgs.cash || !imgs.empty) return;

    cur += (target - cur) * (reduce ? 1 : 0.14);
    if (Math.abs(target - cur) < 0.0004) cur = target;

    var tl = timeline(cur);

    // idle micro-glitch every few seconds when sitting on a still frame
    var intensity = tl.i;
    if (!reduce && intensity === 0) {
      if (now > nextBump) { bumpAt = now; nextBump = now + 3500 + Math.random() * 3500; }
      var age = now - bumpAt;
      if (age < 200) intensity = 0.28 * (1 - age / 200);
    }

    if (!reduce && burstUntil > now) intensity = Math.max(intensity, 0.62 * ((burstUntil - now) / 340));

    if (parallax) {
      px += (pmx * -22 - px) * 0.07; py += (pmy * -14 - py) * 0.07;
      stage.style.transform = 'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0)';
    }

    draw(tl.a, tl.b, tl.t, intensity, tl.zoom);

    var g = Math.round(tl.gray * 100) / 100;
    var f = 'grayscale(' + g + ') contrast(' + (1.05 + g * 0.18) + ') brightness(' + (1 - g * 0.06) + ')';
    if (f !== lastFilter) { canvas.style.filter = f; lastFilter = f; }

    setScene(cur < 0.31 ? 0 : cur < 0.69 ? 1 : 2);
    railFill.style.transform = 'scaleY(' + cur.toFixed(3) + ')';
    cue.style.opacity = cur < 0.03 ? 1 : 0;

    var tg = smooth(0.4, 0.47, cur) * (1 - smooth(0.55, 0.62, cur));
    tagsEl.style.opacity = tg.toFixed(3);
    tagsEl.classList.toggle('live', tg > 0.6);

    if (inView && (cur !== target || !reduce)) schedule();
  }

  function schedule() {
    if (running || !inView) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function onScroll() { readScroll(); schedule(); }

  /* ---------- public ---------- */
  function setData(d) {
    data = d;
    var sub = document.getElementById('h-balance-sub');
    if (sub) sub.textContent = 'across ' + d.accounts.length + (d.accounts.length === 1 ? ' account' : ' accounts');
    var lab = document.getElementById('h-month-label');
    if (lab) lab.textContent = 'Gone in ' + d.monthName;
    var sp = document.getElementById('h-spent-sub');
    if (sp) sp.textContent = d.spent > 0 ? 'Keep scrolling. Here is exactly where.' : 'Nothing logged yet. Add your first entry below.';
    var b = document.getElementById('h-balance'), s = document.getElementById('h-spent');
    if (sceneIdx === 1) countTo(b, d.balance); else { b._v = d.balance; b.textContent = EF.Store.fmt(d.balance, { whole: true }); }
    if (sceneIdx === 2) countTo(s, d.spent); else { s._v = d.spent; s.textContent = EF.Store.fmt(d.spent, { whole: true }); }
    renderTags();
  }

  function init() {
    section = document.getElementById('top');
    canvas = document.getElementById('wallet-canvas');
    stage = document.getElementById('stage');
    tagsEl = document.getElementById('hero-tags');
    cue = document.getElementById('cue');
    railFill = document.getElementById('rail-fill');
    scenes = Array.prototype.slice.call(section.querySelectorAll('.scene'));
    ctx = canvas.getContext('2d');

    section.querySelectorAll('.kin-line').forEach(function (line) {
      var text = line.getAttribute('data-text') || line.textContent;
      line.setAttribute('data-text', text); line.textContent = '';
      var wrap = document.createElement('span'); wrap.className = 'kin-word';
      text.split('').forEach(function (ch, i) {
        var s = document.createElement('span'); s.className = 'kin-ch'; s.style.setProperty('--i', i);
        s.textContent = ch === ' ' ? '\u00A0' : ch; wrap.appendChild(s);
      });
      line.appendChild(wrap);
    });

    resize();
    readScroll();
    cur = target;

    loadImages(function () {
      section.classList.add('ready');
      nextBump = performance.now() + 2200;
      schedule();
    });

    parallax = !reduce && window.matchMedia('(hover:hover)').matches;
    if (parallax) {
      section.addEventListener('pointermove', function (e) { pmx = e.clientX / W - 0.5; pmy = e.clientY / H - 0.5; }, { passive: true });
      section.addEventListener('pointerleave', function () { pmx = 0; pmy = 0; });
    }
    section.addEventListener('click', function (e) {
      var tag = e.target.closest('.tag');
      if (tag) { if (window.EF.Hero.onTag && tag.getAttribute('data-id')) window.EF.Hero.onTag(tag.getAttribute('data-id')); return; }
      if (e.target.closest('a,button')) return;
      burstUntil = performance.now() + 340; // click the wallet: it glitches
      if (window.EF && window.EF.FX) {
        window.EF.FX.onWalletClick(e.clientX, e.clientY);
      }
      schedule();
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { resize(); readScroll(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        inView = es[0].isIntersecting;
        if (inView) schedule();
      }, { rootMargin: '50px' }).observe(section);
    }
  }

  window.TL = window.EF = window.TL || window.EF || {};
  window.TL.Hero = window.EF.Hero = { init: init, setData: setData };
})();
