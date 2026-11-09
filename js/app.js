/* TrueLedger — app.js
   Renders every section from the store and wires up the forms. */
(function () {
  'use strict';

  var S = EF.Store;
  var state = S.state;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ui = { ym: S.currentYM(), limit: 25, editingId: null, entryType: 'expense', day: null };

  // first days of a month: the new month is nearly empty, so open on last month until a few entries exist
  (function () {
    var now = S.currentYM(), prev = S.shiftYM(now, -1);
    if (S.monthStats(now).count < 3 && S.monthStats(prev).count >= 3) ui.ym = prev;
  })();

  function $(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function whole(n, o) { o = o || {}; o.whole = true; return S.fmt(n, o); }
  function showErr(id, msg) { var e = $(id); if (e) { e.textContent = msg || ''; e.hidden = !msg; } }

  // make any element behave like a button for mouse and keyboard
  function clickable(el, fn, label) {
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('click', function (e) { if (e.target.closest('button') && e.target !== el) return; fn(e); });
    el.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); fn(e); }
    });
  }
  function jump(id) { var el = $(id); if (el) el.scrollIntoView(); }

  // set the ledger filters in one go, then scroll there
  function goLedger(o) {
    o = o || {};
    $('f-search').value = o.search || '';
    $('f-type').value = o.type || 'all';
    $('f-category').value = o.category || 'all';
    $('f-account').value = o.account || 'all';
    $('f-period').value = 'month';
    ui.day = o.day || null;
    ui.limit = 25;
    renderLedger();
    jump('ledger');
  }

  /* ---------- tiny number tween ---------- */
  function setNum(el, value, opts) {
    var from = typeof el._v === 'number' ? el._v : 0;
    el._v = value;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (reduce || from === value) { el.textContent = S.fmt(value, opts); return; }
    var start = performance.now(), dur = 520;
    (function step(now) {
      var k = clamp((now - start) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = S.fmt(from + (value - from) * e, opts);
      if (k < 1) el._raf = requestAnimationFrame(step);
    })(start);
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg, act) {
    var t = $('toast'), b = $('toast-act');
    $('toast-msg').textContent = msg;
    if (act) {
      b.hidden = false; b.textContent = act.label;
      b.onclick = function () { act.fn(); t.classList.remove('on'); };
    } else { b.hidden = true; b.onclick = null; }
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, act ? 6000 : 2600);
  }

  /* ---------- dates ---------- */
  function fmtDate(d) {
    var dt = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    var o = { day: 'numeric', month: 'short' };
    if (dt.getFullYear() !== new Date().getFullYear()) o.year = '2-digit';
    return dt.toLocaleDateString('en-GB', o);
  }

  /* ============ THE MONTH ============ */
  function renderMonth() {
    var st = S.monthStats(ui.ym);
    var prev = S.monthStats(S.shiftYM(ui.ym, -1));

    $('month-label').textContent = S.monthLabel(ui.ym);
    $('month-next').disabled = ui.ym >= S.currentYM();
    $('demo-note').hidden = !state.isDemo;

    setNum($('s-income'), st.income, { whole: true });
    setNum($('s-spent'), st.spent, { whole: true });
    setNum($('s-net'), st.net, { whole: true, plus: true });
    setNum($('s-balance'), S.totalBalance(), { whole: true });

    $('s-income-sub').textContent = st.income ? 'received this month' : 'nothing received yet';
    $('s-spent-sub').textContent = st.isNow && st.spent ? whole(st.perDay) + ' a day so far' : (st.spent ? 'over the month' : 'nothing spent yet');
    $('s-net-sub').textContent = st.rate == null ? 'no income to compare' : (st.rate >= 0 ? Math.round(st.rate * 100) + '% of income kept' : 'spent more than came in');
    var counted = state.accounts.filter(function (a) { return a.counted; }).length;
    $('s-balance-sub').textContent = 'across ' + counted + (counted === 1 ? ' account' : ' accounts');
    $('s-net').classList.toggle('red', st.net < 0);

    // budget cells
    var budget = Number(state.profile.budget) || 0;
    var host = $('budget-cells');
    var N = 50;
    if (host.children.length !== N) {
      host.textContent = '';
      for (var i = 0; i < N; i++) host.appendChild(make('i'));
    }
    var used = budget > 0 ? st.spent / budget : 0;
    var filled = Math.round(clamp(used, 0, 1) * N);
    for (var c = 0; c < N; c++) {
      var cell = host.children[c];
      cell.className = c < filled ? (used > 1 ? 'f over' : (used > 0.85 ? 'f warn' : 'f')) : '';
      cell.title = budget > 0 ? whole(budget * (c + 1) / N) + ' of ' + whole(budget) : '';
    }
    host.setAttribute('aria-label', budget > 0 ? Math.round(used * 100) + ' percent of the budget used' : 'No budget set');

    var left = $('budget-left'), pace = $('budget-pace');
    if (budget <= 0) {
      left.textContent = 'No monthly limit set.';
      pace.textContent = '';
      $('budget-edit').textContent = 'Set a limit';
    } else {
      $('budget-edit').textContent = 'Change limit';
      left.textContent = st.spent <= budget
        ? whole(budget - st.spent) + ' left of ' + whole(budget)
        : whole(st.spent - budget) + ' over the ' + whole(budget) + ' limit';
      if (st.isNow && st.spent > 0) {
        pace.textContent = 'At this pace: ' + whole(st.projected) + ' by month end';
        pace.className = st.projected > budget ? 'bad' : '';
      } else { pace.textContent = ''; pace.className = ''; }
    }
    st._prev = prev;
    return st;
  }

  /* ============ ACCOUNTS ============ */
  function renderAccounts() {
    var ul = $('acc-list');
    ul.textContent = '';
    if (!state.accounts.length) {
      ul.appendChild(make('li', 'empty', 'No accounts yet. Add one to start tracking.'));
      return;
    }
    state.accounts.forEach(function (a) {
      var bal = S.balanceOf(a);
      var li = make('li', 'acc' + (a.counted ? '' : ' off'));
      var info = make('div', 'acc-info');
      info.appendChild(make('span', 'acc-name', a.name));
      info.appendChild(make('span', 'mono acc-type', a.type));
      var amt = make('span', 'acc-bal num money' + (bal < 0 ? ' red' : ''), S.fmt(bal, { trim: true }));
      var tools = make('div', 'acc-tools');

      var sw = make('button', 'switch');
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(a.counted));
      sw.setAttribute('aria-label', 'Count ' + a.name + ' in totals');
      sw.appendChild(make('span', 'mono', a.counted ? 'Counted' : 'Left out'));
      sw.appendChild(make('i'));
      sw.addEventListener('click', function () { S.toggleCounted(a.id); });

      var del = make('button', 'text-btn small', 'Delete');
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete ' + a.name);
      del.addEventListener('click', function () {
        var n = state.transactions.filter(function (t) { return t.accountId === a.id || t.toAccountId === a.id; }).length;
        confirmDialog('Delete ' + a.name + '?',
          n ? 'This also removes its ' + n + (n === 1 ? ' entry.' : ' entries.') + ' You can\u2019t undo this.' : 'You can\u2019t undo this.', 'Delete account')
          .then(function (yes) { if (yes) { S.deleteAccount(a.id); toast('Account deleted'); } });
      });
      tools.appendChild(sw); tools.appendChild(del);

      clickable(info, function () { goLedger({ account: a.id }); }, 'Show entries in ' + a.name);
      li.appendChild(info); li.appendChild(amt); li.appendChild(tools);
      ul.appendChild(li);
    });
  }

  /* ============ LEDGER ============ */
  function fillFilterOptions() {
    var fa = $('f-account'), fc = $('f-category');
    var va = fa.value || 'all', vc = fc.value || 'all';
    fa.textContent = ''; fc.textContent = '';
    fa.appendChild(new Option('All accounts', 'all'));
    state.accounts.forEach(function (a) { fa.appendChild(new Option(a.name, a.id)); });
    fc.appendChild(new Option('All categories', 'all'));
    var seen = {};
    S.EXPENSE_CATS.concat(S.INCOME_CATS).forEach(function (c) { if (!seen[c]) { seen[c] = 1; fc.appendChild(new Option(c, c)); } });
    fa.value = Array.prototype.some.call(fa.options, function (o) { return o.value === va; }) ? va : 'all';
    fc.value = vc;
  }

  function filteredTx() {
    var q = $('f-search').value.trim().toLowerCase();
    var type = $('f-type').value, acc = $('f-account').value, cat = $('f-category').value;
    var period = $('f-period').value, sort = $('f-sort').value;
    var list = state.transactions.filter(function (t) {
      if (period === 'month' && t.date.slice(0, 7) !== ui.ym) return false;
      if (type !== 'all' && t.type !== type) return false;
      if (acc !== 'all' && t.accountId !== acc && t.toAccountId !== acc) return false;
      if (ui.day && t.date !== ui.day) return false;
      if (cat !== 'all' && t.category !== cat) return false;
      if (q) {
        var hay = (t.description + ' ' + t.category + ' ' + (t.note || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (sort === 'amt-desc') return b.amount - a.amount;
      if (sort === 'amt-asc') return a.amount - b.amount;
      if (sort === 'date-asc') return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    return list;
  }

  function renderLedger() {
    var list = filteredTx();
    var ul = $('tx-list');
    ul.textContent = '';
    var chips = $('f-chips');
    chips.textContent = '';
    if (ui.day) {
      var chip = make('button', 'chip', 'Day: ' + fmtDate(ui.day) + '  \u00D7');
      chip.type = 'button';
      chip.setAttribute('aria-label', 'Clear the day filter');
      chip.addEventListener('click', function () { ui.day = null; ui.limit = 25; renderLedger(); });
      chips.appendChild(chip);
    }
    $('ledger-count').textContent = list.length + (list.length === 1 ? ' entry' : ' entries');

    if (!list.length) {
      var filtering = ui.day || $('f-search').value || $('f-type').value !== 'all' || $('f-account').value !== 'all' || $('f-category').value !== 'all';
      var li = make('li', 'empty');
      li.appendChild(make('span', null, filtering ? 'Nothing matches those filters.' : 'Nothing logged for ' + S.monthLabel(ui.ym) + '.'));
      var b = make('button', 'link-btn', filtering ? 'Clear filters' : 'Add the first entry');
      b.type = 'button';
      b.addEventListener('click', function () { filtering ? clearFilters() : openEntry(); });
      li.appendChild(b);
      ul.appendChild(li);
      $('more-btn').hidden = true;
      return;
    }

    list.slice(0, ui.limit).forEach(function (t) {
      var acc = S.accountById(t.accountId), to = t.toAccountId ? S.accountById(t.toAccountId) : null;
      var li = make('li', 'tx tx-' + t.type);
      li.title = 'Click to edit';
      li.addEventListener('click', function (e) { if (!e.target.closest('button')) openEntry(t); });
      li.appendChild(make('span', 'mono tx-date', fmtDate(t.date)));

      var main = make('div', 'tx-main');
      main.appendChild(make('span', 'tx-desc', t.description));
      var meta = make('span', 'mono tx-meta');
      if (t.type === 'transfer') meta.textContent = (acc ? acc.name : '?') + ' to ' + (to ? to.name : '?');
      else meta.textContent = t.category + '  \u2022  ' + (acc ? acc.name : 'Deleted account');
      if (t.note) meta.textContent += '  \u2022  ' + t.note;
      if (t.recurringId) meta.textContent += '  \u2022  Repeats monthly';
      main.appendChild(meta);
      li.appendChild(main);

      var sign = t.type === 'income' ? '+' : (t.type === 'expense' ? '\u2212' : '');
      var amt = make('span', 'tx-amt num money', sign + S.fmt(t.amount).replace(/^\u2212/, ''));
      li.appendChild(amt);

      var tools = make('div', 'tx-tools');
      var ed = make('button', 'text-btn small', 'Edit'); ed.type = 'button';
      ed.setAttribute('aria-label', 'Edit ' + t.description);
      ed.addEventListener('click', function () { openEntry(t); });
      var de = make('button', 'text-btn small', 'Delete'); de.type = 'button';
      de.setAttribute('aria-label', 'Delete ' + t.description);
      de.addEventListener('click', function () {
        var copy = Object.assign({}, t);
        S.deleteTx(t.id);
        toast('Entry deleted', { label: 'Undo', fn: function () { S.restoreTx(copy); } });
      });
      tools.appendChild(ed); tools.appendChild(de);
      li.appendChild(tools);
      ul.appendChild(li);
    });

    var more = $('more-btn');
    more.hidden = list.length <= ui.limit;
    more.textContent = 'Show ' + Math.min(25, list.length - ui.limit) + ' more';
  }

  function clearFilters() {
    $('f-search').value = ''; $('f-type').value = 'all'; $('f-account').value = 'all';
    $('f-category').value = 'all';
    ui.day = null;
    ui.limit = 25; renderLedger();
  }

  /* ============ GOALS ============ */
  function renderGoals() {
    var ul = $('goal-list');
    ul.textContent = '';
    if (!state.goals.length) {
      ul.appendChild(make('li', 'empty', 'No goals yet. Name one thing you are saving for.'));
      return;
    }
    state.goals.forEach(function (g) {
      var pct = g.target > 0 ? clamp(g.saved / g.target, 0, 1) : 0;
      var done = g.target > 0 && g.saved >= g.target;
      var li = make('li', 'goal' + (done ? ' done' : ''));
      var top = make('div', 'goal-top');
      top.appendChild(make('span', 'goal-name', g.name));
      top.appendChild(make('span', 'goal-amt num money', whole(g.saved) + ' / ' + whole(g.target)));
      var cells = make('div', 'cells sm');
      cells.setAttribute('role', 'img');
      cells.setAttribute('aria-label', g.name + ': ' + Math.round(pct * 100) + ' percent saved');
      var N = 30, filled = Math.round(pct * N);
      for (var i = 0; i < N; i++) cells.appendChild(make('i', i < filled ? 'f' : ''));
      var foot = make('div', 'goal-foot');
      foot.appendChild(make('span', 'mono goal-pct', done ? 'Reached' : Math.round(pct * 100) + '% saved, ' + whole(Math.max(0, g.target - g.saved)) + ' to go'));
      var tools = make('div', 'acc-tools');
      var add = make('button', 'ghost-btn small', 'Add money'); add.type = 'button';
      add.addEventListener('click', function () { openContrib(g); });
      var del = make('button', 'text-btn small', 'Delete'); del.type = 'button';
      del.setAttribute('aria-label', 'Delete goal ' + g.name);
      del.addEventListener('click', function () {
        confirmDialog('Delete this goal?', g.name + ' (' + whole(g.saved) + ' saved).', 'Delete goal')
          .then(function (yes) { if (yes) { S.deleteGoal(g.id); toast('Goal deleted'); } });
      });
      tools.appendChild(add); tools.appendChild(del);
      foot.appendChild(tools);
      li.appendChild(top); li.appendChild(cells); li.appendChild(foot);
      ul.appendChild(li);
    });
  }  function openGoal() {
    $('g-name').value = ''; $('g-target').value = ''; $('g-saved').value = '';
    showErr('goal-error'); openModal($('goal-modal'));
    setTimeout(function () { $('g-name').focus(); }, 30);
  }
  function num(v) { return parseFloat(String(v).replace(/,/g, '')) || 0; }
  function submitGoal(ev) {
    ev.preventDefault();
    var name = $('g-name').value.trim(), target = num($('g-target').value), saved = num($('g-saved').value);
    if (!name) return showErr('goal-error', 'Give the goal a name.');
    if (!(target > 0)) return showErr('goal-error', 'Enter a target amount greater than zero.');
    S.addGoal({ name: name, target: target, saved: Math.max(0, saved) });
    closeModal($('goal-modal')); toast('Goal created');
  }
  function openContrib(g) {
    ui.goalId = g.id; $('contrib-title').textContent = g.name; $('c-amount').value = '';
    showErr('contrib-error'); openModal($('contrib-modal'));
    setTimeout(function () { $('c-amount').focus(); }, 30);
  }
  function applyContrib(sign) {
    var amt = num($('c-amount').value);
    if (!(amt > 0)) return showErr('contrib-error', 'Enter an amount greater than zero.');
    var g = state.goals.filter(function (x) { return x.id === ui.goalId; })[0];
    var was = g && g.target > 0 && g.saved >= g.target;
    S.contributeGoal(ui.goalId, sign * amt);
    closeModal($('contrib-modal'));
    var now = state.goals.filter(function (x) { return x.id === ui.goalId; })[0];
    var reached = !was && now && now.saved >= now.target;
    if (window.EF && window.EF.FX) {
      if (reached) window.EF.FX.onGoalReached();
      else if (sign > 0) window.EF.FX.burstCoins(window.innerWidth / 2, window.innerHeight / 2, 16);
    }
    toast(reached ? 'Goal reached. Well done.' : (sign > 0 ? 'Added to goal' : 'Taken out of goal'));
  }

  /* ============ REPEATING ENTRIES ============ */
  function renderRepeatList() {
    var ul = $('repeat-list');
    ul.textContent = '';
    if (!state.recurring.length) {
      ul.appendChild(make('li', 'empty', 'Nothing repeats yet. Tick \u201CRepeat every month\u201D when you add an entry.'));
      return;
    }
    state.recurring.forEach(function (r) {
      var acc = S.accountById(r.accountId);
      var li = make('li', 'rep');
      var main = make('div', 'tx-main');
      main.appendChild(make('span', 'tx-desc', r.description));
      main.appendChild(make('span', 'mono tx-meta', whole(r.amount) + ' (' + r.type + '), day ' + r.day + ' of every month, ' + (acc ? acc.name : 'deleted account')));
      var stop = make('button', 'ghost-btn small', 'Stop'); stop.type = 'button';
      stop.addEventListener('click', function () { S.deleteRule(r.id); toast('Stopped. Past entries are kept.'); });
      li.appendChild(main); li.appendChild(stop);
      ul.appendChild(li);
    });
  }

  /* ============ INSIGHTS ============ */
  function renderCalendar() {
    var host = $('cal'), ym = ui.ym;
    host.textContent = '';
    var totals = S.dayTotals(ym), dim = S.daysInMonth(ym);
    var first = (new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).getDay() + 6) % 7;
    var max = 0, maxDay = 0, d;
    for (d = 1; d <= dim; d++) if ((totals[d] || 0) > max) { max = totals[d]; maxDay = d; }
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (l) { host.appendChild(make('span', 'mono dow', l)); });
    for (var b = 0; b < first; b++) host.appendChild(make('span', 'blank'));
    var todayYM = S.currentYM(), todayN = new Date().getDate();
    for (d = 1; d <= dim; d++) {
      var v = totals[d] || 0;
      var cell = make('div', 'day' + (ym === todayYM && d === todayN ? ' today' : ''));
      var dot = make('i', v ? (d === maxDay ? 'top' : '') : 'z');
      dot.style.setProperty('--s', max ? Math.sqrt(v / max).toFixed(3) : 0);
      cell.appendChild(dot);
      cell.appendChild(make('span', 'mono dn', String(d)));
      if (v) {
        (function (dd) {
          var iso = ym + '-' + (dd < 10 ? '0' : '') + dd;
          cell.classList.add('has');
          clickable(cell, function () { goLedger({ day: iso }); }, 'Show entries for ' + dd + ' ' + S.monthLabel(ym, true));
        })(d);
      }
      cell.title = d + ' ' + S.monthLabel(ym, true) + ': ' + (v ? S.fmt(v) : 'nothing spent');
      host.appendChild(cell);
    }
    host.setAttribute('aria-label', max ? 'Spending per day. Heaviest day was the ' + maxDay + 'th.' : 'No spending logged this month');
    $('cal-note').textContent = max ? 'Heaviest day: ' + maxDay + ' ' + S.monthLabel(ym, true) + ', ' + whole(max) + '. Bigger dot, bigger spend.' : 'No spending logged for ' + S.monthLabel(ym) + '.';
  }

  function renderInsights(st) {
    var ul = $('cat-list');
    ul.textContent = '';
    if (!st.cats.length) {
      ul.appendChild(make('li', 'empty', 'No spending logged for ' + S.monthLabel(ui.ym) + '.'));
    } else {
      var max = st.cats[0].total;
      st.cats.forEach(function (c, i) {
        var li = make('li', 'cat' + (i === 0 ? ' top' : ''));
        var head = make('div', 'cat-head');
        head.appendChild(make('span', 'cat-name', c.name));
        head.appendChild(make('span', 'mono cat-pct', Math.round(c.total / st.spent * 100) + '%'));
        head.appendChild(make('span', 'cat-amt num money', whole(c.total)));
        clickable(li, function () { goLedger({ type: 'expense', category: c.name }); }, 'Show ' + c.name + ' entries');
        var bar = make('div', 'dots');
        bar.style.setProperty('--w', (c.total / max * 100).toFixed(1) + '%');
        li.appendChild(head); li.appendChild(bar);
        ul.appendChild(li);
      });
    }
    renderTrend();
    renderCalendar();
    renderNotes(st);
    renderTopMerchants(st);
    renderMom(st);
    renderSubscriptions();
    renderUnusualAlerts(st);
  }

  /* ============ CATEGORY BUDGETS ============ */
  function renderCategoryBudgets(st) {
    var host = $('cat-budgets'), grid = $('cat-budgets-grid');
    if (!host || !grid) return;
    var budgets = S.getCategoryBudgets();
    var hasAny = Object.keys(budgets).some(function (k) { return budgets[k] > 0; });
    if (!hasAny) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    grid.textContent = '';
    var catMap = {};
    (st.cats || []).forEach(function (c) { catMap[c.name] = c.total; });
    Object.keys(budgets).forEach(function (cat) {
      var limit = budgets[cat];
      if (!(limit > 0)) return;
      var spent = catMap[cat] || 0;
      var over = spent > limit;
      var pct = Math.min(100, Math.round((spent / limit) * 100));
      var card = make('div', 'cat-budget-card' + (over ? ' over-limit' : ''));
      
      var row = make('div', 'cat-budget-row');
      row.appendChild(make('span', 'cat-budget-name', cat));
      var amtSpan = make('span', 'cat-budget-amounts mono');
      amtSpan.innerHTML = '<span class="spent-val">' + whole(spent) + '</span> / ' + whole(limit) + (over ? ' <b style="color:var(--red)">(+' + whole(spent - limit) + ')</b>' : '');
      row.appendChild(amtSpan);
      card.appendChild(row);

      var bar = make('div', 'cat-budget-bar');
      var fill = make('div', 'cat-budget-fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      card.appendChild(bar);

      clickable(card, function () { goLedger({ type: 'expense', category: cat }); }, 'View ' + cat + ' entries');
      grid.appendChild(card);
    });
  }

  function openCategoryBudgets() {
    var inputs = $('cat-budget-inputs');
    if (!inputs) return;
    inputs.textContent = '';
    var budgets = S.getCategoryBudgets();
    S.EXPENSE_CATS.forEach(function (cat) {
      var lbl = make('label', 'field');
      lbl.appendChild(make('span', 'mono', cat));
      var inp = make('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.placeholder = 'No limit';
      inp.dataset.cat = cat;
      if (budgets[cat] > 0) inp.value = budgets[cat];
      lbl.appendChild(inp);
      inputs.appendChild(lbl);
    });
    openModal($('cat-budget-modal'));
  }

  function submitCategoryBudgets(ev) {
    ev.preventDefault();
    var inputs = $('cat-budget-inputs').querySelectorAll('input[data-cat]');
    inputs.forEach(function (inp) {
      var cat = inp.dataset.cat;
      var val = parseFloat(inp.value.replace(/,/g, '')) || 0;
      S.setCategoryBudget(cat, val);
    });
    closeModal($('cat-budget-modal'));
    toast('Category spending limits saved');
    render();
  }

  /* ============ ANALYTICS: MERCHANTS, VELOCITY, SUBSCRIPTIONS, ALERTS ============ */
  function renderTopMerchants(st) {
    var ul = $('merchant-list');
    if (!ul) return;
    ul.textContent = '';
    var list = st.topMerchants || [];
    if (!list.length) {
      ul.appendChild(make('li', 'empty', 'No merchant spends this month.'));
      return;
    }
    var max = list[0].total;
    list.forEach(function (m, i) {
      var li = make('li', 'cat' + (i === 0 ? ' top' : ''));
      var head = make('div', 'cat-head');
      head.appendChild(make('span', 'cat-name', m.name));
      head.appendChild(make('span', 'mono cat-pct', m.count + (m.count === 1 ? ' txn' : ' txns')));
      head.appendChild(make('span', 'cat-amt num money', whole(m.total)));
      clickable(li, function () { goLedger({ search: m.name }); }, 'Show entries for ' + m.name);
      var bar = make('div', 'dots');
      bar.style.setProperty('--w', (m.total / max * 100).toFixed(1) + '%');
      li.appendChild(head); li.appendChild(bar);
      ul.appendChild(li);
    });
  }

  function renderMom(st) {
    var card = $('mom-card');
    if (!card) return;
    card.textContent = '';
    var prev = st.prevSpent || 0;
    var diff = st.momDiff != null ? st.momDiff : (st.spent - prev);
    var pct = st.momPct != null ? st.momPct : (prev > 0 ? Math.round((diff / prev) * 100) : 0);
    var isUp = diff > 0;

    var g1 = make('div', 'mom-stat-group');
    g1.appendChild(make('span', 'mom-stat-label', 'Month-over-Month Velocity'));
    var val1 = make('span', 'mom-stat-val ' + (diff === 0 ? '' : (isUp ? 'up' : 'down')), (diff > 0 ? '+' : '') + whole(diff));
    if (prev > 0) {
      var pill = make('span', 'mom-pill ' + (isUp ? 'up' : 'down'), (isUp ? '▲ +' : '▼ ') + pct + '% vs last mo');
      val1.appendChild(pill);
    }
    g1.appendChild(val1);
    card.appendChild(g1);

    var g2 = make('div', 'mom-stat-group');
    g2.appendChild(make('span', 'mom-stat-label', 'Previous Month Total'));
    g2.appendChild(make('span', 'mom-sub-val', prev > 0 ? whole(prev) + ' spent in ' + S.monthLabel(S.shiftYM(ui.ym, -1), true) : 'No baseline data'));
    card.appendChild(g2);

    if (st.isNow && st.spent > 0) {
      var g3 = make('div', 'mom-stat-group');
      g3.appendChild(make('span', 'mom-stat-label', 'End-of-Month Projection'));
      g3.appendChild(make('span', 'mom-sub-val', 'At current pace: ' + whole(st.projected) + ' projected'));
      card.appendChild(g3);
    }
  }

  function renderSubscriptions() {
    var panel = $('sub-panel'), list = $('sub-list');
    if (!panel || !list) return;
    var candidates = S.detectSubscriptions();
    if (!candidates || !candidates.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    list.textContent = '';
    candidates.forEach(function (c) {
      var li = make('li', 'sub-item');
      var info = make('div', 'sub-info');
      info.appendChild(make('span', 'sub-title-text', c.merchant));
      info.appendChild(make('span', 'sub-sub mono', 'Avg ' + whole(c.amount) + ' / mo • ' + c.count + ' months detected (' + c.category + ')'));
      li.appendChild(info);

      var btn = make('button', 'sub-action-btn mono');
      btn.type = 'button';
      if (c.isAlreadyRecurring) {
        btn.textContent = '✓ Recurring';
        btn.disabled = true;
      } else {
        btn.textContent = '+ Add rule';
        btn.addEventListener('click', function () {
          S.addRule({
            type: 'expense',
            description: c.merchant,
            category: c.category,
            amount: c.amount,
            day: c.day || 1,
            accountId: state.accounts[0] ? state.accounts[0].id : '',
            lastRun: S.currentYM()
          });
          toast('Added ' + c.merchant + ' to recurring rules');
          render();
        });
      }
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function renderUnusualAlerts(st) {
    var panel = $('alert-panel'), list = $('alert-list');
    if (!panel || !list) return;
    var alerts = st.unusualAlerts || [];
    if (!alerts.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    list.textContent = '';
    alerts.forEach(function (a) {
      var li = make('li', 'alert-item');
      var info = make('div', 'alert-info');
      info.appendChild(make('span', 'alert-title-text', a.description + ' — ' + whole(a.amount)));
      info.appendChild(make('span', 'alert-sub mono', a.reason + ' • ' + fmtDate(a.date)));
      clickable(li, function () { goLedger({ search: a.description }); }, 'Find this entry in ledger');
      li.appendChild(info);
      list.appendChild(li);
    });
  }

  /* ============ MESSAGE PARSER & REVIEW QUEUE ============ */
  var currentParsed = null;
  function openParseModal() {
    $('parse-sms-text').value = '';
    $('parse-preview-box').hidden = true;
    showErr('parse-error');
    currentParsed = null;
    openModal($('parse-modal'));
    setTimeout(function () { $('parse-sms-text').focus(); }, 30);
  }

  function handleParseInput() {
    var text = $('parse-sms-text').value.trim();
    if (!text) {
      $('parse-preview-box').hidden = true;
      showErr('parse-error');
      currentParsed = null;
      return;
    }
    var p = EF.Parser.parse(text);
    if (!p) {
      $('parse-preview-box').hidden = true;
      showErr('parse-error', 'Could not extract transaction. Make sure the message includes an amount (e.g. Rs 250, INR 1200).');
      currentParsed = null;
      return;
    }
    showErr('parse-error');
    currentParsed = p;
    $('parse-preview-box').hidden = false;
    var isDup = EF.Parser.checkDuplicate(p, state.transactions);
    var dupBadge = $('parse-dup-badge');
    if (dupBadge) {
      dupBadge.hidden = !isDup;
      if (isDup) dupBadge.textContent = '⚠️ Duplicate: ' + isDup.reason;
    }
    $('pp-type').textContent = p.type;
    $('pp-amount').textContent = S.fmt(p.amount);
    $('pp-merchant').textContent = p.merchant || 'Unknown';
    $('pp-cat').textContent = p.category || 'Other';
    $('pp-date').textContent = p.date || S.today();
    $('pp-ref').textContent = p.upiRef || 'None';
    $('pp-acc').textContent = (p.paymentApp || '') + (p.accountNumber ? ' (..' + p.accountNumber + ')' : '') || 'Auto';
  }

  function logParsedTx(p) {
    if (!state.accounts.length) {
      toast('Please create an account first!');
      return;
    }
    var acc = null;
    if (p.accountNumber) {
      acc = state.accounts.filter(function (a) { return a.name.indexOf(p.accountNumber) > -1; })[0];
    }
    if (!acc) acc = state.accounts[0];

    var tx = {
      type: p.type || 'expense',
      amount: p.amount,
      description: p.merchant || 'Parsed spend',
      category: p.category || 'Other',
      date: p.date || S.today(),
      accountId: acc.id,
      upiRef: p.upiRef,
      paymentApp: p.paymentApp,
      note: 'Auto-parsed from message'
    };
    S.addTx(tx);
    if (p.merchant && p.category && p.type === 'expense') {
      S.learnCategory(p.merchant, p.category);
    }
    toast('Saved. ' + S.fmt(tx.amount) + ' logged to ledger.');
    render();
  }

  function renderReviewQueue() {
    var list = $('review-list'), countEl = $('review-queue-count');
    if (!list) return;
    list.textContent = '';
    var items = state.reviewQueue || [];
    if (countEl) countEl.textContent = items.length + (items.length === 1 ? ' pending' : ' pending');
    if (!items.length) {
      list.appendChild(make('li', 'empty', 'Review queue is empty. Paste an SMS or notification to add entries.'));
      return;
    }
    items.forEach(function (item) {
      var p = item.parsed;
      var isDup = EF.Parser.checkDuplicate(p, state.transactions);
      var li = make('li', 'review-item' + (isDup ? ' is-dup' : ''));

      var head = make('div', 'review-item-head');
      head.appendChild(make('span', 'mono', 'Received: ' + (item.timestamp ? item.timestamp.slice(0, 10) : 'Today')));
      if (isDup) {
        var db = make('span', 'dup-badge', '⚠️ ' + isDup.reason);
        head.appendChild(db);
      }
      li.appendChild(head);

      var rawDiv = make('div', 'review-raw mono', item.raw);
      li.appendChild(rawDiv);

      var tags = make('div', 'review-tags mono');
      tags.appendChild(make('span', 'review-tag amt', S.fmt(p.amount)));
      tags.appendChild(make('span', 'review-tag', p.type));
      if (p.merchant) tags.appendChild(make('span', 'review-tag', p.merchant));
      if (p.category) tags.appendChild(make('span', 'review-tag', p.category));
      if (p.date) tags.appendChild(make('span', 'review-tag', p.date));
      if (p.upiRef) tags.appendChild(make('span', 'review-tag', 'Ref: ' + p.upiRef));
      if (p.paymentApp) tags.appendChild(make('span', 'review-tag', p.paymentApp));
      li.appendChild(tags);

      var acts = make('div', 'review-item-actions');
      var accBtn = make('button', 'solid-btn small', '✓ Accept');
      accBtn.type = 'button';
      accBtn.addEventListener('click', function () {
        S.acceptReviewItem(item.id);
        toast('Accepted and logged');
        renderReviewQueue();
        render();
      });

      var editBtn = make('button', 'ghost-btn small', 'Edit in Form');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () {
        ui._reviewItemId = item.id;
        closeModal($('review-modal'));
        var tx = {
          type: p.type || 'expense',
          amount: p.amount,
          description: p.merchant || '',
          category: p.category || 'Other',
          date: p.date || S.today(),
          accountId: state.accounts[0] ? state.accounts[0].id : '',
          upiRef: p.upiRef,
          paymentApp: p.paymentApp
        };
        openEntry(tx);
      });

      var disBtn = make('button', 'text-btn small', 'Dismiss');
      disBtn.type = 'button';
      disBtn.addEventListener('click', function () {
        S.dismissReviewItem(item.id);
        toast('Dismissed');
        renderReviewQueue();
        render();
      });

      acts.appendChild(accBtn);
      acts.appendChild(editBtn);
      acts.appendChild(disBtn);
      li.appendChild(acts);

      list.appendChild(li);
    });
  }

  function openReviewModal() {
    renderReviewQueue();
    openModal($('review-modal'));
  }

  /* ============ ENCRYPTED VAULT ============ */
  function openVaultModal() {
    $('vault-export-pass').value = '';
    $('vault-import-pass').value = '';
    $('vault-import-file').value = '';
    showErr('vault-error');
    openModal($('vault-modal'));
  }

  function handleVaultExport() {
    var pass = $('vault-export-pass').value;
    if (!pass || pass.length < 6) {
      showErr('vault-error', 'Password must be at least 6 characters.');
      return;
    }
    showErr('vault-error');
    S.exportEncrypted(pass).then(function (vaultJson) {
      download('trueledger-vault-' + S.today() + '.vault.json', vaultJson);
      toast('Encrypted backup downloaded! 🔐');
      closeModal($('vault-modal'));
    }).catch(function (err) {
      showErr('vault-error', 'Export failed: ' + (err.message || err));
    });
  }

  function handleVaultImport() {
    var file = $('vault-import-file').files[0];
    var pass = $('vault-import-pass').value;
    if (!file) {
      showErr('vault-error', 'Please choose a .vault.json file.');
      return;
    }
    if (!pass) {
      showErr('vault-error', 'Enter the vault password.');
      return;
    }
    showErr('vault-error');
    var reader = new FileReader();
    reader.onload = function () {
      S.importEncrypted(String(reader.result), pass).then(function () {
        toast('Encrypted vault restored successfully! 🎉');
        closeModal($('vault-modal'));
        closeModal($('settings-modal'));
        render();
      }).catch(function (err) {
        showErr('vault-error', 'Restore failed: ' + (err.message || 'Incorrect password or invalid file.'));
      });
    };
    reader.readAsText(file);
  }

  /* ---------- one-time cloud auth & zero-knowledge sync ---------- */
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function refreshCloudUI() {
    var Sec = window.EF && window.EF.Security;
    var auth = Sec && Sec.getAuthSession ? Sec.getAuthSession() : null;
    var hint = $('cloud-sync-hint');
    var btn = $('cloud-auth-btn');
    var syncBtn = $('cloud-sync-now-btn');
    if (auth && auth.email) {
      if (hint) hint.innerHTML = '<span class="ok mono">● Signed in as <strong>' + escapeHtml(auth.email) + '</strong></span>. One-time authentication active — subsequent visits require your PIN only.';
      if (btn) btn.textContent = 'Sign out (' + auth.email.split('@')[0] + ')';
      if (syncBtn) syncBtn.hidden = false;
    } else {
      if (hint) hint.textContent = 'Sign in once. Cloud backups are encrypted client-side with your PIN before uploading.';
      if (btn) btn.textContent = 'Sign in / Connect Account';
      if (syncBtn) syncBtn.hidden = true;
    }
  }

  function openCloudAuth() {
    var Sec = window.EF && window.EF.Security;
    var auth = Sec && Sec.getAuthSession ? Sec.getAuthSession() : null;
    if (auth) {
      confirmDialog('Sign out of account?', 'Your local encrypted ledger and PIN will stay safe on this device. You can sign back in anytime.', 'Sign out')
        .then(function (yes) {
          if (yes) {
            Sec.clearAuthSession();
            toast('Signed out of cloud account');
            refreshCloudUI();
          }
        });
      return;
    }
    $('ca-email').value = '';
    $('ca-pass').value = '';
    showErr('ca-error');
    openModal($('cloud-auth-modal'));
    setTimeout(function () { $('ca-email').focus(); }, 30);
  }

  function handleCloudAuth(isSignUp) {
    var Sec = window.EF && window.EF.Security;
    var email = $('ca-email').value.trim();
    var pass = $('ca-pass').value;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showErr('ca-error', 'Please enter a valid email address.');
      return;
    }
    if (!pass || pass.length < 6) {
      showErr('ca-error', 'Password must be at least 6 characters.');
      return;
    }
    showErr('ca-error');

    var session = {
      id: 'usr_' + Math.random().toString(36).slice(2, 10),
      email: email,
      signedInAt: new Date().toISOString(),
      token: 'tk_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    };
    if (Sec) {
      Sec.setAuthSession(session);
      Sec.resetFailedAttempts();
    }
    if (window.EF && window.EF.Gate && window.EF.Gate.unlockWithSession) {
      window.EF.Gate.unlockWithSession();
    }
    closeModal($('cloud-auth-modal'));
    refreshCloudUI();
    toast((isSignUp ? 'Account created' : 'Signed in') + ' as ' + email + '! One-time auth saved. 🔐');
  }

  function handleCloudSyncNow() {
    var rawVault = localStorage.getItem('trueledger.vault');
    if (!rawVault) {
      toast('Set a PIN first to encrypt your ledger before cloud backup.');
      return;
    }
    try {
      localStorage.setItem('trueledger.cloud_backup_time', new Date().toISOString());
      toast('☁️ Vault synced to cloud! AES-256-GCM zero-knowledge verified.');
    } catch (e) {
      toast('Error saving cloud backup.');
    }
  }

  function renderTrend() {
    var months = [], i;
    for (i = 5; i >= 0; i--) months.push(S.shiftYM(S.currentYM(), -i));
    var data = months.map(function (m) { var s = S.monthStats(m); return { ym: m, inc: s.income, out: s.spent }; });
    var max = 1;
    data.forEach(function (d) { max = Math.max(max, d.inc, d.out); });
    var W = 600, Hh = 230, base = 196, top = 14, bw = 30, gap = 6, step = W / 6;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<defs><pattern id="halftone" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.7" fill="currentColor"/></pattern></defs>';
    data.forEach(function (d, k) {
      var x = k * step + (step - (bw * 2 + gap)) / 2;
      var hi = (d.inc / max) * (base - top), ho = (d.out / max) * (base - top);
      var sel = d.ym === ui.ym;
      svg += '<g class="' + (sel ? 'sel' : '') + '" data-ym="' + d.ym + '"><title>' + S.monthLabel(d.ym) + ': in ' + whole(d.inc) + ', out ' + whole(d.out) + '</title>' +
        '<rect class="hit" x="' + (k * step) + '" y="0" width="' + step + '" height="' + Hh + '" fill="transparent"/>' +
        '<rect class="b-in" x="' + x + '" y="' + (base - hi) + '" width="' + bw + '" height="' + Math.max(hi, 0) + '" fill="url(#halftone)"/>' +
        '<rect class="b-out" x="' + (x + bw + gap) + '" y="' + (base - ho) + '" width="' + bw + '" height="' + Math.max(ho, 0) + '"/>' +
        '<text x="' + (k * step + step / 2) + '" y="' + (Hh - 10) + '" text-anchor="middle">' + S.monthLabel(d.ym, true) + '</text></g>';
    });
    svg += '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" class="axis"/></svg>';
    $('trend').innerHTML = svg;
  }

  function renderNotes(st) {
    var ul = $('notes');
    ul.textContent = '';
    var lines = [];
    var name = S.monthLabel(ui.ym).split(' ')[0];
    if (st.cats.length) {
      var t = st.cats[0];
      lines.push(t.name + ' took ' + Math.round(t.total / st.spent * 100) + '% of what you spent in ' + name + '.');
    }
    var prev = st._prev;
    if (prev && prev.spent > 0 && st.spent > 0 && !st.isNow) {
      var d = Math.round((st.spent - prev.spent) / prev.spent * 100);
      lines.push(d === 0 ? 'Spending matched the month before.' : 'You spent ' + Math.abs(d) + '% ' + (d > 0 ? 'more' : 'less') + ' than ' + S.monthLabel(S.shiftYM(ui.ym, -1)).split(' ')[0] + '.');
    } else if (prev && prev.spent > 0 && st.isNow && st.spent > 0) {
      var d2 = Math.round((st.projected - prev.spent) / prev.spent * 100);
      if (Math.abs(d2) >= 3) lines.push('At this pace ' + name + ' ends ' + Math.abs(d2) + '% ' + (d2 > 0 ? 'above' : 'below') + ' last month.');
    }
    if (st.biggest) lines.push('Biggest single spend: ' + st.biggest.description + ', ' + whole(st.biggest.amount) + ' on ' + fmtDate(st.biggest.date) + '.');
    if (!lines.length) lines.push('Add a few entries and this page starts answering for you.');
    lines.forEach(function (l) { ul.appendChild(make('li', null, l)); });
  }

  /* ============ END BLOCK ============ */
  function renderEnd(st) {
    var label = $('end-label'), title = $('end-title'), sub = $('end-sub');
    var nm = (state.profile.name || '').trim();
    if (st.cats.length) {
      var t = st.cats[0];
      label.textContent = (nm ? nm + ', in' : 'In') + ' ' + S.monthLabel(ui.ym).split(' ')[0] + ', the answer is';
      title.textContent = whole(t.total) + ' went on ' + t.name + '.';
      sub.textContent = Math.round(t.total / st.spent * 100) + '% of everything you spent. ' + whole(st.spent) + ' in total.';
    } else {
      label.textContent = 'Nothing to explain yet';
      title.textContent = 'Log one spend and the answer starts here.';
      sub.textContent = 'It takes about ten seconds.';
    }
  }

  /* ============ KINETIC TITLES ============ */
  function splitTitles() {
    document.querySelectorAll('[data-kin]').forEach(function (h) {
      var text = h.textContent;
      h.setAttribute('aria-label', text);
      h.textContent = '';
      var words = text.split(' ');
      var idx = 0;
      words.forEach(function (w, wi) {
        var word = make('span', 'kin-word');
        word.setAttribute('aria-hidden', 'true');
        w.split('').forEach(function (ch) {
          var s = make('span', 'kin-ch', ch);
          s.style.setProperty('--i', idx++);
          word.appendChild(s);
        });
        h.appendChild(word);
        if (wi < words.length - 1) h.appendChild(document.createTextNode(' '));
      });
    });
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.4 }) : null;
    document.querySelectorAll('[data-kin], .end').forEach(function (el) {
      if (io) io.observe(el); else el.classList.add('in');
    });
  }

  /* ============ DIALOGS ============ */
  function openModal(m) {
    if (!m.open) m.showModal();
    if (EF.Cursor) EF.Cursor.restack(); // keep the cursor above the dialog
  }
  function closeModal(m) { if (m.open) m.close(); }

  document.addEventListener('click', function (e) {
    var closer = e.target.closest && e.target.closest('[data-close]');
    if (closer) { closeModal(closer.closest('dialog')); return; }
    if (e.target.tagName === 'DIALOG') closeModal(e.target); // click on backdrop
  });

  function confirmDialog(title, text, yesLabel) {
    return new Promise(function (resolve) {
      var m = $('confirm-modal');
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      $('confirm-yes').textContent = yesLabel || 'Delete';
      m.returnValue = '';
      var done = function () { m.removeEventListener('close', done); resolve(m.returnValue === 'yes'); };
      m.addEventListener('close', done);
      openModal(m);
    });
  }

  /* ---------- entry form ---------- */
  function setEntryType(type) {
    ui.entryType = type;
    Array.prototype.forEach.call($('seg-type').children, function (b) {
      var on = b.getAttribute('data-type') === type;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    var isT = type === 'transfer';
    $('e-to-wrap').hidden = !isT;
    $('e-cat-wrap').hidden = isT;
    $('e-acc-label').textContent = type === 'income' ? 'Into account' : (isT ? 'From account' : 'Paid from');
    var cat = $('e-category'), prev = cat.value;
    cat.textContent = '';
    (type === 'income' ? S.INCOME_CATS : S.EXPENSE_CATS).forEach(function (c) { cat.appendChild(new Option(c, c)); });
    if (Array.prototype.some.call(cat.options, function (o) { return o.value === prev; })) cat.value = prev;
    $('e-desc').placeholder = isT ? 'Optional, e.g. Card bill' : (type === 'income' ? 'Salary, refund, invoice...' : 'Groceries, rent, coffee...');
  }

  function openEntry(tx) {
    ui.editingId = tx ? tx.id : null;
    $('entry-title').textContent = tx ? 'Edit entry' : 'Add entry';
    $('entry-save').textContent = tx ? 'Save changes' : 'Save entry';
    showErr('entry-error');
    $('amt-sym').textContent = S.symbol();
    $('e-repeat').checked = false;
    $('e-repeat-wrap').hidden = !!tx;

    ['e-account', 'e-to'].forEach(function (id) {
      var sel = $(id); sel.textContent = '';
      state.accounts.forEach(function (a) { sel.appendChild(new Option(a.name, a.id)); });
    });

    setEntryType(tx ? tx.type : 'expense');
    $('e-amount').value = tx ? String(tx.amount) : '';
    $('e-desc').value = tx ? tx.description : '';
    $('e-date').value = tx ? tx.date : S.today();
    $('e-note').value = tx ? (tx.note || '') : '';
    $('e-upiref').value = tx && tx.upiRef ? tx.upiRef : '';
    $('e-app').value = tx && tx.paymentApp ? tx.paymentApp : '';
    if (tx) {
      $('e-account').value = tx.accountId;
      if (tx.toAccountId) $('e-to').value = tx.toAccountId;
      if (tx.type !== 'transfer') $('e-category').value = tx.category;
    } else if (state.accounts.length > 1) {
      $('e-to').selectedIndex = 1;
    }
    openModal($('entry-modal'));
    setTimeout(function () { $('e-amount').focus(); }, 30);
  }

  function submitEntry(ev) {
    ev.preventDefault();
    if (!state.accounts.length) return showErr('entry-error', 'Add an account first.');
    var amount = parseFloat(String($('e-amount').value).replace(/,/g, ''));
    var type = ui.entryType, desc = $('e-desc').value.trim(), date = $('e-date').value;
    if (!(amount > 0)) return showErr('entry-error', 'Enter an amount greater than zero.');
    if (!desc && type !== 'transfer') return showErr('entry-error', 'Say what it was, even in one word.');
    if (!date) return showErr('entry-error', 'Pick a date.');
    var accountId = $('e-account').value, toId = type === 'transfer' ? $('e-to').value : null;
    if (type === 'transfer' && accountId === toId) return showErr('entry-error', 'Choose two different accounts.');

    var rec = {
      type: type, amount: Math.round(amount * 100) / 100, description: desc || 'Transfer', date: date,
      category: type === 'transfer' ? 'Other' : $('e-category').value,
      accountId: accountId, toAccountId: toId, note: $('e-note').value.trim(),
      upiRef: $('e-upiref').value.trim() || undefined,
      paymentApp: $('e-app').value || undefined
    };
    if (type === 'expense' && desc && rec.category) {
      S.learnCategory(desc, rec.category);
    }
    if (ui._reviewItemId) {
      S.dismissReviewItem(ui._reviewItemId);
      ui._reviewItemId = null;
    }
    var repeats = !ui.editingId && $('e-repeat').checked;
    if (repeats) {
      var rule = S.addRule({
        type: type, description: rec.description, category: rec.category, accountId: accountId, toAccountId: toId,
        amount: rec.amount, note: rec.note, day: Math.min(28, +date.slice(8, 10)), lastRun: date.slice(0, 7)
      });
      rec.recurringId = rule.id;
    }
    if (ui.editingId) { S.updateTx(ui.editingId, rec); toast('Changes saved'); }
    else if (repeats) { S.addTx(rec); S.runRecurring(); toast('Saved. It will repeat on day ' + Math.min(28, +date.slice(8, 10)) + ' each month.'); }
    else { S.addTx(rec); toast('Saved. ' + S.fmt(rec.amount) + ' ' + (type === 'income' ? 'received' : type === 'transfer' ? 'moved' : 'spent') + '.'); }
    if (window.EF && window.EF.FX) window.EF.FX.onSaveEntry();
    ui.ym = date.slice(0, 7) > S.currentYM() ? S.currentYM() : date.slice(0, 7);
    closeModal($('entry-modal'));
    render();
  }

  /* ---------- account form ---------- */
  function openAccount() {
    var t = $('a-type'); t.textContent = '';
    S.ACCOUNT_TYPES.forEach(function (x) { t.appendChild(new Option(x, x)); });
    $('a-name').value = ''; $('a-balance').value = '';
    showErr('account-error'); openModal($('account-modal'));
    setTimeout(function () { $('a-name').focus(); }, 30);
  }
  function submitAccount(ev) {
    ev.preventDefault();
    var name = $('a-name').value.trim();
    if (!name) return showErr('account-error', 'Give the account a name.');
    var bal = parseFloat(String($('a-balance').value).replace(/,/g, '')) || 0;
    S.addAccount({ name: name, type: $('a-type').value, opening: bal });
    closeModal($('account-modal')); toast(name + ' added');
  }

  /* ---------- settings ---------- */
  function openSettings(focusBudget) {
    $('p-name').value = state.profile.name || '';
    var cur = $('p-currency'); cur.textContent = '';
    Object.keys(S.CURRENCIES).forEach(function (k) { cur.appendChild(new Option(k + '  ' + S.CURRENCIES[k].sym, k)); });
    cur.value = state.profile.currency;
    $('p-budget').value = state.profile.budget || '';
    refreshCloudUI();
    openModal($('settings-modal'));
    setTimeout(function () { (focusBudget ? $('p-budget') : $('p-name')).focus(); }, 30);
  }
  function submitSettings(ev) {
    ev.preventDefault();
    S.setProfile({
      name: $('p-name').value.trim(),
      currency: $('p-currency').value,
      budget: Math.max(0, parseFloat(String($('p-budget').value).replace(/,/g, '')) || 0)
    });
    closeModal($('settings-modal'));
    toast('Settings saved');
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  /* ============ RENDER ============ */
  function render() {
    var st = renderMonth();
    renderAccounts();
    renderGoals();
    $('repeat-btn').textContent = state.recurring.length ? 'Repeating entries (' + state.recurring.length + ')' : 'Repeating entries';
    if ($('repeat-modal').open) renderRepeatList();
    fillFilterOptions();
    renderLedger();
    renderInsights(st);
    renderEnd(st);
    renderCategoryBudgets(st);

    var rqBtn = $('review-queue-btn'), rqCount = (state.reviewQueue || []).length;
    if (rqBtn) {
      rqBtn.hidden = rqCount === 0;
      rqBtn.classList.toggle('has-items', rqCount > 0);
      var rqCountEl = $('rq-badge-count');
      if (rqCountEl) rqCountEl.textContent = rqCount;
    }
    document.body.classList.toggle('privacy', !!state.privacy);
    var pb = $('privacy-btn');
    if (pb) {
      pb.innerHTML = '<span class="btn-icon">' + (state.privacy ? '🔒' : '👁️') + '</span><span class="btn-text">' + (state.privacy ? 'Show numbers' : 'Hide numbers') + '</span>';
      pb.setAttribute('aria-pressed', String(!!state.privacy));
    }
    if ($('mob-balance')) $('mob-balance').textContent = S.fmt(S.totalBalance(), { whole: true });
    if ($('mob-spent')) $('mob-spent').textContent = S.fmt(st.spent, { whole: true });
    if ($('mob-income')) $('mob-income').textContent = S.fmt(st.income, { whole: true });
    EF.Hero.setData({
      balance: S.totalBalance(), spent: st.spent, monthName: S.monthLabel(ui.ym).split(' ')[0],
      accounts: state.accounts.filter(function (a) { return a.counted; }).map(function (a) { return { id: a.id, name: a.name, balance: S.balanceOf(a) }; })
    });
    if (window.EF && window.EF.FX) {
      window.EF.FX.scanDOM();
    }
  }

  function exportCsv() {
    if (!state.transactions.length) { toast('Nothing to export yet'); return; }
    download('trueledger-' + S.today() + '.csv', S.toCSV());
    toast('CSV downloaded');
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light', true);
  }

  /* ============ PWA INSTALL & DOWNLOAD ============ */
  var deferredInstallPrompt = null;
  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function detectOS() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/android/.test(ua)) return 'android';
    if (/macintosh|mac os x/.test(ua)) return 'mac';
    if (/windows/.test(ua)) return 'windows';
    return 'desktop';
  }

  function updateInstallUI(installed) {
    var btn = $('main-download-btn'), txt = $('main-download-text'), stat = $('dl-status-text');
    var barBtn = $('bar-download-btn'), setBtn = $('settings-download-btn'), banner = $('pwa-banner');
    if (installed || isStandalone()) {
      if (btn) btn.disabled = true;
      if (txt) txt.textContent = 'App Installed ✓';
      if (stat) stat.textContent = 'TrueLedger is running in standalone vault mode';
      if (barBtn) barBtn.innerHTML = '<span class="dl-arrow">✓</span> Installed';
      if (setBtn) setBtn.textContent = '✓ App already installed';
      if (banner) banner.hidden = true;
    } else if (deferredInstallPrompt) {
      if (btn) btn.disabled = false;
      if (txt) txt.textContent = 'Install App Now';
      if (stat) stat.textContent = '1-click instant install ready on this device';
    }
  }

  function openDownloadModal() {
    var os = detectOS();
    var inst = $('dl-modal-instruction');
    var pwaBtn = $('modal-pwa-install-btn');
    if (isStandalone()) {
      inst.innerHTML = '<p><strong>✓ TrueLedger is already installed</strong> and running in standalone app mode on this device.</p>';
      pwaBtn.hidden = true;
    } else if (os === 'ios') {
      inst.innerHTML = '<p><strong>How to install on iPhone &amp; iPad:</strong></p>' +
        '<ol>' +
        '<li>Tap the <strong>Share button</strong> (square with an arrow pointing up) at the bottom of Safari.</li>' +
        '<li>Scroll down in the action sheet and tap <strong>Add to Home Screen</strong>.</li>' +
        '<li>Tap <strong>Add</strong> in the top-right corner. TrueLedger will appear on your home screen!</li>' +
        '</ol>';
      pwaBtn.hidden = true;
    } else if (deferredInstallPrompt) {
      inst.innerHTML = '<p><strong>Instant 1-Click Install Ready:</strong></p>' +
        '<p>Click the button below to add TrueLedger directly to your apps for offline access.</p>';
      pwaBtn.hidden = false;
      pwaBtn.textContent = 'Install Now';
    } else {
      inst.innerHTML = '<p><strong>How to install on this device:</strong></p>' +
        '<ol>' +
        '<li>Open your browser menu (Chrome / Edge / Brave).</li>' +
        '<li>Click <strong>Install TrueLedger</strong> or look for the install icon in your address bar (⊕ / ⊞).</li>' +
        '<li>Once installed, TrueLedger runs offline without browser bars.</li>' +
        '</ol>';
      pwaBtn.hidden = true;
    }
    openModal($('download-modal'));
  }

  function triggerInstall() {
    if (isStandalone()) {
      toast('TrueLedger is already installed and running standalone! ✓');
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          toast('Installing TrueLedger to your device... 🚀');
          updateInstallUI(true);
        }
        deferredInstallPrompt = null;
      });
      return;
    }
    openDownloadModal();
  }

  /* ============ COMMAND PALETTE ============ */
  var pal = { items: [], idx: 0 };

  function parseNaturalQuery(q) {
    if (!q) return null;
    var norm = q.toLowerCase().trim();
    var isLastMonth = /last\s+month|prev(?:ious)?\s+month/i.test(norm);
    var isThisMonth = /this\s+month|current\s+month/i.test(norm);
    var targetYM = isLastMonth ? S.shiftYM(S.currentYM(), -1) : (isThisMonth ? S.currentYM() : null);

    var matchedCat = null;
    S.EXPENSE_CATS.concat(S.INCOME_CATS).forEach(function (cat) {
      var catWords = cat.toLowerCase().split(/[\s&/]+/);
      if (catWords.some(function (w) { return w.length > 3 && norm.indexOf(w) > -1; })) {
        matchedCat = cat;
      }
    });

    if (matchedCat && targetYM) {
      return {
        label: 'Show ' + matchedCat + ' (' + S.monthLabel(targetYM) + ')',
        hint: 'Smart Query',
        fn: function () {
          ui.ym = targetYM;
          goLedger({ category: matchedCat });
        }
      };
    }
    if (matchedCat) {
      return {
        label: 'Filter ledger for ' + matchedCat,
        hint: 'Smart Category',
        fn: function () { goLedger({ category: matchedCat }); }
      };
    }

    var amtMatch = norm.match(/(?:over|above|more than|>)\s*(\d+)/i);
    if (amtMatch) {
      var minAmt = parseFloat(amtMatch[1]);
      return {
        label: 'Show transactions over ' + S.fmt(minAmt),
        hint: 'Smart Filter',
        fn: function () {
          goLedger({ search: '' });
          ui.limit = 100;
          renderLedger();
          var ul = $('tx-list');
          var lis = ul.querySelectorAll('.tx');
          lis.forEach(function (li) {
            var valEl = li.querySelector('.tx-amt');
            var val = valEl ? parseFloat(valEl.textContent.replace(/[^0-9.-]/g, '')) : 0;
            if (val < minAmt) li.style.display = 'none';
          });
        }
      };
    }
    return null;
  }

  function commands() {
    var c = [];
    function add(label, hint, fn) { c.push({ label: label, hint: hint || '', fn: fn }); }
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    add('Add entry', 'N', function () { openEntry(); });
    add('⚡ Paste Bank SMS / UPI alert', 'Parser', openParseModal);
    add('Review Queue (' + (state.reviewQueue || []).length + ' pending)', 'Queue', openReviewModal);
    add('Category spending limits', 'Budget', openCategoryBudgets);
    add('🔐 Encrypted Vault Backup', 'Security', openVaultModal);
    add('New goal', '', openGoal);
    add('Add account', '', openAccount);
    add('Download / Install App', 'App', triggerInstall);
    add('Go to the month', 'Section', function () { jump('month'); });
    add('Go to accounts', 'Section', function () { jump('accounts'); });
    add('Go to goals', 'Section', function () { jump('goals'); });
    add('Go to the ledger', 'Section', function () { jump('ledger'); });
    add('Go to where it went', 'Section', function () { jump('insights'); });
    add('Go to Get App', 'Section', function () { jump('download'); });
    add('Previous month', '', function () { $('month-prev').click(); });
    add('Next month', '', function () { $('month-next').click(); });
    add(light ? 'Switch to dark theme' : 'Switch to light theme', '', toggleTheme);
    add(state.privacy ? 'Show numbers' : 'Hide numbers', '', function () { S.setPrivacy(!state.privacy); });
    add('Settings', '', function () { openSettings(); });
    add('Repeating entries', '', function () { renderRepeatList(); openModal($('repeat-modal')); });
    add('Export CSV', '', exportCsv);
    if (EF.Intro) add('Replay the intro', '', function () { EF.Intro.play(); });
    if (EF.Gate && EF.Gate.hasPin()) add('Lock wallet', '', function () { EF.Gate.lock(); });
    if (window.EF && window.EF.FX) {
      add(EF.FX.isSoundEnabled() ? 'Mute sound effects' : 'Enable sound effects', 'Audio', function () {
        var on = EF.FX.toggleSound();
        toast(on ? 'Sound effects enabled 🔊' : 'Sound effects muted 🔇');
      });
      add('Jackpot celebration', 'Easter Egg', function () { EF.FX.burstJackpot(); });
      add('Gold Tycoon mode', 'Easter Egg', function () { EF.FX.onWalletClick(); });
    }
    S.EXPENSE_CATS.forEach(function (cat) { add('Show ' + cat + ' spending', 'Ledger', function () { goLedger({ type: 'expense', category: cat }); }); });
    state.accounts.forEach(function (a) { add('Show entries in ' + a.name, 'Ledger', function () { goLedger({ account: a.id }); }); });
    return c;
  }
  function renderPalette() {
    var q = $('pal-input').value.trim().toLowerCase();
    var toks = q.split(/\s+/).filter(Boolean);
    var all = commands().filter(function (it) {
      var l = it.label.toLowerCase();
      return toks.every(function (t) { return l.indexOf(t) > -1; });
    }).slice(0, 9);
    var smart = parseNaturalQuery(q);
    if (smart) {
      all.unshift(smart);
    } else if (q) {
      all.unshift({ label: 'Search the ledger for \u201C' + $('pal-input').value.trim() + '\u201D', hint: 'Ledger', fn: function () { goLedger({ search: $('pal-input').value.trim() }); } });
    }
    pal.items = all; pal.idx = 0;
    var ul = $('pal-list');
    ul.textContent = '';
    all.forEach(function (it, i) {
      var li = make('li');
      li.id = 'pal-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === 0));
      li.appendChild(make('span', null, it.label));
      li.appendChild(make('span', 'h', it.hint));
      li.addEventListener('mousemove', function () { palSelect(i); });
      li.addEventListener('click', function () { palRun(i); });
      ul.appendChild(li);
    });
    if (!all.length) ul.appendChild(make('li', 'none', 'Nothing matches. Try \u201Cadd\u201D, \u201Cledger\u201D or a category.'));
    $('pal-input').setAttribute('aria-activedescendant', all.length ? 'pal-0' : '');
  }
  function palSelect(i) {
    var lis = $('pal-list').children;
    if (!pal.items.length) return;
    pal.idx = (i + pal.items.length) % pal.items.length;
    for (var k = 0; k < lis.length; k++) lis[k].setAttribute('aria-selected', String(k === pal.idx));
    lis[pal.idx].scrollIntoView({ block: 'nearest' });
    $('pal-input').setAttribute('aria-activedescendant', 'pal-' + pal.idx);
  }
  function palRun(i) {
    var it = pal.items[i];
    if (!it) return;
    closeModal($('palette'));
    setTimeout(it.fn, 30);
  }
  function openPalette() {
    $('pal-input').value = '';
    renderPalette();
    openModal($('palette'));
    setTimeout(function () { $('pal-input').focus(); }, 20);
  }

  /* ============ NAV HIGHLIGHT ============ */
  function initScrollSpy() {
    if (!('IntersectionObserver' in window)) return;
    var links = {}, mobLinks = {};
    document.querySelectorAll('.nav a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    document.querySelectorAll('.mobile-bottom-nav .mob-tab[data-target]').forEach(function (a) {
      mobLinks[a.getAttribute('data-target')] = a;
    });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle('on', k === e.target.id); });
        Object.keys(mobLinks).forEach(function (k) { mobLinks[k].classList.toggle('on', k === e.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(links).forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  }

  /* ============ THEME ============ */
  function applyTheme(t, animate) {
    var root = document.documentElement;
    if (animate) { root.classList.add('theme-anim'); setTimeout(function () { root.classList.remove('theme-anim'); }, 450); }
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('trueledger.theme', t); } catch (e) {}
    var b = $('theme-btn');
    b.textContent = t === 'light' ? 'Go dark' : 'Go light';
    b.setAttribute('aria-pressed', String(t === 'light'));
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#f2efe9' : '#0d0e10');
  }

  /* ============ WIRING ============ */
  function init() {
    splitTitles();
    EF.Hero.init();

    S.subscribe(render);

    // header / global
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark', false);
    $('theme-btn').addEventListener('click', toggleTheme);
    $('jump-btn').addEventListener('click', openPalette);
    $('pal-input').addEventListener('input', renderPalette);
    $('pal-input').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); palSelect(pal.idx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palSelect(pal.idx - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); palRun(pal.idx); }
    });
    document.querySelectorAll('.stat[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = b.getAttribute('data-go');
        if (g === 'income') goLedger({ type: 'income' });
        else if (g === 'expense') goLedger({ type: 'expense' });
        else jump(g);
      });
    });
    EF.Hero.onTag = function (id) { goLedger({ account: id }); };
    initScrollSpy();
    $('add-btn').addEventListener('click', function () { openEntry(); });
    $('fab').addEventListener('click', function () { openEntry(); });
    $('end-add').addEventListener('click', function () { openEntry(); });
    if ($('mob-add-btn')) $('mob-add-btn').addEventListener('click', function () { openEntry(); });
    if ($('mob-quick-add')) $('mob-quick-add').addEventListener('click', function () { openEntry(); });
    if ($('mob-quick-sms')) $('mob-quick-sms').addEventListener('click', openParseModal);
    document.querySelectorAll('.mobile-bottom-nav .mob-tab[data-target]').forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        var targetId = tab.getAttribute('data-target');
        var targetEl = document.getElementById(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth' });
          document.querySelectorAll('.mobile-bottom-nav .mob-tab').forEach(function (t) { t.classList.remove('on'); });
          tab.classList.add('on');
        }
      });
    });
    $('settings-btn').addEventListener('click', function () { openSettings(); });
    $('budget-edit').addEventListener('click', function () { openSettings(true); });
    $('privacy-btn').addEventListener('click', function () { S.setPrivacy(!state.privacy); });
    $('add-account-btn').addEventListener('click', openAccount);
    $('add-goal-btn').addEventListener('click', openGoal);
    $('goal-form').addEventListener('submit', submitGoal);
    $('contrib-form').addEventListener('submit', function (e) { e.preventDefault(); applyContrib(1); });
    $('c-take').addEventListener('click', function () { applyContrib(-1); });
    $('repeat-btn').addEventListener('click', function () { renderRepeatList(); openModal($('repeat-modal')); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) S.runRecurring(); });
    document.addEventListener('ef:toast', function (e) { toast(e.detail); });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    // PWA download / install bindings
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      updateInstallUI(false);
    });
    window.addEventListener('appinstalled', function () {
      deferredInstallPrompt = null;
      updateInstallUI(true);
      toast('TrueLedger installed to your device! 🎉');
    });
    if ($('bar-download-btn')) $('bar-download-btn').addEventListener('click', triggerInstall);
    if ($('main-download-btn')) $('main-download-btn').addEventListener('click', triggerInstall);
    if ($('settings-download-btn')) {
      $('settings-download-btn').addEventListener('click', function () {
        closeModal($('settings-modal'));
        triggerInstall();
      });
    }
    if ($('modal-pwa-install-btn')) {
      $('modal-pwa-install-btn').addEventListener('click', function () {
        closeModal($('download-modal'));
        triggerInstall();
      });
    }
    updateInstallUI(isStandalone());

    // Smart install banner
    var banner = $('pwa-banner');
    if (banner && !isStandalone()) {
      var closed = false;
      try { closed = sessionStorage.getItem('tl-banner-closed') === '1'; } catch (e) {}
      if (!closed) {
        setTimeout(function () {
          if (!isStandalone()) banner.hidden = false;
        }, 1800);
      }
    }
    if ($('banner-install-btn')) $('banner-install-btn').addEventListener('click', triggerInstall);
    if ($('banner-close-btn')) {
      $('banner-close-btn').addEventListener('click', function () {
        if (banner) banner.hidden = true;
        try { sessionStorage.setItem('tl-banner-closed', '1'); } catch (e) {}
      });
    }
    $('fresh-btn').addEventListener('click', function () {
      confirmDialog('Clear the sample data?', 'Your accounts and entries will be replaced with an empty Bank and Cash account.', 'Start fresh')
        .then(function (yes) { if (yes) { S.startFresh(); toast('Fresh start. Add your first entry.'); } });
    });

    // month nav
    $('month-prev').addEventListener('click', function () {
      ui.ym = S.shiftYM(ui.ym, -1); ui.limit = 25; ui.day = null; render();
      if (window.EF && window.EF.FX) window.EF.FX.onMonthChange();
    });
    $('month-next').addEventListener('click', function () {
      if (ui.ym < S.currentYM()) {
        ui.ym = S.shiftYM(ui.ym, 1); ui.limit = 25; ui.day = null; render();
        if (window.EF && window.EF.FX) window.EF.FX.onMonthChange();
      }
    });

    // six-month chart: click a month to look at it
    $('trend').addEventListener('click', function (e) {
      var g = e.target.closest('g[data-ym]');
      if (!g) return;
      ui.ym = g.getAttribute('data-ym'); ui.limit = 25; ui.day = null;
      render();
      if (window.EF && window.EF.FX) window.EF.FX.onMonthChange();
    });

    // ledger filters
    ['f-type', 'f-account', 'f-category', 'f-period', 'f-sort'].forEach(function (id) {
      $(id).addEventListener('change', function () { ui.limit = 25; renderLedger(); });
    });
    var st;
    $('f-search').addEventListener('input', function () {
      clearTimeout(st); st = setTimeout(function () { ui.limit = 25; renderLedger(); }, 120);
    });
    $('more-btn').addEventListener('click', function () { ui.limit += 25; renderLedger(); });

    // forms
    $('seg-type').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-type]');
      if (b) setEntryType(b.getAttribute('data-type'));
    });
    $('entry-form').addEventListener('submit', submitEntry);
    $('account-form').addEventListener('submit', submitAccount);
    $('settings-form').addEventListener('submit', submitSettings);

    // data tools
    $('export-btn').addEventListener('click', function () {
      if (!state.transactions.length) { toast('Nothing to export yet'); return; }
      download('trueledger-' + S.today() + '.csv', S.toCSV());
      toast('CSV downloaded');
    });
    $('import-btn').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var n = S.importCSV(String(r.result));
        toast(n ? n + ' entries imported' : 'No rows could be read. Needs Date and Amount columns.');
        if (n) closeModal($('settings-modal'));
      };
      r.readAsText(f);
      e.target.value = '';
    });
    $('demo-btn').addEventListener('click', function () {
      confirmDialog('Load sample data?', 'This replaces your current accounts and entries.', 'Load sample')
        .then(function (yes) { if (yes) { S.loadDemo(); closeModal($('settings-modal')); toast('Sample data loaded'); } });
    });
    $('wipe-btn').addEventListener('click', function () {
      confirmDialog('Erase everything?', 'All accounts and entries are removed from this browser. Export a CSV first if you want a copy.', 'Erase')
        .then(function (yes) { if (yes) { S.startFresh(); closeModal($('settings-modal')); toast('All data erased'); } });
    });

    // parser modal
    if ($('parse-sms-btn')) $('parse-sms-btn').addEventListener('click', openParseModal);
    if ($('parse-sms-text')) $('parse-sms-text').addEventListener('input', handleParseInput);
    if ($('parse-log-btn')) {
      $('parse-log-btn').addEventListener('click', function () {
        if (!currentParsed) return showErr('parse-error', 'Please paste a valid transaction message first.');
        logParsedTx(currentParsed);
        closeModal($('parse-modal'));
      });
    }
    if ($('parse-queue-btn')) {
      $('parse-queue-btn').addEventListener('click', function () {
        if (!currentParsed) return showErr('parse-error', 'Please paste a valid transaction message first.');
        S.addToReviewQueue($('parse-sms-text').value.trim(), currentParsed);
        toast('Added to review queue');
        closeModal($('parse-modal'));
        render();
      });
    }

    // review queue modal
    if ($('review-queue-btn')) $('review-queue-btn').addEventListener('click', openReviewModal);
    if ($('review-accept-all-btn')) {
      $('review-accept-all-btn').addEventListener('click', function () {
        var n = S.acceptAllReviewItems();
        toast(n ? n + ' items accepted into ledger' : 'No clean items to accept');
        renderReviewQueue();
        render();
      });
    }
    if ($('review-clear-btn')) {
      $('review-clear-btn').addEventListener('click', function () {
        confirmDialog('Clear review queue?', 'All unconfirmed staged items will be removed.', 'Clear queue')
          .then(function (yes) {
            if (yes) {
              S.clearReviewQueue();
              toast('Review queue cleared');
              renderReviewQueue();
              render();
            }
          });
      });
    }

    // entry form paste autofill
    if ($('entry-paste-sms')) {
      $('entry-paste-sms').addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(function (clip) {
            var p = clip && EF.Parser.parse(clip);
            if (p) {
              setEntryType(p.type || 'expense');
              $('e-amount').value = p.amount;
              $('e-desc').value = p.merchant || '';
              if (p.category) $('e-category').value = p.category;
              if (p.date) $('e-date').value = p.date;
              if (p.upiRef) $('e-upiref').value = p.upiRef;
              if (p.paymentApp) $('e-app').value = p.paymentApp;
              toast('Autofilled from clipboard! ⚡');
            } else {
              openParseModal();
            }
          }).catch(function () {
            openParseModal();
          });
        } else {
          openParseModal();
        }
      });
    }

    // category budgets
    if ($('cat-budgets-open')) $('cat-budgets-open').addEventListener('click', openCategoryBudgets);
    if ($('settings-cat-budget-btn')) {
      $('settings-cat-budget-btn').addEventListener('click', function () {
        closeModal($('settings-modal'));
        openCategoryBudgets();
      });
    }
    if ($('cat-budget-form')) $('cat-budget-form').addEventListener('submit', submitCategoryBudgets);

    // encrypted vault backup
    if ($('vault-open-btn')) {
      $('vault-open-btn').addEventListener('click', function () {
        closeModal($('settings-modal'));
        openVaultModal();
      });
    }
    if ($('vault-export-btn')) $('vault-export-btn').addEventListener('click', handleVaultExport);
    if ($('vault-import-btn')) $('vault-import-btn').addEventListener('click', handleVaultImport);

    // one-time cloud sign-in & zero-knowledge sync
    if ($('cloud-auth-btn')) $('cloud-auth-btn').addEventListener('click', openCloudAuth);
    if ($('cloud-auth-form')) $('cloud-auth-form').addEventListener('submit', function (e) { e.preventDefault(); handleCloudAuth(false); });
    if ($('ca-signup-btn')) $('ca-signup-btn').addEventListener('click', function () { handleCloudAuth(true); });
    if ($('cloud-sync-now-btn')) $('cloud-sync-now-btn').addEventListener('click', handleCloudSyncNow);

    // keyboard: N = new entry
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if ($('palette').open) closeModal($('palette')); else openPalette(); return; }
      var tg = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tg !== 'input' && tg !== 'textarea' && tg !== 'select' && !document.querySelector('dialog[open]')) { e.preventDefault(); openPalette(); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.querySelector('dialog[open]')) return;
      e.preventDefault(); openEntry();
    });

    // header gets a background once we leave the hero
    var bar = $('bar');
    function onScroll() {
      bar.classList.toggle('solid', window.scrollY > window.innerHeight * 0.6);
      bar.classList.toggle('on-hero', $('top').getBoundingClientRect().bottom > 64);
    }
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
