/* TrueLedger — parser.js
   Intelligent Bank & UPI Message Parser for Indian Banks & Payment Apps.
   Normalizes merchants, extracts amounts, accounts, UPI UTR/reference IDs,
   and maps categories via built-in heuristics and learned rules.
   Zero external dependencies — works in browser & reusable in Android builds. */
(function () {
  'use strict';

  var DEFAULT_RULES = {
    // Food & Dining
    'swiggy': 'Food', 'zomato': 'Food', 'mcdonalds': 'Food', 'kfc': 'Food',
    'dominos': 'Food', 'pizza hut': 'Food', 'burger king': 'Food', 'subway': 'Food',
    'starbucks': 'Food', 'chai point': 'Food', 'chaayos': 'Food', 'cafe coffee day': 'Food',
    'restaurant': 'Food', 'dhaba': 'Food', 'bakery': 'Food', 'sweets': 'Food',
    'bikanervala': 'Food', 'haldiram': 'Food', 'barbeque': 'Food',

    // Groceries
    'zepto': 'Food', 'blinkit': 'Food', 'instamart': 'Food', 'bigbasket': 'Food',
    'bb daily': 'Food', 'dunzo': 'Food', 'nature basket': 'Food', 'dmart': 'Food',
    'spencer': 'Food', 'supermarket': 'Food', 'groceries': 'Food', 'vegetables': 'Food',

    // Transport & Fuel
    'uber': 'Transport', 'ola': 'Transport', 'rapido': 'Transport', 'metro': 'Transport',
    'irctc': 'Transport', 'indian railways': 'Transport', 'redbus': 'Transport',
    'makemytrip': 'Travel', 'goibibo': 'Travel', 'indigo': 'Travel', 'air india': 'Travel',
    'petrol': 'Transport', 'fuel': 'Transport', 'shell': 'Transport', 'indian oil': 'Transport',
    'hpcl': 'Transport', 'bpcl': 'Transport', 'cng': 'Transport', 'fastag': 'Transport',

    // Shopping & E-Commerce
    'amazon': 'Shopping', 'flipkart': 'Shopping', 'myntra': 'Shopping', 'ajio': 'Shopping',
    'meesho': 'Shopping', 'nykaa': 'Shopping', 'tata cliq': 'Shopping', 'zara': 'Shopping',
    'h&m': 'Shopping', 'decathlon': 'Shopping', 'croma': 'Shopping', 'reliance digital': 'Shopping',
    'ikea': 'Shopping', 'uniqlo': 'Shopping',

    // Entertainment & Subscriptions
    'netflix': 'Fun', 'spotify': 'Fun', 'prime video': 'Fun', 'hotstar': 'Fun',
    'disney': 'Fun', 'youtube': 'Fun', 'bookmyshow': 'Fun', 'pvr': 'Fun', 'inox': 'Fun',
    'apple': 'Fun', 'google play': 'Fun', 'steam': 'Fun', 'playstation': 'Fun',

    // Bills & Utilities
    'electricity': 'Bills', 'bescom': 'Bills', 'tneb': 'Bills', 'cesc': 'Bills',
    'airtel': 'Bills', 'jio': 'Bills', 'vi': 'Bills', 'vodafone': 'Bills',
    'act fibernet': 'Bills', 'broadband': 'Bills', 'wifi': 'Bills', 'water': 'Bills',
    'piped gas': 'Bills', 'indane': 'Bills', 'hp gas': 'Bills', 'bharat gas': 'Bills',

    // Health & Fitness
    'apollo': 'Health', 'pharmeasy': 'Health', '1mg': 'Health', 'tata 1mg': 'Health',
    'netmeds': 'Health', 'medplus': 'Health', 'hospital': 'Health', 'clinic': 'Health',
    'pharmacy': 'Health', 'cult.fit': 'Health', 'cultfit': 'Health', 'gym': 'Health',

    // Housing & Rent
    'nobroker': 'Housing', 'housing': 'Housing', 'society': 'Housing', 'maintenance': 'Housing',
    'rent': 'Housing'
  };

  var MONTH_MAP = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Clean raw merchant / info string into readable merchant name
  function normalizeMerchant(raw) {
    if (!raw) return 'Unknown';
    var s = String(raw).trim();

    // Strip UPI VPA suffixes like @okhdfcbank, @okaxis, @paytm, @ybl, etc.
    s = s.replace(/@[a-zA-Z0-9.-]+/g, '');

    // Strip common payment gateway and corporate suffixes
    s = s.replace(/\b(LTD|LIMITED|PVT|PRIVATE|CORP|SERVICES|PAYMENTS?|INDIA|RETAIL|STORE|OFFICIAL|ENTERPRISES?|SOLUTIONS?|ONLINE|DIRECT)\b/gi, '');

    // Strip common prefixes
    s = s.replace(/^(UPI[*_\s/-]|INFO:\s*|VPA\s*|TO\s*|AT\s*|PAYMENT TO\s*|PAID TO\s*)/i, '');

    // Strip trailing reference IDs or numbers
    s = s.replace(/[\-_*#\d]+$/g, '');

    // Clean punctuation and multiple spaces
    s = s.replace(/[*_/#\\]+/g, ' ').replace(/\s+/g, ' ').trim();

    if (!s) return 'Merchant';

    // Capitalize first letter of each word
    return s.split(' ').map(function (w) {
      if (!w) return '';
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  // Guess category using learned user rules first, then default keyword heuristics
  function categorize(merchant, customRules) {
    if (!merchant) return 'Other';
    var lower = merchant.toLowerCase();

    if (!customRules && typeof window !== 'undefined' && window.EF && window.EF.Store && window.EF.Store.state) {
      customRules = window.EF.Store.state.categoryRules;
    }

    // 1. Check custom user learned rules first
    if (customRules && typeof customRules === 'object') {
      var keys = Object.keys(customRules);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i].toLowerCase();
        if (lower.indexOf(k) > -1 || k.indexOf(lower) > -1) {
          return customRules[keys[i]];
        }
      }
    }

    // 2. Check built-in rules
    var defKeys = Object.keys(DEFAULT_RULES);
    for (var j = 0; j < defKeys.length; j++) {
      if (lower.indexOf(defKeys[j]) > -1) {
        return DEFAULT_RULES[defKeys[j]];
      }
    }

    return 'Other';
  }

  // Main Parser Function
  function parseMessage(text, customRules) {
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Empty message' };
    }

    var clean = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Amount Extraction
    // Patterns: Rs. 250, Rs 250.00, INR 1,234.50, ₹420, debited by 500, etc.
    var amtMatch = clean.match(/(?:Rs\.?|INR|₹|debited\s*(?:by|for|of)?\s*(?:Rs\.?|INR|₹)?|credited\s*(?:by|with|for)?\s*(?:Rs\.?|INR|₹)?)\s*([\d,]+(?:\.\d{1,2})?)/i);
    var amount = 0;
    if (amtMatch && amtMatch[1]) {
      amount = parseFloat(amtMatch[1].replace(/,/g, ''));
    } else {
      // Fallback: look for any number followed by currency or standalone price pattern
      var fallbackAmt = clean.match(/(?:paid|spent|received)\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                        clean.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:debited|credited)/i);
      if (fallbackAmt && fallbackAmt[1]) {
        amount = parseFloat(fallbackAmt[1].replace(/,/g, ''));
      }
    }

    if (!(amount > 0)) {
      return { success: false, error: 'Could not extract valid amount' };
    }

    // 2. Transaction Type (Expense vs Income)
    var type = 'expense';
    var isCredit = /(?:credited|received|deposited|refund(?:ed)?|cashback|salary|interest\s*credited)/i.test(clean) &&
                   !/(?:debited|spent|paid|transferred\s*to)/i.test(clean);
    if (isCredit) {
      type = 'income';
    }

    // 3. App / Bank detection
    var app = 'Bank SMS';
    if (/google\s*pay|gpay/i.test(clean)) app = 'GPay';
    else if (/phonepe/i.test(clean)) app = 'PhonePe';
    else if (/paytm/i.test(clean)) app = 'Paytm';
    else if (/cred\b/i.test(clean)) app = 'CRED';
    else if (/amazon\s*pay/i.test(clean)) app = 'Amazon Pay';
    else if (/hdfc/i.test(clean)) app = 'HDFC';
    else if (/sbi|state\s*bank/i.test(clean)) app = 'SBI';
    else if (/icici/i.test(clean)) app = 'ICICI';
    else if (/axis/i.test(clean)) app = 'Axis';
    else if (/kotak/i.test(clean)) app = 'Kotak';

    // 4. UPI Reference / UTR Number
    var upiMatch = clean.match(/(?:via\s*UPI|UPI\s*(?:Ref|txn)?(?:\s*no\.?)?|Ref(?:\s*no\.?)?|UTR(?:\s*no\.?)?|Txn\s*ID|Txn\s*no\.?|Trans\s*ID)\s*:?\s*([A-Za-z0-9]{8,18})/i) ||
                   clean.match(/UPI(?:\/DR|\/CR)?\/(\d{10,14})\b/i) ||
                   clean.match(/Info:\s*UPI[/*][^*]+?[/*]([A-Za-z0-9]{8,18})/i);
    var upiRef = upiMatch ? upiMatch[1] : '';

    // 5. Account or Card ending
    var accMatch = clean.match(/(?:A\/c|Account|Acct|a\/c)\s*(?:no\.?\s*)?(?:ending\s*)?(?:[xX*]+)?(\d{3,4})\b/i) ||
                   clean.match(/(?:Card|card)\s*(?:ending\s*)?(?:[xX*]+)?(\d{4})\b/i);
    var accountEnding = accMatch ? accMatch[1] : '';

    // 6. Merchant / Beneficiary Extraction
    var rawMerchant = '';

    // Check SBI-style UPI/DR/<ref>/<merchant>
    var sbiUpi = clean.match(/UPI\/(?:DR|CR)\/(\d+)\/([A-Za-z0-9\s._&*-]+?)(?:\/|\.|\s+Avbl|\s+Bal|$)/i);
    if (sbiUpi) {
      if (!upiRef) upiRef = sbiUpi[1];
      rawMerchant = sbiUpi[2];
    }

    // Check ICICI Info: UPI*<merchant>*<ref>
    var iciciUpi = clean.match(/Info:\s*UPI\*([^*]+?)\*([A-Za-z0-9]+)/i);
    if (iciciUpi) {
      rawMerchant = iciciUpi[1];
      if (!upiRef) upiRef = iciciUpi[2];
    }

    // Match "to <Merchant>" or "towards <Merchant>"
    if (!rawMerchant) {
      var toMatch = clean.match(/(?:paid\s+to|sent\s+to|payment\s+to|transferred\s+to|towards|to)\s+([A-Za-z0-9\s._&*-]+?)(?:\s+(?:on|via|ref|upi|using|avl|avbl|bal|at|from|with)|\.|\,|$|\n)/i);
      if (toMatch && toMatch[1] && !/^(a\/c|account|card)\b/i.test(toMatch[1].trim())) {
        rawMerchant = toMatch[1];
      }
    }

    if (!rawMerchant) {
      // Match "Info: UPI*<Merchant>*" or "Info: <Merchant>"
      var infoMatch = clean.match(/Info:\s*(?:UPI[/*])?([A-Za-z0-9\s._&*-]+?)(?:[/*]|\s+on|\.|$)/i);
      if (infoMatch && infoMatch[1]) {
        rawMerchant = infoMatch[1];
      }
    }

    if (!rawMerchant) {
      // Match "at <Merchant>"
      var atMatch = clean.match(/\bat\s+([A-Za-z0-9\s._&*-]+?)(?:\s+(?:on|via|ref|upi|using|avl|avbl|bal)|\.|\,|$|\n)/i);
      if (atMatch && atMatch[1]) {
        rawMerchant = atMatch[1];
      } else if (type === 'income') {
        // Check for salary or refund
        if (/salary/i.test(clean)) rawMerchant = 'Salary';
        else if (/refund/i.test(clean)) rawMerchant = 'Refund';
        else if (/cashback/i.test(clean)) rawMerchant = 'Cashback';
        else rawMerchant = 'Income';
      }
    }

    var merchant = normalizeMerchant(rawMerchant);
    if (merchant === 'Unknown' || merchant === 'Merchant') {
      if (type === 'income') merchant = 'Income';
      else merchant = app !== 'Bank SMS' ? app : 'Expense';
    }

    // 7. Date extraction
    var date = new Date().toISOString().slice(0, 10);
    var dateMatch = clean.match(/(\d{1,2})[-/](\d{1,2}|[A-Za-z]{3})[-/](\d{2,4})/);
    if (dateMatch) {
      var d = parseInt(dateMatch[1], 10);
      var m = dateMatch[2];
      var y = parseInt(dateMatch[3], 10);
      if (y < 100) y += 2000;
      var mNum = MONTH_MAP[m.toLowerCase().slice(0, 3)] || pad(parseInt(m, 10) || 1);
      date = y + '-' + mNum + '-' + pad(d);
    }

    // 8. Auto-categorize
    var category = categorize(merchant, customRules);
    if (type === 'income') {
      category = /salary/i.test(merchant) ? 'Salary' : (/freelance/i.test(merchant) ? 'Freelance' : 'Other');
    }

    return {
      success: true,
      amount: Math.round(amount * 100) / 100,
      type: type,
      description: merchant,
      merchant: merchant,
      category: category,
      date: date,
      accountEnding: accountEnding,
      accountNumber: accountEnding,
      upiRef: upiRef,
      app: app,
      paymentApp: app,
      rawText: text.trim()
    };
  }

  // Deduplication Checker
  // Compares parsed candidate against existing transactions & review queue
  function checkDuplicate(parsed, existingTransactions, existingQueue) {
    if (!parsed || !parsed.amount) return null;

    // Rule 1: Strict UPI Ref match
    if (parsed.upiRef) {
      if (existingTransactions && existingTransactions.length) {
        for (var i = 0; i < existingTransactions.length; i++) {
          if (existingTransactions[i].upiRef && existingTransactions[i].upiRef === parsed.upiRef) {
            return {
              isDuplicate: true,
              type: 'strict',
              matchedId: existingTransactions[i].id,
              reason: 'Identical UPI Reference (' + parsed.upiRef + ') already logged on ' + existingTransactions[i].date
            };
          }
        }
      }
      if (existingQueue && existingQueue.length) {
        for (var j = 0; j < existingQueue.length; j++) {
          var qp = existingQueue[j].parsed;
          if (qp && qp.upiRef && qp.upiRef === parsed.upiRef) {
            return {
              isDuplicate: true,
              type: 'strict',
              matchedId: existingQueue[j].id,
              reason: 'Identical UPI Reference (' + parsed.upiRef + ') already pending in review queue'
            };
          }
        }
      }
    }

    // Rule 2: Fuzzy match — exact same amount, matching type, and within ±2 days with matching description
    if (existingTransactions && existingTransactions.length) {
      for (var k = 0; k < existingTransactions.length; k++) {
        var tx = existingTransactions[k];
        if (Math.abs(tx.amount - parsed.amount) < 0.01 && tx.type === parsed.type) {
          // Check date distance
          var diffDays = Math.abs((new Date(tx.date) - new Date(parsed.date)) / (1000 * 60 * 60 * 24));
          if (diffDays <= 2) {
            var descA = (tx.description || '').toLowerCase();
            var descB = (parsed.description || '').toLowerCase();
            if (descA === descB || descA.indexOf(descB) > -1 || descB.indexOf(descA) > -1) {
              return {
                isDuplicate: true,
                type: 'fuzzy',
                matchedId: tx.id,
                reason: 'Matches entry for ' + tx.amount + ' (' + tx.description + ') on ' + tx.date
              };
            }
          }
        }
      }
    }

    return null;
  }

  // Export module
  var root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
  root.EF = root.EF || {};
  root.EF.Parser = {
    parse: parseMessage,
    normalizeMerchant: normalizeMerchant,
    categorize: categorize,
    checkDuplicate: checkDuplicate,
    DEFAULT_RULES: DEFAULT_RULES
  };

  // Node.js module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.EF.Parser;
  }
})();
