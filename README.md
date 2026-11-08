# TrueLedger

A personal expense tracker that opens like a wallet. Static site, no build step, no backend.
Your data is stored in the browser (localStorage).

## Run it

    python3 -m http.server 8080      # or: npx serve .

Open http://localhost:8080. Deploys as-is to Vercel, Netlify or GitHub Pages.

## What's in the page

| Section | What it does |
|---|---|
| Hero | Scroll-scrubbed canvas: closed wallet, full wallet (your accounts as tags), empty wallet (what you spent). Glitch-slice transitions. |
| The month | Money in / out / kept, balance across accounts, 50-cell budget meter with month-end pace. Month switcher. |
| Accounts | Balance per account, switch an account off to leave it out of totals, add / delete. |
| Goals | Savings goals with a pink progress meter. Add money or take it out; "Reached" when you hit the target. |
| Ledger | Search, type / account / category / period filters, sort, add / edit / delete (delete has Undo). Spent, Received and Moved (transfer between accounts). Tick "Repeat every month" and rent, subscriptions or salary add themselves; manage them under "Repeating entries". |
| Where it went | Category breakdown (halftone bars), six-month trend, a day-by-day dot calendar (bigger dot = bigger spend), plain-language notes. Top merchants, month-over-month pace/velocity, recurring subscription detector, and unusual spending alerts. |
| Settings | Name, currency (symbol only), monthly budget, category-level spending limits, CSV export / multi-bank import, AES-256-GCM encrypted vault backup & restore, sample data, erase. |
| Parser & Review | ⚡ Paste bank SMS & UPI notifications (HDFC, SBI, ICICI, Axis, Kotak, GPay, PhonePe, Paytm, CRED). Dedicated raw events Review Queue, strict UPI Ref deduplication and fuzzy date deduplication. |

Works offline and can be installed to the home screen (service worker + manifest). When you ship changes, bump `CACHE` in `sw.js`.

## Power Features (Adapted from OwnSpend, PennyWise & Cashiro)

1. **Intelligent Message Parser (`js/parser.js`):**
   - Instant offline parsing of bank SMS and UPI payment notifications.
   - Extracts amount, debit/credit type, clean merchant name, transaction date, UPI reference / UTR ID, and bank/app source.
   - Normalized dictionary for popular Indian merchants (Swiggy, Zomato, Uber, Ola, Zepto, Blinkit, Amazon, Netflix, etc.).
2. **Review Queue Staging:**
   - Paste raw messages directly or stage incoming alerts in a dedicated review queue.
   - Review, edit, or accept one-by-one or in bulk before entries hit your ledger.
3. **Deduplication Engine:**
   - **Strict match:** Prevents duplicate entries with identical UPI UTR / reference numbers.
   - **Fuzzy match:** Detects identical amounts within $\pm 2$ days with matching descriptions (e.g. Bank SMS vs GPay notification).
4. **Auto-Categorization & Machine-Learning Rules:**
   - Built-in heuristic mappings for food, transport, bills, shopping, health, entertainment, etc.
   - Remembers user corrections: manually categorizing a merchant teaches TrueLedger to auto-categorize it next time.
5. **Subscription & Recurring Detection:**
   - Automatically detects repeating charges across distinct months and offers a 1-click button to convert them into recurring entries.
6. **Category-Level Budgets & MoM Velocity:**
   - Set monthly spending caps per category with visual progress meters and over-limit warnings.
   - Month-over-month delta comparisons, pace projections, and unusual spend alerts (>2.5x category average).
7. **Client-Side Encrypted Vault Backup (`.vault.json`):**
   - Military-grade client-side encryption using **AES-256-GCM** and **PBKDF2** (100,000 iterations).
   - Zero plain-text financial data ever leaves your device.
8. **Android Build & Background Capture:**
   - Full native architecture guide for Android background SMS & Notification listener services reusing `js/parser.js` directly on-device. See [Android Build Guide](docs/android-build.md).

