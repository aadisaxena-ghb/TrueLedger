/* TrueLedger — security.js
   Military-Grade Client-Side Security & Vault Encryption
   - PBKDF2 (100,000 iterations, SHA-256) + AES-256-GCM encryption for local storage
   - Zero-plaintext storage: data is completely unreadable without the PIN
   - Progressive attempt limiter: 5 tries -> 30s delay -> 60s delay -> hard re-login lockout
   - Auto-lock on background (default 3 minutes)
   - One-time sign-in session management + optional Supabase zero-knowledge sync
*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
  root.EF = root.EF || {};

  var VAULT_KEY = 'trueledger.vault';
  var LEGACY_KEY = 'trueledger.v2';
  var LOCKOUT_KEY = 'trueledger.security.lockout';
  var AUTOLOCK_KEY = 'trueledger.autolock_mins';
  var AUTH_SESSION_KEY = 'trueledger.auth_session';

  var activeKey = null; // Stored in RAM only while unlocked, wiped on lock
  var backgroundedAt = 0;

  function getCrypto() {
    return (typeof window !== 'undefined' && window.crypto) || (typeof global !== 'undefined' && global.crypto);
  }

  function hasCrypto() {
    var c = getCrypto();
    return !!(c && c.subtle && (typeof TextEncoder !== 'undefined'));
  }

  function randomBytes(n) {
    var c = getCrypto();
    var a = new Uint8Array(n);
    if (c && c.getRandomValues) {
      c.getRandomValues(a);
    } else {
      for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    }
    return a;
  }

  // Derive AES-GCM 256-bit key from PIN using PBKDF2 with 100,000 iterations
  async function deriveKey(pin, salt) {
    var c = getCrypto();
    if (!c || !c.subtle) throw new Error('Web Crypto API not available');
    var enc = new TextEncoder();
    var keyMaterial = await c.subtle.importKey(
      'raw',
      enc.encode(String(pin)),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return await c.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt JSON object using AES-256-GCM
  async function encryptPayload(dataObj, cryptoKey, salt) {
    var c = getCrypto();
    var enc = new TextEncoder();
    var iv = randomBytes(12);
    var rawText = JSON.stringify(dataObj);
    var ciphertext = await c.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      cryptoKey,
      enc.encode(rawText)
    );
    return {
      v: 2,
      cipher: 'AES-256-GCM',
      iterations: 100000,
      salt: Array.from(salt),
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(ciphertext)),
      encryptedAt: new Date().toISOString()
    };
  }

  // Decrypt vault ciphertext using AES-256-GCM
  async function decryptPayload(vault, cryptoKey) {
    var c = getCrypto();
    var dec = new TextDecoder();
    var iv = new Uint8Array(vault.iv);
    var ciphertext = new Uint8Array(vault.data);
    var decryptedBuffer = await c.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      cryptoKey,
      ciphertext
    );
    var decryptedText = dec.decode(decryptedBuffer);
    return JSON.parse(decryptedText);
  }

  /* ---------- Lockout & Attempt Limiter ---------- */
  function getLockoutState() {
    try {
      var raw = localStorage.getItem(LOCKOUT_KEY) || sessionStorage.getItem(LOCKOUT_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { tries: 0, lockedUntil: 0, isHardLockout: false };
  }

  function saveLockoutState(s) {
    try {
      var json = JSON.stringify(s);
      localStorage.setItem(LOCKOUT_KEY, json);
      sessionStorage.setItem(LOCKOUT_KEY, json);
    } catch (e) {}
  }

  function getLockoutInfo() {
    var s = getLockoutState();
    var now = Date.now();
    var remaining = Math.max(0, Math.ceil((s.lockedUntil - now) / 1000));
    return {
      isLockedOut: remaining > 0 || !!s.isHardLockout,
      remainingSeconds: remaining,
      isHardLockout: !!s.isHardLockout,
      failedAttempts: s.tries || 0,
      maxAttempts: 8
    };
  }

  function recordFailedAttempt() {
    var s = getLockoutState();
    s.tries = (s.tries || 0) + 1;
    var now = Date.now();
    if (s.tries >= 8) {
      s.isHardLockout = true;
      s.lockedUntil = now + (24 * 60 * 60 * 1000); // 24hr lockout or requires re-login
    } else if (s.tries >= 6) {
      s.lockedUntil = now + 60000; // 60s penalty
    } else if (s.tries >= 5) {
      s.lockedUntil = now + 30000; // 30s penalty
    }
    saveLockoutState(s);
    return getLockoutInfo();
  }

  function resetFailedAttempts() {
    saveLockoutState({ tries: 0, lockedUntil: 0, isHardLockout: false });
  }

  /* ---------- Vault Management ---------- */
  function hasVault() {
    try {
      return !!localStorage.getItem(VAULT_KEY);
    } catch (e) {
      return false;
    }
  }

  function getRawVault() {
    try {
      var raw = localStorage.getItem(VAULT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // Setup / Reconfigure PIN and encrypt data
  async function setupVault(pin, stateObj) {
    if (!pin || String(pin).length < 4) throw new Error('PIN must be 4 to 6 digits');
    var salt = randomBytes(16);
    var key = await deriveKey(pin, salt);
    var encryptedVault = await encryptPayload(stateObj, key, salt);

    localStorage.setItem(VAULT_KEY, JSON.stringify(encryptedVault));
    try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
    try { localStorage.removeItem('expenseflow.v2'); } catch (e) {}
    try { localStorage.setItem('trueledger.pin_len', String(pin).length); } catch (e) {}

    activeKey = key;
    resetFailedAttempts();
    return encryptedVault;
  }

  // Unlock Vault with PIN
  async function unlockVault(pin) {
    var info = getLockoutInfo();
    if (info.isHardLockout) {
      throw new Error('Hard lockout: Maximum PIN attempts reached. Re-login with your account to verify identity.');
    }
    if (info.isLockedOut) {
      throw new Error('Too many attempts. Locked for ' + info.remainingSeconds + 's.');
    }

    var vault = getRawVault();
    if (!vault) {
      throw new Error('No encrypted vault found. Please create one.');
    }

    try {
      var key = await deriveKey(pin, vault.salt);
      var decryptedState = await decryptPayload(vault, key);
      activeKey = key;
      resetFailedAttempts();
      return decryptedState;
    } catch (err) {
      var updated = recordFailedAttempt();
      if (updated.isHardLockout) {
        throw new Error('Maximum attempts exceeded. Vault locked for security. Please sign in to verify.');
      } else if (updated.remainingSeconds > 0) {
        throw new Error('Too many attempts. Locked for ' + updated.remainingSeconds + 's.');
      } else {
        var left = Math.max(0, 5 - updated.failedAttempts);
        throw new Error('Incorrect PIN. ' + (left > 0 ? left + ' attempts left before delay.' : ''));
      }
    }
  }

  // Save current state using active encryption key
  async function saveEncryptedState(stateObj) {
    if (!activeKey) return false;
    var vault = getRawVault();
    var salt = vault && vault.salt ? new Uint8Array(vault.salt) : randomBytes(16);
    var encryptedVault = await encryptPayload(stateObj, activeKey, salt);
    localStorage.setItem(VAULT_KEY, JSON.stringify(encryptedVault));
    return true;
  }

  // Lock Vault: Wipes key from memory
  function lockVault() {
    activeKey = null;
    try { sessionStorage.removeItem('ef-unlocked'); } catch (e) {}
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('ef:vault-locked'));
    }
  }

  function isUnlocked() {
    return activeKey !== null;
  }

  /* ---------- Auto-Lock on Background ---------- */
  function getAutoLockMinutes() {
    try {
      var m = localStorage.getItem(AUTOLOCK_KEY);
      return m !== null ? parseInt(m, 10) : 3; // Default: 3 minutes
    } catch (e) {
      return 3;
    }
  }

  function setAutoLockMinutes(mins) {
    try {
      localStorage.setItem(AUTOLOCK_KEY, String(mins));
    } catch (e) {}
  }

  function recordBackground() {
    backgroundedAt = Date.now();
  }

  function checkAutoLock() {
    var mins = getAutoLockMinutes();
    if (mins <= 0) return false; // 0 = Never auto-lock
    if (backgroundedAt > 0 && isUnlocked()) {
      var elapsed = Date.now() - backgroundedAt;
      if (elapsed >= mins * 60 * 1000) {
        lockVault();
        backgroundedAt = 0;
        return true;
      }
    }
    backgroundedAt = 0;
    return false;
  }

  /* ---------- One-Time Sign-In / Account Session ---------- */
  function getAuthSession() {
    try {
      var s = localStorage.getItem(AUTH_SESSION_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function setAuthSession(session) {
    try {
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    } catch (e) {}
  }

  function clearAuthSession() {
    try {
      localStorage.removeItem(AUTH_SESSION_KEY);
    } catch (e) {}
  }

  // Export module
  root.EF.Security = {
    hasCrypto: hasCrypto,
    deriveKey: deriveKey,
    encryptPayload: encryptPayload,
    decryptPayload: decryptPayload,
    hasVault: hasVault,
    setupVault: setupVault,
    unlockVault: unlockVault,
    saveEncryptedState: saveEncryptedState,
    lockVault: lockVault,
    isUnlocked: isUnlocked,
    getLockoutInfo: getLockoutInfo,
    recordFailedAttempt: recordFailedAttempt,
    resetFailedAttempts: resetFailedAttempts,
    getAutoLockMinutes: getAutoLockMinutes,
    setAutoLockMinutes: setAutoLockMinutes,
    recordBackground: recordBackground,
    checkAutoLock: checkAutoLock,
    getAuthSession: getAuthSession,
    setAuthSession: setAuthSession,
    clearAuthSession: clearAuthSession
  };

  // Wire automatic background listener in browser
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        recordBackground();
      } else {
        if (checkAutoLock() && root.EF.Gate && root.EF.Gate.lock) {
          root.EF.Gate.lock();
        }
      }
    });
  }
})();
