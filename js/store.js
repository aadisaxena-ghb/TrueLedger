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
  var MONTH_MAP = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
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
      profile: { name: '', currency: cur, budget: demo.budget, categoryBudgets: {} },
      accounts: demo.accounts,
      transactions: demo.transactions,
      goals: demo.goals,
      recurring: demo.recurring,
      reviewQueue: [],
      categoryRules: {},
      isDemo: true,
      privacy: false
    };
  }

  function load() {
    try {
      var Sec = (typeof window !== 'undefined' && window.EF && window.EF.Security) || (typeof root !== 'undefined' && root.EF && root.EF.Security);
      if (Sec && Sec.hasVault()) {
        // Encrypted vault exists on device. The ledger is locked until decrypted with PIN.
        return freshState();
      }
      var raw = localStorage.getItem(KEY) || localStorage.getItem('expenseflow.v2');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 2 && s.accounts && s.transactions) {
          s.goals = s.goals || []; s.recurring = s.recurring || [];
          s.reviewQueue = s.reviewQueue || [];
          s.categoryRules = s.categoryRules || {};
          s.profile = s.profile || {};
          s.profile.categoryBudgets = s.profile.categoryBudgets || {};
          return s;
        }
      }
    } catch (e) {}
    return freshState();
  }

  var listeners = [];
  function save() {
    try {
      var Sec = (typeof window !== 'undefined' && window.EF && window.EF.Security) || (typeof root !== 'undefined' && root.EF && root.EF.Security);
      if (Sec && Sec.isUnlocked()) {
        Sec.saveEncryptedState(state);
      } else if (!Sec || !Sec.hasVault()) {
        localStorage.setItem(KEY, JSON.stringify(state));
      }
    } catch (e) {}
  }
  function emit() { save(); listeners.forEach(function (fn) { fn(); }); }
  function subscribe(fn) { listeners.push(fn); }

  function restoreDecryptedState(decrypted) {
    if (!decrypted || !decrypted.accounts || !decrypted.transactions) return;
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.assign(state, decrypted);
    state.isDemo = false;
    emit();
  }

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
    var income = 0, spent = 0, byCat = {}, byMerchant = {}, biggest = null, count = 0;
    var txList = [];
    state.transactions.forEach(function (t) {
      if (ymOf(t.date) !== ym || !ids[t.accountId]) return;
      if (t.type === 'income') { income += t.amount; count++; }
      else if (t.type === 'expense') {
        spent += t.amount; count++;
        txList.push(t);
        byCat[t.category] = (byCat[t.category] || 0) + t.amount;
        var merch = (t.merchant || t.description || 'Unknown').trim();
        byMerchant[merch] = (byMerchant[merch] || 0) + t.amount;
        if (!biggest || t.amount > biggest.amount) biggest = t;
      }
    });

    var categoryBudgets = (state.profile && state.profile.categoryBudgets) || {};
    var cats = Object.keys(byCat).map(function (k) {
      var budget = categoryBudgets[k] || 0;
      return {
        name: k,
        total: byCat[k],
        budget: budget,
        over: budget > 0 && byCat[k] > budget,
        pct: budget > 0 ? Math.round((byCat[k] / budget) * 100) : null
      };
    }).sort(function (a, b) { return b.total - a.total; });

    var topMerchants = Object.keys(byMerchant).map(function (k) {
      return { name: k, total: byMerchant[k], pct: spent > 0 ? Math.round((byMerchant[k] / spent) * 100) : 0 };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 5);

    // Month-over-month comparison vs previous month
    var prevYM = shiftYM(ym, -1);
    var prevSpent = 0;
    state.transactions.forEach(function (t) {
      if (ymOf(t.date) === prevYM && ids[t.accountId] && t.type === 'expense') {
        prevSpent += t.amount;
      }
    });
    var momDiff = prevSpent > 0 ? spent - prevSpent : 0;
    var momPct = prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;

    // Unusual spend alerts: any spend >= 2.5x category average
    var unusualAlerts = [];
    cats.forEach(function (c) {
      var catTx = txList.filter(function (t) { return t.category === c.name; });
      if (catTx.length >= 3) {
        var avg = c.total / catTx.length;
        catTx.forEach(function (t) {
          if (t.amount >= avg * 2.5 && t.amount > 50) {
            unusualAlerts.push({
              tx: t,
              category: c.name,
              amount: t.amount,
              avg: Math.round(avg),
              ratio: (t.amount / avg).toFixed(1)
            });
          }
        });
      }
    });

    var isNow = ym === currentYM();
    var dim = daysInMonth(ym);
    var dayN = isNow ? new Date().getDate() : dim;
    var projected = isNow && dayN > 0 ? (spent / dayN) * dim : spent;
    return {
      ym: ym, income: income, spent: spent, net: income - spent, cats: cats, biggest: biggest,
      count: count, isNow: isNow, daysLeft: dim - dayN, projected: projected,
      perDay: dayN > 0 ? spent / dayN : 0,
      rate: income > 0 ? (income - spent) / income : null,
      topMerchants: topMerchants,
      prevSpent: prevSpent,
      momDiff: momDiff,
      momPct: momPct,
      unusualAlerts: unusualAlerts
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

  /* ---------- review queue & rules ---------- */
  function addToReviewQueue(rawText, parsed) {
    if (!parsed) {
      var Parser = (typeof window !== 'undefined' && window.EF && window.EF.Parser) || (typeof root !== 'undefined' && root.EF && root.EF.Parser);
      if (Parser) {
        parsed = Parser.parse(rawText, state.categoryRules);
      } else {
        return null;
      }
    }
    if (!parsed || parsed.success === false || !(parsed.amount > 0)) return null;

    var ParserMod = (typeof window !== 'undefined' && window.EF && window.EF.Parser) || (typeof root !== 'undefined' && root.EF && root.EF.Parser);
    var dup = null;
    if (ParserMod) {
      dup = ParserMod.checkDuplicate(parsed, state.transactions, state.reviewQueue);
    }

    var item = {
      id: uid('rq'),
      rawText: rawText,
      parsed: parsed,
      status: 'pending',
      isDuplicate: !!(dup && dup.isDuplicate),
      duplicateReason: dup ? dup.reason : '',
      createdAt: new Date().toISOString()
    };

    state.reviewQueue = state.reviewQueue || [];
    state.reviewQueue.unshift(item);
    emit();
    return item;
  }

  function acceptReviewItem(id, overrides) {
    state.reviewQueue = state.reviewQueue || [];
    var idx = -1;
    for (var i = 0; i < state.reviewQueue.length; i++) {
      if (state.reviewQueue[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return null;

    var item = state.reviewQueue[idx];
    var p = Object.assign({}, item.parsed, overrides || {});

    var accId = p.accountId;
    if (!accId && state.accounts.length) {
      if (p.accountEnding) {
        var matched = null;
        state.accounts.forEach(function (a) {
          if (a.name.indexOf(p.accountEnding) > -1) matched = a;
        });
        accId = matched ? matched.id : state.accounts[0].id;
      } else {
        accId = state.accounts[0].id;
      }
    }

    var tx = {
      id: uid('t'),
      date: p.date || today(),
      type: p.type || 'expense',
      description: p.description || p.merchant || 'Expense',
      merchant: p.merchant || p.description,
      category: p.category || 'Other',
      accountId: accId,
      toAccountId: p.toAccountId || null,
      amount: Math.round(p.amount * 100) / 100,
      note: p.note || (p.upiRef ? 'UPI Ref: ' + p.upiRef : ''),
      upiRef: p.upiRef || '',
      paymentApp: p.app || '',
      rawText: item.rawText || ''
    };

    state.transactions.push(tx);

    if (p.merchant && p.category) {
      learnCategory(p.merchant, p.category);
    }

    state.reviewQueue.splice(idx, 1);
    emit();
    return tx;
  }

  function acceptAllReviewItems() {
    var accepted = 0;
    var pending = (state.reviewQueue || []).filter(function (it) { return it.status === 'pending' && !it.isDuplicate; });
    pending.forEach(function (it) {
      if (acceptReviewItem(it.id)) accepted++;
    });
    return accepted;
  }

  function dismissReviewItem(id) {
    state.reviewQueue = (state.reviewQueue || []).filter(function (it) { return it.id !== id; });
    emit();
  }

  function clearReviewQueue() {
    state.reviewQueue = [];
    emit();
  }

  function learnCategory(merchant, category) {
    if (!merchant || !category) return;
    state.categoryRules = state.categoryRules || {};
    state.categoryRules[merchant.toLowerCase().trim()] = category;
    save();
  }

  function setCategoryBudget(category, amount) {
    state.profile = state.profile || {};
    state.profile.categoryBudgets = state.profile.categoryBudgets || {};
    if (amount > 0) {
      state.profile.categoryBudgets[category] = amount;
    } else {
      delete state.profile.categoryBudgets[category];
    }
    emit();
  }

  function getCategoryBudgets() {
    return (state.profile && state.profile.categoryBudgets) || {};
  }

  /* ---------- subscription detection ---------- */
  function detectSubscriptions() {
    var byMerch = {};
    state.transactions.forEach(function (t) {
      if (t.type !== 'expense') return;
      var m = (t.merchant || t.description || '').trim();
      if (!m || m.length < 2) return;
      var key = m.toLowerCase();
      byMerch[key] = byMerch[key] || { name: m, txs: [] };
      byMerch[key].txs.push(t);
    });

    var candidates = [];
    var existingRecurringNames = (state.recurring || []).map(function (r) { return r.description.toLowerCase(); });

    Object.keys(byMerch).forEach(function (k) {
      var entry = byMerch[k];
      if (entry.txs.length < 2) return;
      if (existingRecurringNames.some(function (rn) { return rn.indexOf(k) > -1 || k.indexOf(rn) > -1; })) return;

      var byMonth = {};
      entry.txs.forEach(function (t) {
        var ym = ymOf(t.date);
        byMonth[ym] = byMonth[ym] || [];
        byMonth[ym].push(t);
      });

      var months = Object.keys(byMonth).sort();
      if (months.length >= 2) {
        var amounts = entry.txs.map(function (t) { return t.amount; }).sort(function (a, b) { return a - b; });
        var median = amounts[Math.floor(amounts.length / 2)];
        var consistent = amounts.every(function (a) { return Math.abs(a - median) / median < 0.20; });
        if (consistent && median > 0) {
          var latestTx = entry.txs.slice().sort(function (a, b) { return b.date.localeCompare(a.date); })[0];
          var day = parseInt(latestTx.date.slice(8, 10), 10) || 1;
          candidates.push({
            merchant: entry.name,
            amount: median,
            category: latestTx.category || 'Bills',
            monthsCount: months.length,
            lastDate: latestTx.date,
            day: Math.min(28, day),
            accountId: latestTx.accountId
          });
        }
      }
    });

    return candidates.sort(function (a, b) { return b.monthsCount - a.monthsCount; });
  }

  /* ---------- encrypted vault backup (AES-256-GCM) ---------- */
  async function exportEncrypted(password) {
    if (!password) throw new Error('Password required');
    var raw = JSON.stringify({ v: 2, state: state, exportedAt: new Date().toISOString() });
    var enc = new TextEncoder();
    var cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof global !== 'undefined' && global.crypto);
    if (!cryptoObj || !cryptoObj.subtle) throw new Error('Web Crypto API not available');
    var salt = cryptoObj.getRandomValues(new Uint8Array(16));
    var iv = cryptoObj.getRandomValues(new Uint8Array(12));
    var keyMaterial = await cryptoObj.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await cryptoObj.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    var ciphertext = await cryptoObj.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(raw));
    return JSON.stringify({
      app: 'TrueLedger',
      version: 2,
      cipher: 'AES-256-GCM',
      iterations: 100000,
      salt: Array.from(salt),
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(ciphertext))
    }, null, 2);
  }

  async function importEncrypted(vaultJson, password) {
    if (!password) throw new Error('Password required');
    var vault = typeof vaultJson === 'string' ? JSON.parse(vaultJson) : vaultJson;
    if (!vault || !vault.salt || !vault.iv || !vault.data) throw new Error('Invalid vault file format');
    var enc = new TextEncoder();
    var dec = new TextDecoder();
    var cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof global !== 'undefined' && global.crypto);
    if (!cryptoObj || !cryptoObj.subtle) throw new Error('Web Crypto API not available');
    var salt = new Uint8Array(vault.salt);
    var iv = new Uint8Array(vault.iv);
    var ciphertext = new Uint8Array(vault.data);
    var keyMaterial = await cryptoObj.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await cryptoObj.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: vault.iterations || 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    var decryptedBuffer = await cryptoObj.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
    var decryptedJson = dec.decode(decryptedBuffer);
    var parsed = JSON.parse(decryptedJson);
    if (parsed && parsed.state && parsed.state.accounts && parsed.state.transactions) {
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.assign(state, parsed.state);
      state.isDemo = false;
      emit();
      return true;
    }
    throw new Error('Corrupted or invalid backup contents');
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCSV() {
    var rows = [['Date', 'Type', 'Description', 'Category', 'Account', 'To account', 'Amount', 'Note', 'UPI Ref', 'App']];
    state.transactions.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (t) {
      var a = accountById(t.accountId), b = t.toAccountId ? accountById(t.toAccountId) : null;
      rows.push([
        t.date, t.type, t.description, t.category, a ? a.name : '', b ? b.name : '',
        t.amount.toFixed(2), t.note || '', t.upiRef || '', t.paymentApp || ''
      ]);
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

  // Returns number of rows added. Supports TrueLedger format and multi-bank statements (HDFC, SBI, ICICI, Axis, Kotak, GPay, PhonePe).
  function importCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) return 0;
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    function col(names) {
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        for (var h = 0; h < head.length; h++) {
          if (head[h] === n || head[h].indexOf(n) > -1) return h;
        }
      }
      return -1;
    }

    var c = {
      date: col(['txn date', 'transaction date', 'value date', 'posting date', 'date']),
      type: col(['type', 'cr/dr', 'd/c', 'dr/cr']),
      desc: col(['narration', 'particulars', 'description', 'merchant', 'remarks', 'details', 'title']),
      cat: col(['category']),
      acc: col(['account', 'account name']),
      to: col(['to account']),
      amt: col(['amount', 'net amount', 'total amount', 'txn amount']),
      debit: col(['debit', 'withdrawal', 'dr amount', 'withdrawal amount', 'dr']),
      credit: col(['credit', 'deposit', 'cr amount', 'deposit amount', 'cr']),
      note: col(['note', 'notes', 'reference', 'ref no', 'chq/ref no', 'utr', 'cheque no'])
    };

    var dateCol = c.date > -1 ? c.date : col(['date']);
    if (dateCol < 0) return 0;
    if (c.amt < 0 && c.debit < 0 && c.credit < 0) return 0;

    var added = 0;
    var Parser = (typeof window !== 'undefined' && window.EF && window.EF.Parser) || (typeof root !== 'undefined' && root.EF && root.EF.Parser);

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.length < 2) continue;

      var rawDate = (row[dateCol] || '').trim();
      var date = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        date = rawDate;
      } else {
        var dmy = rawDate.match(/^(\d{1,2})[-/.](\d{1,2}|[A-Za-z]{3})[-/.](\d{2,4})/);
        if (dmy) {
          var day = parseInt(dmy[1], 10);
          var mon = dmy[2];
          var yr = parseInt(dmy[3], 10);
          if (yr < 100) yr += 2000;
          var monNum = MONTH_MAP[mon.toLowerCase().slice(0, 3)] || pad(parseInt(mon, 10) || 1);
          date = yr + '-' + monNum + '-' + pad(day);
        }
      }
      if (!date) continue;

      var rawDesc = (c.desc > -1 ? row[c.desc] : '') || 'Bank Entry';
      var amount = 0;
      var type = 'expense';

      if (c.debit > -1 && row[c.debit] && parseFloat(String(row[c.debit]).replace(/[^0-9.]/g, '')) > 0) {
        amount = parseFloat(String(row[c.debit]).replace(/[^0-9.]/g, ''));
        type = 'expense';
      } else if (c.credit > -1 && row[c.credit] && parseFloat(String(row[c.credit]).replace(/[^0-9.]/g, '')) > 0) {
        amount = parseFloat(String(row[c.credit]).replace(/[^0-9.]/g, ''));
        type = 'income';
      } else if (c.amt > -1 && row[c.amt]) {
        var strAmt = String(row[c.amt]).trim();
        var isNeg = strAmt.indexOf('-') > -1 || strAmt.indexOf('(') > -1 || /dr/i.test(strAmt);
        amount = Math.abs(parseFloat(strAmt.replace(/[^0-9.\-]/g, '')) || 0);
        if (c.type > -1 && row[c.type]) {
          var tStr = row[c.type].toLowerCase().trim();
          type = (tStr === 'cr' || tStr === 'credit' || tStr === 'income') ? 'income' : 'expense';
        } else {
          type = isNeg ? 'expense' : 'expense';
          if (/(?:salary|refund|interest|credit|deposit)/i.test(rawDesc)) type = 'income';
        }
      }

      if (!(amount > 0)) continue;

      var accName = c.acc > -1 ? (row[c.acc] || '').trim() : '';
      var acc = null;
      state.accounts.forEach(function (a) { if (a.name.toLowerCase() === accName.toLowerCase()) acc = a; });
      if (!acc && accName) {
        acc = { id: uid('a'), name: accName, type: 'Bank', opening: 0, counted: true };
        state.accounts.push(acc);
      }
      if (!acc) acc = state.accounts[0];

      var merchant = rawDesc;
      var cat = c.cat > -1 ? (row[c.cat] || '').trim() : '';
      if (Parser) {
        merchant = Parser.normalizeMerchant(rawDesc);
        if (!cat) cat = Parser.categorize(merchant, state.categoryRules);
      }
      if (!cat) cat = type === 'income' ? 'Salary' : 'Other';

      state.transactions.push({
        id: uid('t'),
        date: date,
        type: type,
        description: merchant || rawDesc,
        merchant: merchant || rawDesc,
        category: cat,
        accountId: acc.id,
        toAccountId: null,
        amount: Math.round(amount * 100) / 100,
        note: c.note > -1 ? (row[c.note] || '') : ''
      });
      added++;
    }

    if (added) { state.isDemo = false; emit(); }
    return added;
  }

  var root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
  root.TL = root.EF = root.TL || root.EF || {};
  root.TL.Store = root.EF.Store = {
    state: state, subscribe: subscribe,
    EXPENSE_CATS: EXPENSE_CATS, INCOME_CATS: INCOME_CATS, ACCOUNT_TYPES: ACCOUNT_TYPES, CURRENCIES: CURRENCIES,
    fmt: fmt, symbol: symbol, today: today, currentYM: currentYM, shiftYM: shiftYM, monthLabel: monthLabel,
    daysInMonth: daysInMonth, accountById: accountById, balanceOf: balanceOf, totalBalance: totalBalance,
    monthStats: monthStats, addTx: addTx, updateTx: updateTx, deleteTx: deleteTx, addAccount: addAccount,
    deleteAccount: deleteAccount, toggleCounted: toggleCounted, setProfile: setProfile, setPrivacy: setPrivacy,
    loadDemo: loadDemo, startFresh: startFresh, restoreTx: restoreTx, addRule: addRule, deleteRule: deleteRule,
    addGoal: addGoal, deleteGoal: deleteGoal, contributeGoal: contributeGoal, dayTotals: dayTotals, runRecurring: runRecurring,
    toCSV: toCSV, importCSV: importCSV, emit: emit,
    addToReviewQueue: addToReviewQueue, acceptReviewItem: acceptReviewItem, acceptAllReviewItems: acceptAllReviewItems,
    dismissReviewItem: dismissReviewItem, clearReviewQueue: clearReviewQueue, learnCategory: learnCategory,
    setCategoryBudget: setCategoryBudget, getCategoryBudgets: getCategoryBudgets,
    detectSubscriptions: detectSubscriptions, exportEncrypted: exportEncrypted, importEncrypted: importEncrypted,
    restoreDecryptedState: restoreDecryptedState
  };
})();
