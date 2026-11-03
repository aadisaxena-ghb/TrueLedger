/* TrueLedger — cursor.js
   A cursor made for this page:
   - a precise dot that sits exactly on the pointer
   - a reticle that lags behind, then snaps its corner brackets around whatever you can click
   - a tiny label that says what a click will do (EDIT, FILTER, OPEN...)
   - a red/cyan split and a short trail when you move fast
   - a shockwave when you click
   It lives in the browser's top layer (popover) so it stays above dialogs.
   Only runs for a mouse or trackpad. Touch and reduced-motion keep the normal cursor. */
(function () {
  'use strict';

  var host = document.getElementById('cursor');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  window.TL = window.EF = window.TL || window.EF || {};
  if (!host || typeof host.showPopover !== 'function' || !fine || reduce) {
    window.TL.Cursor = window.EF.Cursor = { restack: function () {} };
    return;
  }

  /* ---------- build ---------- */
  var TRAIL = 5;
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  var trail = [], i;
  for (i = 0; i < TRAIL; i++) { var t = el('i', 'c-tr'); host.appendChild(t); trail.push({ node: t, x: -200, y: -200 }); }
  var ret = el('div', 'c-ret');
  for (i = 0; i < 4; i++) ret.appendChild(el('i'));
  var dot = el('div', 'c-dot');
  var lab = el('div', 'c-lab');
  host.appendChild(ret); host.appendChild(lab); host.appendChild(dot);

  /* ---------- state ---------- */
  var mx = -200, my = -200, pmx = -200, pmy = -200;          // mouse now / last frame
  var rx = -200, ry = -200, rw = 34, rh = 34;                // reticle (drawn)
  var tx = 0, ty = 0, tw = 34, th = 34;                      // reticle (wanted)
  var target = null, labelText = '', off = false, seen = false, running = false;
  var speed = 0;

  var SEL = 'a,button,select,input,textarea,label,[role="button"],.stat,.tx,.tag,.trend g[data-ym],.cat,.switch,.check,.day.has,#pal-list li,.chip';

  var LABELS = [
    ['.tx', 'EDIT'], ['.stat', 'OPEN'], ['.cat', 'FILTER'], ['.acc-info', 'FILTER'], ['.day.has', 'FILTER'],
    ['.tag', 'FILTER'], ['.trend g[data-ym]', 'VIEW'], ['.nav a', 'GO'], ['a.logo', 'TOP'],
    ['.add-btn', 'ADD'], ['.fab', 'ADD'], ['#end-add', 'ADD'], ['.switch', 'TOGGLE'], ['.seg button', 'PICK'],
    ['#pal-list li', 'RUN'], ['.chip', 'CLEAR'], ['.monthnav button', 'MONTH'], ['.check', 'TICK'], ['.x', 'CLOSE']
  ];
  function labelFor(node) {
    var explicit = node.getAttribute && node.getAttribute('data-cursor');
    if (explicit) return explicit;
    for (var k = 0; k < LABELS.length; k++) if (node.matches(LABELS[k][0])) return LABELS[k][1];
    return '';
  }
  function pad4(n) { n = Math.max(0, Math.round(n)); return ('0000' + n).slice(-4); }

  /* ---------- what is under the pointer ---------- */
  function resolve() {
    var node = document.elementFromPoint(mx, my);
    target = null; labelText = ''; off = false;
    if (!node) return;
    var t = node.closest(SEL);
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { off = true; return; } // normal I-beam / arrow there
    if (t) {
      var r = t.getBoundingClientRect();
      if (r.width <= 1700 && r.height <= 420 && r.width > 0) target = r;
      labelText = labelFor(t);
    } else if (node.closest('.hero-pin')) {
      labelText = node.tagName === 'CANVAS' ? 'GLITCH' : 'X ' + pad4(mx) + '  Y ' + pad4(my);
    }
  }

  /* ---------- draw loop ---------- */
  var lastLabel = null, labW = 60;
  function frame() {
    running = false;
    var vx = mx - pmx, vy = my - pmy;
    speed = Math.sqrt(vx * vx + vy * vy);
    pmx = mx; pmy = my;

    if (target) { tx = target.left - 7; ty = target.top - 7; tw = target.width + 14; th = target.height + 14; }
    else { tx = mx - 17; ty = my - 17; tw = 34; th = 34; }

    var kp = target ? 0.32 : 0.2, ks = target ? 0.3 : 0.22;
    rx += (tx - rx) * kp; ry += (ty - ry) * kp;
    rw += (tw - rw) * ks; rh += (th - rh) * ks;

    dot.style.transform = 'translate3d(' + mx.toFixed(1) + 'px,' + my.toFixed(1) + 'px,0)';
    ret.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0)';
    ret.style.width = rw.toFixed(1) + 'px';
    ret.style.height = rh.toFixed(1) + 'px';
    ret.classList.toggle('locked', !!target);

    // red / cyan split when moving fast
    var s = Math.min(4, speed / 7);
    ret.style.filter = s > 0.8 ? 'drop-shadow(' + s.toFixed(1) + 'px 0 #f00) drop-shadow(' + (-s).toFixed(1) + 'px 0 #0ff)' : '';

    // trail: each square chases the one before it
    var px = mx, py = my, moving = speed > 0.3;
    for (var n = 0; n < TRAIL; n++) {
      var tr = trail[n], k = 0.34 - n * 0.045;
      tr.x += (px - tr.x) * k; tr.y += (py - tr.y) * k;
      tr.node.style.transform = 'translate3d(' + tr.x.toFixed(1) + 'px,' + tr.y.toFixed(1) + 'px,0)';
      tr.node.style.opacity = Math.min(0.9, speed / 14) * (1 - n / TRAIL);
      px = tr.x; py = tr.y;
      if (Math.abs(tr.x - mx) > 0.4 || Math.abs(tr.y - my) > 0.4) moving = true;
    }

    // label next to the reticle
    if (labelText !== lastLabel) { lab.textContent = labelText; lastLabel = labelText; labW = lab.offsetWidth || 60; }
    var lx = rx + rw + 8, ly = ry - 6;
    if (lx + labW > window.innerWidth - 8) lx = rx - labW - 8;
    lab.style.transform = 'translate3d(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px,0)';
    lab.classList.toggle('on', !!labelText && seen && !off);

    host.style.opacity = seen && !off ? '1' : '0';

    var settled = Math.abs(tx - rx) < 0.3 && Math.abs(ty - ry) < 0.3 && Math.abs(tw - rw) < 0.3 && Math.abs(th - rh) < 0.3;
    if (!settled || moving) { running = true; requestAnimationFrame(frame); }
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }

  /* ---------- events ---------- */
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    mx = e.clientX; my = e.clientY;
    if (!seen) { seen = true; rx = mx - 17; ry = my - 17; trail.forEach(function (t) { t.x = mx; t.y = my; }); pmx = mx; pmy = my; }
    resolve(); kick();
  }, { passive: true });

  window.addEventListener('scroll', function () { if (seen) { resolve(); kick(); } }, { passive: true });
  window.addEventListener('resize', function () { if (seen) { resolve(); kick(); } });

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    ret.classList.add('down');
    var p = el('b', 'c-pulse');
    p.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    p.style.left = '0'; p.style.top = '0';
    // the keyframes scale the element, so wrap it to keep the position separate
    var wrap = el('div', 'c-tr'); wrap.style.opacity = '1'; wrap.style.background = 'none';
    wrap.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    p.style.transform = ''; wrap.appendChild(p);
    host.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 600);
    kick();
  });
  document.addEventListener('pointerup', function () { ret.classList.remove('down'); });
  document.documentElement.addEventListener('mouseleave', function () { seen = false; host.style.opacity = '0'; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { seen = false; host.style.opacity = '0'; } });

  /* ---------- top layer ---------- */
  function restack() {
    try { host.hidePopover(); host.showPopover(); } catch (e) {}
  }

  document.documentElement.classList.add('has-cursor');
  try { host.showPopover(); } catch (e) { document.documentElement.classList.remove('has-cursor'); }
  host.style.opacity = '0';

  window.EF.Cursor = { restack: restack };
})();
