/* TrueLedger — store.js
   State, persistence, demo data, derived numbers, CSV in/out.
   No DOM in here. */
(function () {
  'use strict';

  var KEY = 'trueledger.v2';

  var EXPENSE_CATS = ['Food', 'Housing', 'Transport', 'Bills', 'Shopping', 'Health', 'Fun', 'Travel', 'Other'];
  var INCOME_CATS = ['Salary', 'Freelance', 'Investment', 'Gift', 'Other'];
  var ACCOUNT_TYPES = ['Bank', 'Cash', 'Card', 'Savings', 'Wallet'];

  var CURRENCIES = {
    INR: { sym: '\u20B9', locale: 'en-IN', rate: 45 },
    USD: { sym: '$', locale: 'en-US', rate: 1 },
    EUR: { sym: '\u20AC', locale: 'de-DE', rate: 0.92 },
    GBP: { sym: '\u00A3', locale: 'en-GB', rate: 0.79 },
    JPY: { sym: '\u00A5', locale: 'ja-JP', rate: 150, noDecimals: true },
    CAD: { sym: 'CA$', locale: 'en-CA', rate: 1.37 },
    AUD: { sym: 'A$', locale: 'en-AU', rate: 1.52 }
  };

  /* ---------- small helpers ---------- */
  function uid(p) { return p + '-' + Math.random().toString(36).slice(2, 9); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return iso(new Date()); }
  function ymOf(dateStr) { return dateStr.slice(0, 7); }
  function currentYM() { return ymOf(today()); }
  function shiftYM(ym, delta) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + delta;
    var d = new Date(y, m, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function daysInMonth(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function monthLabel(ym, short) {
    var d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1);
    return d.toLocaleDateString('en-US', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
  }

  function guessCurrency() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      var lang = (navigator.language || 'en-US');
      if (/Kolkata|Calcutta/.test(tz) || /-IN$/.test(lang) || /^hi/.test(lang)) return 'INR';
      if (/-GB$/.test(lang)) return 'GBP';
      if (/-CA$/.test(lang)) return 'CAD';
      if (/-AU$/.test(lang)) return 'AUD';
      if (/^ja/.test(lang)) return 'JPY';
      if (/^(de|fr|es|it|nl|pt)/.test(lang)) return 'EUR';
    } catch (e) {}
    return 'USD';
  }

  /* ---------- demo data (built relative to today so it never looks stale) ---------- */
  function round(v, cur) {
    var c = CURRENCIES[cur];
    var x = v * c.rate;
    if (c.noDecimals) return Math.round(x / 10) * 10;
    if (c.rate >= 40) return Math.round(x / 5) * 5;
    return Math.round(x * 100) / 100;
  }

  function buildDemo(cur) {
    var accounts = [
      { id: 'a-bank', name: 'Everyday Bank', type: 'Bank', opening: round(2100, cur), counted: true },
      { id: 'a-card', name: 'Credit Card', type: 'Card', opening: 0, counted: true },
      { id: 'a-cash', name: 'Cash', type: 'Cash', opening: round(700, cur), counted: true },
      { id: 'a-save', name: 'Savings', type: 'Savings', opening: round(5200, cur), counted: true }
    ];
    // [day, type, description, category, account, usd, note]
    var tpl = [
      [1, 'income', 'Salary', 'Salary', 'a-bank', 3600, ''],
      [2, 'expense', 'Rent', 'Housing', 'a-bank', 1150, 'Monthly'],
      [3, 'expense', 'Fresh Mart groceries', 'Food', 'a-card', 74, ''],
      [4, 'expense', 'Metro pass', 'Transport', 'a-cash', 22, ''],
      [5, 'transfer', 'Card bill payment', 'Other', 'a-bank', 520, '', 'a-card'],
      [6, 'expense', 'Electricity', 'Bills', 'a-bank', 64, ''],
      [8, 'expense', 'Lunch with the team', 'Food', 'a-card', 38, ''],
      [9, 'expense', 'Streaming + music', 'Fun', 'a-card', 19, 'Subscriptions'],
      [11, 'expense', 'Pharmacy', 'Health', 'a-cash', 27, ''],
      [12, 'expense', 'Fresh Mart groceries', 'Food', 'a-card', 81, ''],
      [14, 'expense', 'Sneakers', 'Shopping', 'a-card', 96, ''],
      [15, 'income', 'Side project invoice', 'Freelance', 'a-bank', 420, ''],
      [16, 'expense', 'Cab to airport', 'Transport', 'a-card', 31, ''],
      [18, 'expense', 'Dinner out', 'Food', 'a-card', 58, ''],
      [20, 'expense', 'Internet', 'Bills', 'a-bank', 29, ''],
      [21, 'transfer', 'Move to savings', 'Other', 'a-bank', 300, '', 'a-save'],
      [23, 'expense', 'Cinema', 'Fun', 'a-cash', 14, ''],
      [25, 'expense', 'Fresh Mart groceries', 'Food', 'a-card', 69, ''],
      [26, 'expense', 'Coffee beans', 'Food', 'a-cash', 16, '']
    ];
    var mult = [1, 0.93, 1.12, 0.98, 1.06, 0.9]; // this month, then going back
    var now = new Date();
    var cur_ym = currentYM();
    var tx = [];
    for (var mo = 0; mo < 6; mo++) {
      var ym = shiftYM(cur_ym, -mo);
      for (var i = 0; i < tpl.length; i++) {
        var t = tpl[i];
        if (mo === 0 && t[0] > now.getDate()) continue;
        var isFixed = t[3] === 'Housing' || t[3] === 'Salary' || t[1] === 'transfer';
        var amt = round(t[5] * (isFixed ? 1 : mult[mo] * (0.9 + ((i * 7 + mo * 3) % 5) * 0.05)), cur);
        tx.push({
          id: uid('t'), date: ym + '-' + pad(t[0]), type: t[1], description: t[2],
          category: t[3], accountId: t[4], toAccountId: t[7] || null, amount: amt, note: t[6] || ''
        });
      }
    }
    var goals = [
      { id: uid('g'), name: 'Emergency fund', target: round(3000, cur), saved: round(1450, cur) },
      { id: uid('g'), name: 'Weekend trip', target: round(800, cur), saved: round(310, cur) }
    ];
    var recurring = [
      { id: uid('r'), type: 'expense', description: 'Rent', category: 'Housing', accountId: 'a-bank', toAccountId: null, amount: round(1150, cur), day: 2, note: 'Monthly', lastRun: cur_ym },
      { id: uid('r'), type: 'expense', description: 'Streaming + music', category: 'Fun', accountId: 'a-card', toAccountId: null, amount: round(19, cur), day: 9, note: 'Subscriptions', lastRun: cur_ym }
    ];
    return { accounts: accounts, transactions: tx, budget: round(2000, cur), goals: goals, recurring: recurring };
  }

  /* ---------- state ---------- */
  var state;

  function freshState() {
    var cur = guessCurrency();
    var demo = buildDemo(cur);
    return {
      v: 2,
      profile: { name: '', currency: cur, budget: demo.budget },
      accounts: demo.accounts,
      transactions: demo.transactions,
      goals: demo.goals,
      recurring: demo.recurring,
      isDemo: true,
      privacy: false
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY) || localStorage.getItem('expenseflow.v2');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 2 && s.accounts && s.transactions) {
          s.goals = s.goals || []; s.recurring = s.recurring || [];
          return s;
        }
      }
    } catch (e) {}
    return freshState();
  }

  var listeners = [];
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function emit() { save(); listeners.forEach(function (fn) { fn(); }); }
  function subscribe(fn) { listeners.push(fn); }

  state = load();

  function runRecurring() {
    var cur = currentYM(), nowDay = new Date().getDate(), added = 0;
    state.recurring.forEach(function (rule) {
      if (!accountById(rule.accountId)) return;
      var ym = shiftYM(rule.lastRun || cur, 1), guard = 0;
      while (ym <= cur && guard++ < 24) {
        var day = Math.min(rule.day, daysInMonth(ym));
        if (ym === cur && day > nowDay) break;
        state.transactions.push({
          id: uid('t'), date: ym + '-' + pad(day), type: rule.type, description: rule.description,
          category: rule.category, accountId: rule.accountId, toAccountId: rule.toAccountId || null,
          amount: rule.amount, note: rule.note || '', recurringId: rule.id
        });
        rule.lastRun = ym; added++;
        ym = shiftYM(ym, 1);
      }
    });
    if (added) emit();
    return added;
  }
  runRecurring();
  save();

  /* ---------- formatting ---------- */
  function fmt(n, opts) {
    opts = opts || {};
    var c = CURRENCIES[state.profile.currency] || CURRENCIES.USD;
    var abs = Math.abs(Number(n) || 0);
    var whole = opts.whole || c.noDecimals || (opts.trim && Math.abs(abs - Math.round(abs)) < 0.005);
    var s = abs.toLocaleString(c.locale, {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2
    });
    var sign = n < 0 ? '\u2212' : (opts.plus && n > 0 ? '+' : '');
    return sign + c.sym + s;
  }
  function symbol() { return (CURRENCIES[state.profile.currency] || CURRENCIES.USD).sym; }

  /* ---------- derived numbers ---------- */
  function accountById(id) {
    for (var i = 0; i < state.accounts.length; i++) if (state.accounts[i].id === id) return state.accounts[i];
    return null;
  }

  function balanceOf(acc) {
    var b = Number(acc.opening) || 0;
    state.transactions.forEach(function (t) {
      if (t.accountId === acc.id) {
        if (t.type === 'income') b += t.amount;
        else b -= t.amount; // expense and transfer-out
      }
      if (t.type === 'transfer' && t.toAccountId === acc.id) b += t.amount;
    });
    return b;
  }

  function countedIds() {
    var s = {};
    state.accounts.forEach(function (a) { if (a.counted) s[a.id] = true; });
    return s;
  }

  function totalBalance() {
    return state.accounts.reduce(function (sum, a) { return sum + (a.counted ? balanceOf(a) : 0); }, 0);
  }

  function monthStats(ym) {
    var ids = countedIds();
    var income = 0, spent = 0, byCat = {}, biggest = null, count = 0;
    state.transactions.forEach(function (t) {
      if (ymOf(t.date) !== ym || !ids[t.accountId]) return;
      if (t.type === 'income') { income += t.amount; count++; }
      else if (t.type === 'expense') {
        spent += t.amount; count++;
        byCat[t.category] = (byCat[t.category] || 0) + t.amount;
        if (!biggest || t.amount > biggest.amount) biggest = t;
      }
    });
    var cats = Object.keys(byCat).map(function (k) { return { name: k, total: byCat[k] }; })
      .sort(function (a, b) { return b.total - a.total; });
    var isNow = ym === currentYM();
    var dim = daysInMonth(ym);
    var dayN = isNow ? new Date().getDate() : dim;
    var projected = isNow && dayN > 0 ? (spent / dayN) * dim : spent;
    return {
      ym: ym, income: income, spent: spent, net: income - spent, cats: cats, biggest: biggest,
      count: count, isNow: isNow, daysLeft: dim - dayN, projected: projected,
      perDay: dayN > 0 ? spent / dayN : 0,
      rate: income > 0 ? (income - spent) / income : null
    };
  }

  /* ---------- mutations ---------- */
  function addTx(t) {
    t.id = uid('t');
    state.transactions.push(t);
    emit();
  }
  function updateTx(id, patch) {
    for (var i = 0; i < state.transactions.length; i++) {
      if (state.transactions[i].id === id) { Object.assign(state.transactions[i], patch); break; }
    }
    emit();
  }
  function deleteTx(id) {
    state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
    emit();
  }
  function addAccount(a) { a.id = uid('a'); a.counted = true; state.accounts.push(a); emit(); }
  function deleteAccount(id) {
    state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
    state.recurring = state.recurring.filter(function (r) { return r.accountId !== id && r.toAccountId !== id; });
    state.transactions = state.transactions.filter(function (t) { return t.accountId !== id && t.toAccountId !== id; });
    emit();
  }
  function toggleCounted(id) {
    var a = accountById(id); if (a) { a.counted = !a.counted; emit(); }
  }
  function setProfile(p) { Object.assign(state.profile, p); emit(); }
  function setPrivacy(v) { state.privacy = !!v; emit(); }

  function loadDemo() {
    var cur = state.profile.currency;
    var d = buildDemo(cur);
    state.accounts = d.accounts; state.transactions = d.transactions;
    state.profile.budget = d.budget; state.isDemo = true;
    state.goals = d.goals; state.recurring = d.recurring;
    emit();
  }
  function startFresh() {
    state.accounts = [
      { id: uid('a'), name: 'Bank', type: 'Bank', opening: 0, counted: true },
      { id: uid('a'), name: 'Cash', type: 'Cash', opening: 0, counted: true }
    ];
    state.transactions = [];
    state.goals = []; state.recurring = [];
    state.isDemo = false;
    emit();
  }

  function restoreTx(t) { state.transactions.push(t); emit(); }

  function addRule(r) {
    r.id = uid('r');
    r.lastRun = r.lastRun || currentYM();
    state.recurring.push(r);
    emit();
    return r;
  }
  function deleteRule(id) {
    state.recurring = state.recurring.filter(function (r) { return r.id !== id; });
    emit();
  }

  function addGoal(g) { g.id = uid('g'); state.goals.push(g); emit(); }
  function deleteGoal(id) { state.goals = state.goals.filter(function (g) { return g.id !== id; }); emit(); }
  function contributeGoal(id, delta) {
    state.goals.forEach(function (g) { if (g.id === id) g.saved = Math.max(0, Math.round((g.saved + delta) * 100) / 100); });
    emit();
  }

  // spending per day of a month, counted accounts only
  function dayTotals(ym) {
    var ids = countedIds(), out = {};
    state.transactions.forEach(function (t) {
      if (t.type !== 'expense' || ymOf(t.date) !== ym || !ids[t.accountId]) return;
      var d = +t.date.slice(8, 10);
      out[d] = (out[d] || 0) + t.amount;
    });
    return out;
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCSV() {
    var rows = [['Date', 'Type', 'Description', 'Category', 'Account', 'To account', 'Amount', 'Note']];
    state.transactions.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (t) {
      var a = accountById(t.accountId), b = t.toAccountId ? accountById(t.toAccountId) : null;
      rows.push([t.date, t.type, t.description, t.category, a ? a.name : '', b ? b.name : '', t.amount.toFixed(2), t.note || '']);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  // Returns number of rows added. Works with our own export and with the older sample_data.csv layout.
  function importCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) return 0;
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    function col(names) {
      for (var i = 0; i < names.length; i++) { var k = head.indexOf(names[i]); if (k > -1) return k; }
      return -1;
    }
    var c = {
      date: col(['date']), type: col(['type']), desc: col(['description', 'merchant', 'title']),
      cat: col(['category']), acc: col(['account']), to: col(['to account']),
      amt: col(['amount']), note: col(['note', 'notes'])
    };
    if (c.date < 0 || c.amt < 0) return 0;
    var added = 0;
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var amount = Math.abs(parseFloat(String(row[c.amt]).replace(/[^0-9.\-]/g, '')));
      var date = (row[c.date] || '').trim();
      if (!amount || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      var type = (c.type > -1 ? row[c.type] : 'expense').trim().toLowerCase();
      if (['income', 'expense', 'transfer'].indexOf(type) < 0) type = 'expense';
      var accName = c.acc > -1 ? (row[c.acc] || '').trim() : '';
      var acc = null;
      state.accounts.forEach(function (a) { if (a.name.toLowerCase() === accName.toLowerCase()) acc = a; });
      if (!acc && accName) {
        acc = { id: uid('a'), name: accName, type: 'Bank', opening: 0, counted: true };
        state.accounts.push(acc);
      }
      if (!acc) acc = state.accounts[0];
      var toAcc = null;
      if (type === 'transfer' && c.to > -1) {
        var tn = (row[c.to] || '').trim().toLowerCase();
        state.accounts.forEach(function (a) { if (a.name.toLowerCase() === tn) toAcc = a; });
      }
      if (type === 'transfer' && !toAcc) type = 'expense';
      var cat = c.cat > -1 ? (row[c.cat] || '').trim() : 'Other';
      var list = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
      if (list.indexOf(cat) < 0) {
        var alias = { Entertainment: 'Fun', Utilities: 'Bills', Investment: 'Investment' };
        cat = alias[cat] && list.indexOf(alias[cat]) > -1 ? alias[cat] : 'Other';
      }
      state.transactions.push({
        id: uid('t'), date: date, type: type, description: (c.desc > -1 ? row[c.desc] : '') || 'Untitled',
        category: cat, accountId: acc.id, toAccountId: toAcc ? toAcc.id : null,
        amount: amount, note: c.note > -1 ? (row[c.note] || '') : ''
      });
      added++;
    }
    if (added) { state.isDemo = false; emit(); }
    return added;
  }

  window.TL = window.EF = window.TL || window.EF || {};
  window.TL.Store = window.EF.Store = {
    state: state, subscribe: subscribe,
    EXPENSE_CATS: EXPENSE_CATS, INCOME_CATS: INCOME_CATS, ACCOUNT_TYPES: ACCOUNT_TYPES, CURRENCIES: CURRENCIES,
    fmt: fmt, symbol: symbol, today: today, currentYM: currentYM, shiftYM: shiftYM, monthLabel: monthLabel,
    daysInMonth: daysInMonth, accountById: accountById, balanceOf: balanceOf, totalBalance: totalBalance,
    monthStats: monthStats, addTx: addTx, updateTx: updateTx, deleteTx: deleteTx, addAccount: addAccount,
    deleteAccount: deleteAccount, toggleCounted: toggleCounted, setProfile: setProfile, setPrivacy: setPrivacy,
    loadDemo: loadDemo, startFresh: startFresh, restoreTx: restoreTx, addRule: addRule, deleteRule: deleteRule,
    addGoal: addGoal, deleteGoal: deleteGoal, contributeGoal: contributeGoal, dayTotals: dayTotals, runRecurring: runRecurring, toCSV: toCSV, importCSV: importCSV, emit: emit
  };
})();