Theme: dark by default. **Go light** in the top bar switches to paper-and-ink and remembers your choice. The wallet hero stays dark in both themes. Colours live in the token blocks at the top of `css/style.css`.

## Intro

A ~5 second film about what the site does, made from the visitor's own numbers (`js/intro.js`): your money for the month appears as one big number, your real expenses scroll past while it drains and the category bars fill, the number turns into an ASCII wallet that glitches into the real photo, TRUELEDGER slams in, then the screen dissolves away in halftone dither onto the wallet gate (or straight onto the hero).

- Plays **once per browser session**, so reloads and return visits don't repeat it. Add `?intro` to the URL to force it, `?nointro` to skip it (also skips the gate, handy while developing).
- **Skip:** the Skip intro button, or Esc / Enter / Space. A safety timer means it can never get stuck.
- **Replay:** Ctrl+K, then "Replay the intro".
- Reduced-motion visitors never see it. Timings are the `T_*` constants at the top of `js/intro.js`.

## The wallet gate

`js/gate.js` + `css/gate.css`. First visit: **Open your wallet** (name + 4 to 6 digit passcode) or **Quick demo access**. After a passcode is set: **Unlock wallet** each browser session. A tilting holographic card, floating coins, a halftone dot field that follows the mouse, a padlock on the card that opens as you type, and a halftone dissolve onto the site when it unlocks.

- The passcode is salted and hashed (SHA-256) and stored in this browser only. It **locks the screen; it does not encrypt your data**. Five wrong tries lock input for 30 seconds. "Forgot your passcode?" erases the wallet.
- Settings has **App lock** (set / change / remove PIN, lock now). Ctrl+K has "Lock wallet".
- `?nogate` skips it.

## Interactions

- Click **Money in / Money out** to open the ledger already filtered. Click **Kept** or **In your accounts** to jump to the reason.
- Click an **account name**, a **category row**, a **day on the calendar** or a **month in the six-month chart** and the ledger or page follows.
- Click any **ledger row** to edit it. Deleting shows **Undo**.
- Hero: the wallet follows your mouse, glitches when you click it, and the account tags are clickable.
- **Ctrl+K** (or **/**) opens the command palette: add things, jump to sections, switch theme, filter by category or account, or type words to search the ledger.
- The top nav highlights the section you are in. The cursor is custom (`js/cursor.js`): a dot plus a reticle whose brackets snap around whatever you can click, with a small label (EDIT, FILTER, OPEN...), a red/cyan split and trail when you move fast, and a pulse on click. It stays above dialogs. Touch devices and reduced-motion keep the normal cursor, and text fields keep the normal I-beam.

Shortcut: press **N** to add an entry. **Hide numbers** blurs every amount.

## Files

    index.html          markup + dialogs
    css/style.css       design tokens, type, layout
    js/store.js         state, localStorage, demo data, month stats, CSV
    js/cursor.js        custom cursor
    js/intro.js         story intro
    js/gate.js          wallet gate (create / unlock, PIN)
    css/gate.css        wallet gate look
    js/hero.js          canvas scroll sequence + glitch transitions
    js/app.js           rendering and forms
    assets/frames/      3 wallet frames used by the hero
    assets/fonts/       Big Shoulders Display + DM Mono (self-hosted)
    assets/icons/       app icons
    sw.js, manifest.webmanifest   offline + install

## Tweaking

- Colours: `:root` at the top of `css/style.css`. Pink = money in, red = money out.
- Hero length / feel: `.hero{height:540vh}` and the `timeline()` function in `js/hero.js`.
- Categories: `EXPENSE_CATS` / `INCOME_CATS` in `js/store.js`.
- Importing CSV: needs `Date` (YYYY-MM-DD) and `Amount` columns; `Type`, `Description`, `Category`, `Account`, `Note` are optional.
