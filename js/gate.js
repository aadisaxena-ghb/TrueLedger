/* ExpenseFlow — gate.js
   The wallet gate: a first-run "create your wallet" screen and a PIN lock.
   Everything is local. The PIN is salted + hashed and kept in this browser only.
   It locks the screen; it does not encrypt your data.
   ?nogate skips it. */
(function () {
  'use strict';

  var root = document.documentElement;
  var gate = document.getElementById('gate');
  window.EF = window.EF || {};
  if (!gate) { window.EF.Gate = { lock: function () {}, hasPin: function () { return false; } }; return; }

  var LOCK_KEY = 'expenseflow.lock';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover:hover) and (pointer:fine)').matches;

  function $(id) { return document.getElementById(id); }
  var panel = $('g-panel'), form = $('g-form'), card = $('g-card'), word = $('g-word');
  var nameWrap = $('g-name-wrap'), nameIn = $('gt-name'), pinWrap = $('g-pin-wrap'), pinEl = $('g-pin'), pinIn = $('g-pin-input');
  var pinLab = $('g-pin-lab'), msg = $('g-msg'), submit = $('g-submit'), submitT = $('g-submit-t');
  var demoBtn = $('g-demo'), forgot = $('g-forgot'), fine = $('g-fine'), eye = $('g-eye');
  var title = $('g-title'), sub = $('g-sub'), holder = $('g-holder'), last = $('g-last');
  var cells = Array.prototype.slice.call(pinEl.querySelectorAll('i'));
  var pars = Array.prototype.slice.call(gate.querySelectorAll('.g-par'));
  var dotsCanvas = $('g-dots'), dctx = dotsCanvas.getContext('2d');

  var mode = 'unlock', lockRec = null, pinMax = 6, busy = false, looping = false, raf = 0;
  var W = 0, H = 0, dpr = 1, gs = 24;
  var mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5, lastMove = 0, pulses = [];
  var tiles = null, forgotTimer = 0, lockTimer = 0;

  /* ---------- storage + hashing ---------- */
  function getLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)); } catch (e) { return null; } }
  function saveLock(rec) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(rec)); } catch (e) {} }
  function randomSalt() {
    try { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
    catch (e) { return String(Math.random()).slice(2) + Date.now(); }
  }
  function hasSubtle() { return !!(window.crypto && crypto.subtle && window.TextEncoder); }
  function hashPin(pin, salt, alg) {
    if (alg === 'sha256' && hasSubtle()) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      });
    }
    var h = 2166136261, s = salt + ':' + pin;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return Promise.resolve('f' + h.toString(16));
  }
  function bestAlg() { return hasSubtle() ? 'sha256' : 'fnv'; }
  function emit(name, detail) { document.dispatchEvent(new CustomEvent(name, { detail: detail })); }

  /* ---------- attempts ---------- */
  function lockoutLeft() { var u = 0; try { u = +sessionStorage.getItem('ef-until') || 0; } catch (e) {} return Math.max(0, u - Date.now()); }
  function bumpAttempts() {
    var n = 0; try { n = (+sessionStorage.getItem('ef-tries') || 0) + 1; sessionStorage.setItem('ef-tries', String(n)); if (n >= 5) { sessionStorage.setItem('ef-until', String(Date.now() + 30000)); sessionStorage.setItem('ef-tries', '0'); } } catch (e) {}
    return n;
  }
  function resetAttempts() { try { sessionStorage.removeItem('ef-tries'); sessionStorage.removeItem('ef-until'); } catch (e) {} }
  function tickLockout() {
    clearInterval(lockTimer);
    var left = lockoutLeft();
    if (!left) { submit.disabled = false; return; }
    submit.disabled = true;
    lockTimer = setInterval(function () {
      var l = lockoutLeft();
      if (!l) { clearInterval(lockTimer); submit.disabled = false; say('', false); return; }
      say('Too many tries. Try again in ' + Math.ceil(l / 1000) + 's.', false);
    }, 250);
  }

  /* ---------- copy + modes ---------- */
  function say(text, ok) { msg.textContent = text || ''; msg.classList.toggle('ok', !!ok); }

  function setTitle(text) {
    title.textContent = '';
    title.setAttribute('aria-label', text);
    var words = text.split(' '), idx = 0;
    words.forEach(function (w, wi) {
      var word = document.createElement('span'); word.className = 'kin-word'; word.setAttribute('aria-hidden', 'true');
      w.split('').forEach(function (ch) { var s = document.createElement('span'); s.className = 'kin-ch'; s.style.setProperty('--i', idx++); s.textContent = ch; word.appendChild(s); });
      title.appendChild(word);
      if (wi < words.length - 1) title.appendChild(document.createTextNode(' '));
    });
  }

  function setMode(m) {
    mode = m; lockRec = getLock();
    var name = '';
    try { name = (EF.Store && EF.Store.state.profile.name) || ''; } catch (e) {}
    if (m === 'unlock' && lockRec) {
      pinMax = lockRec.len || 4;
      setTitle('UNLOCK WALLET');
      sub.textContent = 'Welcome back' + (name ? ', ' + name : '') + '. Enter your passcode to open your accounts and live ledger.';
      nameWrap.hidden = true; demoBtn.hidden = true; forgot.hidden = false;
      pinLab.textContent = 'VAULT PASSCODE';
      submitT.textContent = 'Unlock wallet';
      fine.textContent = 'Your data never leaves this device.';
      holder.textContent = name || 'YOUR NAME';
    } else {
      mode = 'create'; pinMax = 6;
      setTitle('OPEN YOUR WALLET');
      sub.textContent = 'Name it and set a passcode. Everything stays on this device. No account, no sign-up.';
      nameWrap.hidden = false; demoBtn.hidden = false; forgot.hidden = true;
      pinLab.textContent = 'CHOOSE A PASSCODE (4 TO 6 DIGITS)';
      submitT.textContent = 'Create wallet';
      fine.textContent = 'A passcode locks the screen on this device. It does not encrypt your data.';
      holder.textContent = (nameIn.value.trim() || 'YOUR NAME');
    }
    pinIn.maxLength = pinMax; pinIn.value = '';
    cells.forEach(function (c, i) { c.hidden = i >= pinMax; });
    say('', false); updatePin(); tickLockout();
  }

  /* ---------- passcode cells ---------- */
  function updatePin() {
    var v = pinIn.value.replace(/\D/g, '').slice(0, pinMax);
    if (v !== pinIn.value) pinIn.value = v;
    cells.forEach(function (c, i) {
      c.classList.toggle('on', i < v.length);
      c.classList.toggle('cur', i === v.length && i < pinMax);
      if (i < v.length) c.setAttribute('data-d', v.charAt(i)); else c.removeAttribute('data-d');
    });
    var r = pinMax ? v.length / pinMax : 0;
    card.style.setProperty('--open', (mode === 'unlock' ? r : Math.min(1, v.length / 4)).toFixed(2));
    last.classList.toggle('live', v.length > 0);
    return v;
  }

  function pulse(big) {
    var rect = card.getBoundingClientRect();
    pulses.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: 10, a: big ? 1 : 0.7, max: big ? Math.max(W, H) : 420 });
  }

  /* ---------- motion loop: card tilt, parallax, halftone dot field ---------- */
  function sizeDots() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    dotsCanvas.width = Math.round(W * dpr); dotsCanvas.height = Math.round(H * dpr);
    gs = W < 760 ? 20 : 24;
  }

  function drawDots(t) {
    var c = dctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    var px = mx * W, py = my * H, i;
    c.beginPath();
    var base = new Path2D(), mid = new Path2D(), hot = new Path2D();
    for (var y = gs / 2; y < H; y += gs) {
      for (var x = gs / 2; x < W; x += gs) {
        var dx = x - px, dy = y - py, d = Math.sqrt(dx * dx + dy * dy);
        var inf = Math.max(0, 1 - d / 200);
        var wave = (Math.sin(x * 0.018 + y * 0.012 + t * 0.0014) + 1) * 0.5;
        var r = 0.8 + wave * 0.7 + inf * inf * 5.2;
        var ring = 0;
        for (i = 0; i < pulses.length; i++) {
          var p = pulses[i], ex = x - p.x, ey = y - p.y;
          var dd = Math.abs(Math.sqrt(ex * ex + ey * ey) - p.r);
          if (dd < 46) ring = Math.max(ring, (1 - dd / 46) * p.a);
        }
        r += ring * 4.2;
        var path = (inf > 0.55 || ring > 0.5) ? hot : (inf > 0.14 || ring > 0.12) ? mid : base;
        path.moveTo(x + r, y); path.arc(x, y, r, 0, 6.2832);
      }
    }
    c.fillStyle = 'rgba(232,229,223,.15)'; c.fill(base);
    c.fillStyle = 'rgba(243,166,184,.62)'; c.fill(mid);
    c.fillStyle = 'rgba(239,64,54,.92)'; c.fill(hot);
    for (i = pulses.length - 1; i >= 0; i--) {
      pulses[i].r += 11; pulses[i].a *= 0.985;
      if (pulses[i].r > pulses[i].max || pulses[i].a < 0.05) pulses.splice(i, 1);
    }
  }

  function loop(now) {
    raf = 0;
    if (!looping) return;
    if (now - lastMove > 2200) { tmx = 0.58 + Math.sin(now / 1900) * 0.14; tmy = 0.5 + Math.cos(now / 2400) * 0.09; }
    mx += (tmx - mx) * 0.07; my += (tmy - my) * 0.07;

    var ry = (mx - 0.5) * 36 - 4, rx = -(my - 0.5) * 24;
    card.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    card.style.setProperty('--ry', ry.toFixed(2) + 'deg');
    card.style.setProperty('--fx', (50 + (mx - 0.5) * 90).toFixed(1) + '%');
    card.style.setProperty('--fy', (50 + (my - 0.5) * 90).toFixed(1) + '%');
    card.style.setProperty('--fa', (ry * 4 + rx * 2).toFixed(1));
    card.style.setProperty('--fo', (0.2 + Math.min(0.4, (Math.abs(ry) + Math.abs(rx)) / 50)).toFixed(2));
    card.style.setProperty('--gx', (50 + (mx - 0.5) * 150).toFixed(1) + '%');
    card.style.setProperty('--gy', (45 + (my - 0.5) * 150).toFixed(1) + '%');
    for (var i = 0; i < pars.length; i++) {
      var dep = +pars[i].getAttribute('data-depth') || 0;
      pars[i].style.transform = 'translate3d(' + ((mx - 0.5) * dep).toFixed(1) + 'px,' + ((my - 0.5) * dep * 0.7).toFixed(1) + 'px,0)';
    }
    gate.style.setProperty('--wx', ((mx - 0.5) * -50).toFixed(1) + 'px');
    gate.style.setProperty('--wy', ((my - 0.5) * -30).toFixed(1) + 'px');
    if (!reduce) drawDots(now);
    raf = requestAnimationFrame(loop);
  }
  function startLoop() { if (looping) return; looping = true; raf = requestAnimationFrame(loop); }
  function stopLoop() { looping = false; cancelAnimationFrame(raf); }

  /* ---------- show / hide ---------- */
  function setInert(on) {
    ['bar', 'top', 'fab'].forEach(function (id) { var e = $(id); if (e) { if (on) e.setAttribute('inert', ''); else e.removeAttribute('inert'); } });
    document.querySelectorAll('main, .foot').forEach(function (e) { if (on) e.setAttribute('inert', ''); else e.removeAttribute('inert'); });
  }

  function enter() {
    if (gate.classList.contains('in')) return;
    gate.classList.add('in');
    setTimeout(function () { try { (mode === 'create' ? nameIn : pinIn).focus({ preventScroll: true }); } catch (e) {} }, 1300);
  }

  function open(m) {
    setInert(true);
    gate.classList.remove('leaving', 'err', 'in');
    gate.style.webkitMaskImage = gate.style.maskImage = '';
    gate.classList.add('show');
    form.reset(); busy = false;
    setMode(m);
    sizeDots(); startLoop();
    if (root.classList.contains('intro-lock')) {
      var go = function () { document.removeEventListener('ef:intro-dissolve', go); document.removeEventListener('ef:intro-done', go); enter(); };
      document.addEventListener('ef:intro-dissolve', go); document.addEventListener('ef:intro-done', go);
    } else requestAnimationFrame(function () { requestAnimationFrame(enter); });
  }

  /* ---------- halftone exit onto the live site ---------- */
  function buildTiles() {
    if (tiles) return tiles;
    tiles = []; var N = 14, S = 18, k;
    for (k = 0; k < N; k++) {
      var c = document.createElement('canvas'); c.width = c.height = S;
      var x = c.getContext('2d'), r = Math.max(0, (1 - k / (N - 1)) * S * 0.74);
      if (r > 0.2) { x.fillStyle = '#000'; x.beginPath(); x.arc(S / 2, S / 2, r, 0, 6.2832); x.fill(); }
      tiles.push('url(' + c.toDataURL() + ')');
    }
    return tiles;
  }
  function halftoneOut(done) {
    if (reduce) { done(); return; }
    var T = buildTiles(), start = performance.now(), D = 850;
    (function step(n) {
      var u = Math.min(1, (n - start) / D), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      var img = T[Math.min(T.length - 1, Math.floor(e * (T.length - 1) + 0.0001))];
      gate.style.webkitMaskImage = gate.style.maskImage = img;
      if (u < 1) requestAnimationFrame(step); else done();
    })(start);
  }

  function success(fast) {
    try { sessionStorage.setItem('ef-unlocked', '1'); } catch (e) {}
    try { localStorage.setItem('ef-onboarded', '1'); } catch (e) {}
    resetAttempts();
    var wait = 0;
    if (!fast && !reduce) {
      card.style.setProperty('--open', '1'); card.classList.add('open');
      gate.classList.add('leaving'); pulse(true);
      say('Unlocked.', true); wait = 900;
    }
    setTimeout(function () {
      root.classList.remove('gate-lock');          // header drops in, hero headline starts rising
      setInert(false);
      emit('ef:unlocked');
      halftoneOut(function () {
        gate.classList.remove('show', 'in', 'leaving', 'err');
        card.classList.remove('open');
        gate.style.webkitMaskImage = gate.style.maskImage = '';
        stopLoop(); form.reset(); busy = false; submit.disabled = false;
      });
    }, wait);
  }

  /* ---------- feedback ---------- */
  function fail(text) {
    say(text, false);
    gate.classList.add('err');
    card.classList.remove('err'); void card.offsetWidth; card.classList.add('err');
    if (panel.animate && !reduce) panel.animate([{ translate: '0 0' }, { translate: '-12px 0' }, { translate: '10px 0' }, { translate: '-8px 0' }, { translate: '6px 0' }, { translate: '0 0' }], { duration: 480, easing: 'ease-out' });
    setTimeout(function () { gate.classList.remove('err'); card.classList.remove('err'); }, 650);
    pinIn.value = ''; updatePin();
    try { pinIn.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- events ---------- */
  pinIn.addEventListener('input', function () {
    var before = pinIn.value.length;
    var v = updatePin();
    if (v.length) pulse(false);
    if (!msg.classList.contains('ok')) say('', false);
    if (mode === 'unlock' && v.length === pinMax && before === v.length) setTimeout(function () { form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }, 140);
  });
  pinIn.addEventListener('focus', updatePin);
  pinEl.addEventListener('pointerdown', function () { setTimeout(function () { pinIn.focus(); }, 0); });
  nameIn.addEventListener('input', function () { holder.textContent = nameIn.value.trim() || 'YOUR NAME'; });
  eye.addEventListener('click', function () {
    var on = eye.getAttribute('aria-pressed') !== 'true';
    eye.setAttribute('aria-pressed', String(on)); eye.textContent = on ? 'Hide digits' : 'Show digits';
    pinEl.classList.toggle('show', on);
  });

  gate.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType === 'touch') return;
    tmx = e.clientX / (W || window.innerWidth); tmy = e.clientY / (H || window.innerHeight); lastMove = performance.now();
  }, { passive: true });
  window.addEventListener('resize', function () { if (looping) sizeDots(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || lockoutLeft()) return;
    var pin = pinIn.value.replace(/\D/g, '');
    if (mode === 'unlock') {
      if (!lockRec) { setMode('create'); return; }
      if (pin.length < pinMax) { fail('Enter all ' + pinMax + ' digits.'); return; }
      busy = true; submit.disabled = true;
      var alg = lockRec.alg || 'sha256';
      if (alg === 'sha256' && !hasSubtle()) { busy = false; submit.disabled = false; fail('This browser can\u2019t check the passcode on an insecure page. Open the https address.'); return; }
      hashPin(pin, lockRec.salt, alg).then(function (h) {
        busy = false; submit.disabled = false;
        if (h === lockRec.hash) success(false);
        else {
          var n = bumpAttempts();
          if (lockoutLeft()) { fail('Too many tries. Try again in 30s.'); tickLockout(); }
          else fail('Wrong passcode. ' + (5 - n) + (5 - n === 1 ? ' try' : ' tries') + ' left.');
        }
      });
    } else {
      if (pin.length < 4) { fail('Choose 4 to 6 digits.'); return; }
      busy = true; submit.disabled = true;
      var salt = randomSalt(), a = bestAlg();
      hashPin(pin, salt, a).then(function (h) {
        saveLock({ salt: salt, hash: h, len: pin.length, alg: a });
        var nm = nameIn.value.trim();
        try { if (nm && EF.Store) EF.Store.setProfile({ name: nm }); } catch (er) {}
        busy = false; success(false);
      });
    }
  });

  demoBtn.addEventListener('click', function () { success(true); });

  forgot.addEventListener('click', function () {
    if (!forgot.classList.contains('sure')) {
      forgot.classList.add('sure'); forgot.textContent = 'This erases everything on this device. Click again to confirm.';
      clearTimeout(forgotTimer);
      forgotTimer = setTimeout(function () { forgot.classList.remove('sure'); forgot.textContent = 'Forgot your passcode? Erase this wallet'; }, 5000);
      return;
    }
    try { ['expenseflow.v2', LOCK_KEY, 'ef-onboarded'].forEach(function (k) { localStorage.removeItem(k); }); sessionStorage.clear(); } catch (e) {}
    location.reload();
  });

  /* ---------- public API ---------- */
  function lock() {
    if (!getLock()) return;
    try { sessionStorage.removeItem('ef-unlocked'); } catch (e) {}
    root.classList.add('gate-lock');
    window.scrollTo(0, 0);
    open('unlock');
    lastMove = 0;
  }

  /* ---------- settings: app lock + PIN dialog ---------- */
  var settingsModal = $('settings-modal'), pinModal = $('pin-modal'), pinForm = $('pin-form');
  var pmMode = 'set';

  function refreshLockUI() {
    var has = !!getLock();
    $('lock-status').textContent = has
      ? 'PIN lock is on. It locks the screen on this device. Your data is not encrypted.'
      : 'No PIN set. Add one to lock this wallet when you walk away.';
    $('lock-set').textContent = has ? 'Change PIN' : 'Set PIN';
    $('lock-now').hidden = !has; $('lock-remove').hidden = !has;
  }
  function openPinModal(m) {
    pmMode = m; var has = !!getLock();
    $('pin-title').textContent = m === 'remove' ? 'Remove PIN' : (has ? 'Change PIN' : 'Set PIN');
    $('pm-cur-wrap').hidden = !has; $('pm-new-wrap').hidden = m === 'remove'; $('pm-rep-wrap').hidden = m === 'remove';
    $('pm-save').textContent = m === 'remove' ? 'Remove PIN' : 'Save PIN';
    ['pm-cur', 'pm-new', 'pm-rep'].forEach(function (id) { $(id).value = ''; });
    $('pm-error').hidden = true;
    if (!pinModal.open) pinModal.showModal();
    if (EF.Cursor) EF.Cursor.restack();
    setTimeout(function () { (has ? $('pm-cur') : $('pm-new')).focus(); }, 30);
  }
  function pmError(t) { var e = $('pm-error'); e.textContent = t; e.hidden = false; }

  pinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var rec = getLock(), cur = $('pm-cur').value.replace(/\D/g, ''), nw = $('pm-new').value.replace(/\D/g, ''), rp = $('pm-rep').value.replace(/\D/g, '');
    function finish() {
      if (pmMode === 'remove') { try { localStorage.removeItem(LOCK_KEY); } catch (er) {} emit('ef:toast', 'PIN removed'); pinModal.close(); refreshLockUI(); return; }
      if (nw.length < 4) return pmError('Choose 4 to 6 digits.');
      if (nw !== rp) return pmError('The two PINs don\u2019t match.');
      var salt = randomSalt(), a = bestAlg();
      hashPin(nw, salt, a).then(function (h) {
        saveLock({ salt: salt, hash: h, len: nw.length, alg: a });
        try { sessionStorage.setItem('ef-unlocked', '1'); localStorage.setItem('ef-onboarded', '1'); } catch (er) {}
        emit('ef:toast', 'PIN saved'); pinModal.close(); refreshLockUI();
      });
    }
    if (rec) {
      if (cur.length < 4) return pmError('Enter your current PIN.');
      hashPin(cur, rec.salt, rec.alg || 'sha256').then(function (h) { if (h !== rec.hash) pmError('That current PIN is wrong.'); else finish(); });
    } else finish();
  });

  $('lock-set').addEventListener('click', function () { openPinModal('set'); });
  $('lock-remove').addEventListener('click', function () { openPinModal('remove'); });
  $('lock-now').addEventListener('click', function () { if (settingsModal.open) settingsModal.close(); setTimeout(lock, 60); });
  new MutationObserver(function () { if (settingsModal.open) refreshLockUI(); }).observe(settingsModal, { attributes: true, attributeFilter: ['open'] });
  refreshLockUI();

  window.EF.Gate = { lock: lock, hasPin: function () { return !!getLock(); } };

  /* ---------- go ---------- */
  if (root.classList.contains('gate-lock')) {
    try { open(getLock() ? 'unlock' : 'create'); }
    catch (e) { root.classList.remove('gate-lock'); setInert(false); }
  }
})();
