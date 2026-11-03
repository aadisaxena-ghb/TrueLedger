/* ExpenseFlow — fx.js
   Dynamic visual & audio effects: Marquee bands, drifting words, 3D card tilt & magnetic buttons,
   cyber number decode, scanline reveals, chart animations, 3D coin/confetti engine, text scrambler,
   scroll progress, Web Audio synth, and easter eggs.
*/
(function () {
  'use strict';
  window.EF = window.EF || {};
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  var NUM_SEL = '#s-income, #s-spent, #s-net, #s-balance, #h-balance, #h-spent, .stat .v, .acc-bal, .goal-amt';

  /* 1. Web Audio Synthesizer */
  var Sound = (function () {
    var ctx = null, enabled = false;
    try { enabled = localStorage.getItem('expenseflow.sound') === '1'; } catch (e) { enabled = false; }

    function initCtx() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctx = new AC();
      }
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
      return ctx;
    }

    function play(type) {
      if (!enabled) return;
      var c = initCtx();
      if (!c) return;
      var now = c.currentTime;
      function tone(f, dur, g, ty, delay, rampF) {
        var o = c.createOscillator(), gn = c.createGain(), t = now + (delay || 0);
        o.type = ty || 'sine'; o.frequency.setValueAtTime(f, t);
        if (rampF) o.frequency.exponentialRampToValueAtTime(rampF, t + dur);
        gn.gain.setValueAtTime(0, t);
        gn.gain.linearRampToValueAtTime(g || 0.15, t + Math.min(0.02, dur * 0.1));
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn); gn.connect(c.destination);
        o.start(t); o.stop(t + dur + 0.02);
      }
      try {
        if (type === 'coin') {
          tone(1760, 0.38, 0.22); tone(3520, 0.28, 0.12);
        } else if (type === 'success') {
          [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, 0.45, 0.18, 'triangle', i * 0.065); });
        } else if (type === 'laser') {
          var oL = c.createOscillator(), fl = c.createBiquadFilter(), gL = c.createGain();
          oL.type = 'sawtooth'; oL.frequency.setValueAtTime(2200, now); oL.frequency.exponentialRampToValueAtTime(260, now + 0.18);
          fl.type = 'bandpass'; fl.frequency.setValueAtTime(1800, now); fl.frequency.exponentialRampToValueAtTime(400, now + 0.18); fl.Q.value = 3.5;
          gL.gain.setValueAtTime(0.12, now); gL.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
          oL.connect(fl); fl.connect(gL); gL.connect(c.destination); oL.start(now); oL.stop(now + 0.22);
        } else if (type === 'decode') {
          tone(800 + Math.random() * 1600, 0.035, 0.035);
        } else if (type === 'click') {
          tone(180, 0.045, 0.15, 'sine', 0, 40);
        } else if (type === 'hover') {
          tone(3200 + Math.random() * 600, 0.025, 0.025);
        } else if (type === 'jackpot') {
          [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093.0].forEach(function (f, i) { tone(f, 0.5, 0.25, 'triangle', i * 0.075); });
        }
      } catch (err) {}
    }

    function setEnabled(val) {
      enabled = !!val;
      try { localStorage.setItem('expenseflow.sound', enabled ? '1' : '0'); } catch (e) {}
      if (enabled) { initCtx(); play('success'); }
      updateSoundUI();
    }

    function updateSoundUI() {
      var btn = document.getElementById('sound-btn');
      if (!btn) return;
      btn.setAttribute('aria-pressed', String(enabled));
      btn.innerHTML = (enabled ? '<span class="sound-icon">🔊</span> Sound: ON' : '<span class="sound-icon">🔇</span> Sound: OFF');
      btn.classList.toggle('active', enabled);
    }

    return {
      initCtx: initCtx,
      isEnabled: function () { return enabled; },
      setEnabled: setEnabled,
      toggle: function () { setEnabled(!enabled); return enabled; },
      play: play,
      updateSoundUI: updateSoundUI
    };
  })();

  /* 2. Scrolling Marquee Bands */
  var MarqueeManager = (function () {
    var bands = [], lastScrollY = window.scrollY || 0, lastScrollTime = performance.now();
    var velocity = 0, targetLean = 0, currentLean = 0, extraSpeed = 0;

    function init() {
      var m1 = document.getElementById('marquee-1'), m2 = document.getElementById('marquee-2');
      if (m1) bands.push({ el: m1, dir: -1, offset: 0, tracks: m1.querySelectorAll('.marquee-track') });
      if (m2) bands.push({ el: m2, dir: 1, offset: 0, tracks: m2.querySelectorAll('.marquee-track') });
      if (!bands.length) return;
      window.addEventListener('scroll', onScroll, { passive: true });
      requestAnimationFrame(loop);
    }

    function onScroll() {
      var now = performance.now(), dt = Math.max(now - lastScrollTime, 8), sy = window.scrollY || 0;
      velocity = (sy - lastScrollY) / dt;
      lastScrollY = sy; lastScrollTime = now;
      targetLean = Math.max(-20, Math.min(20, velocity * 16));
      extraSpeed = Math.min(Math.abs(velocity) * 16, 12);
    }

    function loop() {
      currentLean += (targetLean - currentLean) * 0.12;
      targetLean *= 0.88; extraSpeed *= 0.92;
      bands.forEach(function (b) {
        b.offset += (0.85 + extraSpeed) * b.dir * 0.12;
        if (b.offset <= -50) b.offset += 50;
        if (b.offset >= 0) b.offset -= 50;
        b.el.style.transform = 'skewX(' + (reduce ? 0 : currentLean).toFixed(2) + 'deg)';
        b.tracks.forEach(function (t) { t.style.transform = 'translate3d(' + b.offset.toFixed(3) + '%,0,0)'; });
      });
      requestAnimationFrame(loop);
    }
    return { init: init };
  })();

  /* 3. Giant Outlined Words */
  var DriftWordsManager = (function () {
    var words = [];
    function init() {
      words = [];
      document.querySelectorAll('.drift-word').forEach(function (node) {
        words.push({ el: node, section: node.closest('section') || node.parentElement, drift: parseFloat(node.getAttribute('data-drift') || '0.2') });
      });
      if (!words.length) return;
      window.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update, { passive: true });
      update();
    }
    function update() {
      if (reduce) return;
      var vh = window.innerHeight;
      words.forEach(function (w) {
        var r = w.section.getBoundingClientRect(), off = (r.top + r.height / 2) - (vh / 2);
        w.el.style.transform = 'translate3d(' + (off * w.drift).toFixed(1) + 'px,' + (off * 0.04).toFixed(1) + 'px,0)';
      });
    }
    return { init: init, update: update };
  })();

  /* 4. Cards Tilt & Magnetic Buttons */
  var TiltAndMagneticManager = (function () {
    function init() {
      if (!finePointer || reduce) return;
      var cardSel = '.stat, .panel, .acc, .goal, .budget, .modal-inner, .pal-box, .g-card-wrap';
      var btnSel = '.solid-btn, .add-btn, .ghost-btn, .end-btn, .fab, .jump-btn, .nav a, .link-btn, .monthnav button, .text-btn, .x, #theme-btn, #sound-btn';

      document.addEventListener('pointermove', function (e) {
        var card = e.target.closest(cardSel);
        if (card) {
          var r = card.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
          var rx = -((y - r.height / 2) / (r.height / 2)) * 8, ry = ((x - r.width / 2) / (r.width / 2)) * 8;
          card.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) scale3d(1.02,1.02,1.02) translateZ(6px)';
          card.style.transition = 'transform 0.08s ease-out';
          card.style.setProperty('--glare-x', ((x / r.width) * 100).toFixed(1) + '%');
          card.style.setProperty('--glare-y', ((y / r.height) * 100).toFixed(1) + '%');
        }
        var btn = e.target.closest(btnSel);
        if (btn) {
          var br = btn.getBoundingClientRect();
          btn.style.transform = 'translate3d(' + ((e.clientX - (br.left + br.width / 2)) * 0.3).toFixed(1) + 'px,' + ((e.clientY - (br.top + br.height / 2)) * 0.3).toFixed(1) + 'px,0) scale(1.05)';
          btn.style.transition = 'transform 0.08s ease-out';
        }
      }, { passive: true });

      document.addEventListener('pointerout', function (e) {
        var card = e.target.closest(cardSel);
        if (card && (!e.relatedTarget || !card.contains(e.relatedTarget))) {
          card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1) translateZ(0)';
          card.style.transition = 'transform 0.4s cubic-bezier(0.2,0.8,0.2,1)';
        }
        var btn = e.target.closest(btnSel);
        if (btn && (!e.relatedTarget || !btn.contains(e.relatedTarget))) {
          btn.style.transform = 'translate3d(0,0,0) scale(1)';
          btn.style.transition = 'transform 0.35s cubic-bezier(0.2,0.8,0.2,1)';
        }
      });
    }
    return { init: init };
  })();

  /* 5. Digital Number Decode */
  var NumberDecoder = (function () {
    var GLYPHS = '0123456789$₹€£%#*+-/!X_~';
    function scramble(el, targetText, duration) {
      if (!el || reduce) { if (el) el.textContent = targetText; return; }
      targetText = String(targetText || el.textContent || '').trim();
      if (!targetText) return;
      var len = targetText.length, startTime = performance.now(), lastSound = 0;
      duration = duration || 600;
      if (el._decodeRaf) cancelAnimationFrame(el._decodeRaf);
      function step(now) {
        var p = Math.min((now - startTime) / duration, 1), locked = Math.floor(p * len), out = '';
        for (var i = 0; i < len; i++) {
          var ch = targetText[i];
          out += (i < locked || ' ,.-+'.indexOf(ch) > -1) ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
        el.textContent = out;
        if (now - lastSound > 55 && p < 0.9) { Sound.play('decode'); lastSound = now; }
        if (p < 1) { el._decodeRaf = requestAnimationFrame(step); }
        else {
          el.textContent = targetText; el.classList.add('num-locked');
          setTimeout(function () { el.classList.remove('num-locked'); }, 350);
        }
      }
      el._decodeRaf = requestAnimationFrame(step);
    }
    function initObserver() {
      if (!('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && e.target.textContent && !e.target.dataset.decoded) {
            e.target.dataset.decoded = '1';
            scramble(e.target, e.target.textContent, 650);
          }
        });
      }, { threshold: 0.25 });
      document.querySelectorAll(NUM_SEL).forEach(function (el) { io.observe(el); });
    }
    function resetElementDecodedFlags() {
      document.querySelectorAll(NUM_SEL).forEach(function (el) {
        delete el.dataset.decoded;
        scramble(el, el.textContent, 550);
      });
    }
    return { scramble: scramble, initObserver: initObserver, resetElementDecodedFlags: resetElementDecodedFlags };
  })();

  /* 6. Scan-Line Reveals */
  var ScanlineReveal = (function () {
    var observer = null;
    function init() {
      if (!('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { trigger(entry.target); observer.unobserve(entry.target); }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
      scanDOM();
    }
    function scanDOM() {
      if (!observer) return;
      document.querySelectorAll('.tx-list .tx, .acc-list .acc, .goal-list .goal, .cats .cat').forEach(function (el, idx) {
        if (!el.classList.contains('scanned')) {
          el.classList.add('scan-ready');
          el.style.setProperty('--scan-delay', (idx % 8 * 0.05) + 's');
          observer.observe(el);
        }
      });
    }
    function trigger(el) {
      if (el.classList.contains('scanned')) return;
      el.classList.add('scanned');
      Sound.play('laser');
    }
    return { init: init, scanDOM: scanDOM, trigger: trigger };
  })();

  /* 7. Chart Animations */
  var ChartAnimations = (function () {
    function animateTrendBars() {
      var trend = document.getElementById('trend');
      if (!trend) return;
      [trend.querySelectorAll('.b-in'), trend.querySelectorAll('.b-out')].forEach(function (group, gIdx) {
        group.forEach(function (b, i) {
          var targetH = parseFloat(b.getAttribute('data-full-h') || b.getAttribute('height') || '0');
          var targetY = parseFloat(b.getAttribute('data-full-y') || b.getAttribute('y') || '0');
          b.setAttribute('data-full-h', String(targetH)); b.setAttribute('data-full-y', String(targetY));
          var base = targetY + targetH, start = performance.now() + (i * 70 + gIdx * 35), dur = 600;
          b.setAttribute('height', '0'); b.setAttribute('y', String(base));
          (function grow(now) {
            if (now < start) { requestAnimationFrame(grow); return; }
            var t = Math.min((now - start) / dur, 1), curH = targetH * (1 - Math.pow(1 - t, 3));
            b.setAttribute('height', Math.max(0, curH).toFixed(2));
            b.setAttribute('y', (base - curH).toFixed(2));
            if (t < 1) requestAnimationFrame(grow);
          })(performance.now());
        });
      });
    }
    function animateCalendarDots() {
      var cal = document.getElementById('cal');
      if (!cal) return;
      cal.querySelectorAll('.day i').forEach(function (dot, i) {
        dot.classList.remove('dot-pop'); void dot.offsetWidth;
        dot.style.setProperty('--pop-delay', (i * 12) + 'ms');
        dot.classList.add('dot-pop');
      });
    }
    function animateBudgetMeter() {
      document.querySelectorAll('#budget-cells i.f').forEach(function (cell, i) {
        cell.classList.remove('cell-lit'); void cell.offsetWidth;
        cell.style.setProperty('--lit-delay', (i * 16) + 'ms');
        cell.classList.add('cell-lit');
      });
    }
    function animateAll() { animateTrendBars(); animateCalendarDots(); animateBudgetMeter(); }
    function initObserver() {
      if (!('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) animateAll(); });
      }, { threshold: 0.2 });
      var m = document.getElementById('month'), ins = document.getElementById('insights');
      if (m) io.observe(m); if (ins) io.observe(ins);
    }
    return { animateAll: animateAll, initObserver: initObserver };
  })();

  /* 8. Coin & Confetti Particles Engine */
  var BurstEngine = (function () {
    var canvas, ctx, particles = [], running = false, W = 0, H = 0, dpr = 1;
    function getCanvas() {
      if (!canvas) {
        canvas = document.createElement('canvas'); canvas.id = 'fx-burst-canvas'; canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;width:100%;height:100%;';
        document.body.appendChild(canvas); ctx = canvas.getContext('2d');
        resize(); window.addEventListener('resize', resize, { passive: true });
      }
      return canvas;
    }
    function resize() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    function getSymbol() {
      try { if (window.EF && window.EF.Store && window.EF.Store.symbol) return window.EF.Store.symbol(); } catch (e) {}
      return '$';
    }
    function makeCoin(x, y, vx, vy, grav, r, decay, sym) {
      return {
        type: 'coin', x: x, y: y, vx: vx, vy: vy, gravity: grav || 0.4,
        radius: r, rotX: Math.random() * 3.14, rotY: Math.random() * 3.14,
        rotSpeedX: 0.12 + Math.random() * 0.2, rotSpeedY: 0.09 + Math.random() * 0.15,
        life: 1, decay: decay, symbol: sym
      };
    }
    function makeConfetti(x, y, vx, vy, grav, w, h, col, decay) {
      return {
        type: 'confetti', x: x, y: y, vx: vx, vy: vy, gravity: grav || 0.34,
        w: w, h: h, color: col, angle: Math.random() * 6.28,
        angleSpeed: (Math.random() - 0.5) * 0.28, scaleX: 1, life: 1, decay: decay
      };
    }

    function burstCoins(x, y, count) {
      getCanvas(); count = count || 24; x = x || W / 2; y = y || H / 2;
      var sym = getSymbol(); Sound.play('coin');
      for (var i = 0; i < count; i++) {
        var a = Math.random() * 6.28, s = 7 + Math.random() * 14;
        particles.push(makeCoin(x, y, Math.cos(a) * s, Math.sin(a) * s - 7, 0.4, 12 + Math.random() * 6, 0.009 + Math.random() * 0.008, sym));
      }
      kick();
    }
    function burstConfetti(x, y, count) {
      getCanvas(); count = count || 40; x = x || W / 2; y = y || H / 2;
      Sound.play('success');
      var colors = ['#ef4036', '#ffd700', '#f3a6b8', '#e8e5df', '#7ae6ff', '#ffffff'];
      for (var i = 0; i < count; i++) {
        var a = -1.57 + (Math.random() - 0.5) * 1.9, s = 9 + Math.random() * 18;
        particles.push(makeConfetti(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.34, 8 + Math.random() * 7, 14 + Math.random() * 9, colors[i % colors.length], 0.01 + Math.random() * 0.012));
      }
      kick();
    }
    function burstJackpot() {
      getCanvas(); Sound.play('jackpot');
      var sym = getSymbol(), colors = ['#ffd700', '#ffea70', '#ef4036', '#7ae6ff', '#e8e5df', '#ffffff'];
      for (var i = 0; i < 160; i++) {
        var px = Math.random() * W, py = -20 - Math.random() * 300;
        if (Math.random() > 0.42) {
          particles.push(makeCoin(px, py, (Math.random() - 0.5) * 6, 4 + Math.random() * 10, 0.3, 13 + Math.random() * 7, 0.004 + Math.random() * 0.005, sym));
        } else {
          particles.push(makeConfetti(px, py, (Math.random() - 0.5) * 9, 5 + Math.random() * 9, 0.24, 10 + Math.random() * 8, 18 + Math.random() * 12, colors[i % colors.length], 0.005 + Math.random() * 0.005));
        }
      }
      kick();
    }
    function kick() { if (!running) { running = true; requestAnimationFrame(render); } }
    function render() {
      if (!particles.length) { running = false; if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i]; p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.985;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
        if (p.type === 'coin') {
          p.rotX += p.rotSpeedX; p.rotY += p.rotSpeedY;
          ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.cos(p.rotX), 1);
          ctx.beginPath(); ctx.arc(0, 0, p.radius, 0, 6.28); ctx.fillStyle = '#ffb300'; ctx.fill();
          ctx.beginPath(); ctx.arc(0, 0, p.radius * 0.82, 0, 6.28); ctx.fillStyle = '#ffd54f'; ctx.fill();
          ctx.font = 'bold ' + Math.round(p.radius * 1.05) + 'px sans-serif'; ctx.fillStyle = '#5d4037'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.symbol, 0, 1); ctx.restore();
        } else {
          p.angle += p.angleSpeed;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle); ctx.scale(Math.cos(p.angle), 1);
          ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        }
      }
      ctx.restore(); requestAnimationFrame(render);
    }
    return { burstCoins: burstCoins, burstConfetti: burstConfetti, burstJackpot: burstJackpot };
  })();

  /* 9. Hover Text Scrambler */
  var TextScrambler = (function () {
    var CHARS = '!@#$%^&*()_+-=~[]{}|;:<>/?0123456789ABCDEF';
    function init() {
      var sel = '.nav a, .logo, .text-btn, .link-btn, .solid-btn, .ghost-btn, .add-btn, .chip, .end-btn';
      document.addEventListener('mouseover', function (e) {
        var el = e.target.closest(sel);
        if (!el || el._scrambling || reduce || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
        var textNode = null;
        for (var i = 0; i < el.childNodes.length; i++) {
          if (el.childNodes[i].nodeType === 3 && el.childNodes[i].nodeValue.trim()) { textNode = el.childNodes[i]; break; }
        }
        if (!textNode || !textNode.nodeValue || textNode.nodeValue.length < 2) return;
        var orig = textNode.nodeValue, frames = 0, max = 12;
        el._scrambling = true; Sound.play('hover');
        var timer = setInterval(function () {
          frames++;
          var scr = Math.floor((1 - frames / max) * orig.length), res = '';
          for (var k = 0; k < orig.length; k++) {
            res += (orig[k] === ' ' || k < orig.length - scr) ? orig[k] : CHARS[Math.floor(Math.random() * CHARS.length)];
          }
          textNode.nodeValue = res;
          if (frames >= max) { clearInterval(timer); textNode.nodeValue = orig; el._scrambling = false; }
        }, 22);
      });
    }
    return { init: init };
  })();

  /* 10. Scroll Progress Bar */
  var ScrollProgressBar = (function () {
    var fill = null;
    function init() {
      var bar = document.getElementById('scroll-progress');
      if (!bar) {
        bar = document.createElement('div'); bar.id = 'scroll-progress';
        bar.innerHTML = '<div id="scroll-progress-fill"></div>'; document.body.prepend(bar);
      }
      fill = document.getElementById('scroll-progress-fill');
      window.addEventListener('scroll', function () {
        if (!fill) return;
        var docH = document.documentElement.scrollHeight - window.innerHeight;
        fill.style.width = Math.min(100, Math.max(0, docH > 0 ? (window.scrollY / docH) * 100 : 0)).toFixed(2) + '%';
      }, { passive: true });
    }
    return { init: init };
  })();

  /* 11. Easter Eggs */
  var EasterEggs = (function () {
    var code = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'], idx = 0;
    var walletClicks = 0, timer = null;

    function init() {
      document.addEventListener('keydown', function (e) {
        var k = e.key.toLowerCase();
        idx = (k === code[idx]) ? idx + 1 : 0;
        if (idx === code.length) { triggerJackpot(); idx = 0; }
        if ((k === '$' || k === 'j') && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '') && !document.querySelector('dialog[open]')) {
          triggerJackpot();
        }
      });
      var hero = document.getElementById('top'), gateCard = document.getElementById('g-card'), logo = document.querySelector('.logo');
      if (hero) hero.addEventListener('click', function (e) { if (!e.target.closest('button, a, input, select')) handleWalletClick(e.clientX, e.clientY); });
      if (gateCard) gateCard.addEventListener('click', function (e) { handleWalletClick(e.clientX, e.clientY); });
      if (logo) logo.addEventListener('click', function (e) { BurstEngine.burstCoins(e.clientX, e.clientY, 10); });
    }
    function handleWalletClick(x, y) {
      walletClicks++; clearTimeout(timer); timer = setTimeout(function () { walletClicks = 0; }, 1400);
      BurstEngine.burstCoins(x || window.innerWidth / 2, y || window.innerHeight / 2, 18);
      BurstEngine.burstConfetti(x || window.innerWidth / 2, y || window.innerHeight / 2, 24);
      if (walletClicks >= 5) { walletClicks = 0; triggerGoldTycoon(); }
    }
    function triggerJackpot() {
      document.body.classList.add('jackpot-flash');
      setTimeout(function () { document.body.classList.remove('jackpot-flash'); }, 1200);
      BurstEngine.burstJackpot();
      document.dispatchEvent(new CustomEvent('ef:toast', { detail: 'JACKPOT ACTIVATED 💰 // FINANCIAL FREEDOM UNLOCKED' }));
    }
    function triggerGoldTycoon() {
      document.body.classList.toggle('gold-tycoon');
      Sound.play('jackpot'); BurstEngine.burstJackpot();
      document.dispatchEvent(new CustomEvent('ef:toast', {
        detail: document.body.classList.contains('gold-tycoon') ? 'GOLD TYCOON MODE UNLOCKED ✨ // 24K WALLET ACTIVATED' : 'STANDARD VAULT RESTORED'
      }));
    }
    return { init: init, handleWalletClick: handleWalletClick, triggerJackpot: triggerJackpot, triggerGoldTycoon: triggerGoldTycoon };
  })();

  function init() {
    ScrollProgressBar.init(); MarqueeManager.init(); DriftWordsManager.init();
    TiltAndMagneticManager.init(); NumberDecoder.initObserver(); ScanlineReveal.init();
    ChartAnimations.initObserver(); TextScrambler.init(); EasterEggs.init();
    var soundBtn = document.getElementById('sound-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', function () {
        var on = Sound.toggle();
        document.dispatchEvent(new CustomEvent('ef:toast', { detail: on ? 'Sound effects enabled 🔊' : 'Sound effects muted 🔇' }));
      });
      Sound.updateSoundUI();
    }
  }

  window.EF.FX = {
    init: init, sound: Sound.play, toggleSound: Sound.toggle, isSoundEnabled: Sound.isEnabled,
    burstCoins: BurstEngine.burstCoins, burstConfetti: BurstEngine.burstConfetti, burstJackpot: BurstEngine.burstJackpot,
    scrambleNumber: NumberDecoder.scramble,
    onMonthChange: function () {
      NumberDecoder.resetElementDecodedFlags(); ChartAnimations.animateAll(); ScanlineReveal.scanDOM(); Sound.play('laser');
    },
    onSaveEntry: function (x, y) {
      BurstEngine.burstCoins(x || window.innerWidth / 2, y || window.innerHeight / 2, 24);
      BurstEngine.burstConfetti(x || window.innerWidth / 2, y || window.innerHeight / 2, 32);
      Sound.play('success');
    },
    onGoalReached: function () { BurstEngine.burstJackpot(); Sound.play('jackpot'); },
    onWalletClick: EasterEggs.handleWalletClick,
    scanDOM: ScanlineReveal.scanDOM, animateCharts: ChartAnimations.animateAll
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
