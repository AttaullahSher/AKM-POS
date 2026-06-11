# AKM-POS — AI Feature Plan

> Status: **Planned / not yet implemented.** This document is the design spec for the
> next development phase. Nothing here ships until each phase is built and approved.
> Author: engineering. Last updated: 2026-06-10.

The user requested three AI capabilities:

1. **Spelling correction / smart suggestions** while typing invoice & repair fields.
2. **Inventory recording** — turn the items already typed on invoices into a live stock ledger.
3. **Detailed monthly AI reporting** — a written, business-grade summary of each month.

This doc explains *how* each is built on top of the existing Firebase app, the
**critical security rule** (the API key must never reach the browser), the data-model
additions, cost, privacy, and a phased rollout so we can ship value early.

---

## 0. Golden rule — the API key never goes in the browser

The POS is a **static site** (`index.html` + ES modules) hosted on Firebase Hosting.
Anything in those files is fully visible to anyone who opens DevTools. The Firebase
config keys in `config.js` are *meant* to be public (they're protected by Firestore
rules + the `sales@akm-music.com` auth restriction). **An Anthropic/Claude API key is
different — it is a billing secret.** If we put it in client code, it can be scraped and
abused, and the bill is ours.

**Therefore every AI call goes through a server-side proxy** that holds the key as a
secret and only answers authenticated `sales@akm-music.com` requests.

```
Browser (POS)  ──HTTPS+Firebase ID token──▶  Cloud Function  ──secret key──▶  Claude API
   no key                                     verifies the user                 (Anthropic)
                                              holds ANTHROPIC_API_KEY
```

`firebase.json` already reserves `functions/**` and `proxy-server.js` (both ignored by
Hosting), so the structure is anticipated — they just need to be created.

---

## 1. Backend: the AI proxy (shared by all three features)

**Recommended: Firebase Cloud Functions (2nd gen, Node 20).** Same project, same
billing, native Firebase Auth verification, no extra server to babysit.

```
functions/
  index.js          # exports: aiSuggest, aiReport (+ optional aiInventory)
  package.json      # @anthropic-ai/sdk, firebase-admin, firebase-functions
  .env / secret     # ANTHROPIC_API_KEY  (set via: firebase functions:secrets:set ANTHROPIC_API_KEY)
```

Each function must:

1. **Verify the caller.** Read the `Authorization: Bearer <idToken>` header,
   `admin.auth().verifyIdToken(token)`, and reject anything whose `email !==
   'sales@akm-music.com'`. This mirrors the Firestore rule `isAuthorized()`.
2. **Call Claude** with the right model for the job (see below).
3. **Return only the model's text** (never echo the key or raw error stacks).
4. **Rate-limit** (e.g. max N calls/min per user) to cap runaway cost.

### Model choice (cost vs quality)

| Task | Model | Why |
|------|-------|-----|
| Spelling / autocomplete (Phase 1) | `claude-haiku-4-5` | Cheap, fast, fired on every keystroke-pause. |
| Monthly narrative report (Phase 3) | `claude-opus-4-8` | Runs ~once/month; quality matters most. |
| Inventory normalisation (Phase 2) | `claude-haiku-4-5` | High volume, simple matching. |

> `proxy-server.js` (a tiny Express server) is the fallback if we ever run the POS on a
> local PC instead of Functions — same auth + key logic, just a different host. Cloud
> Functions is the default.

---

## 2. Feature 1 — Spelling correction & smart suggestions

**Goal:** as the cashier types a product **Description** (or repair fault, customer
name), offer a cleaned-up spelling and relevant suggestions — e.g. `yamaha clarionet`
→ suggests `Yamaha Clarinet`.

**UX**
- Debounced (~600 ms after typing stops) call to `aiSuggest`.
- Show a subtle inline chip / ghost-text suggestion the user can accept with **Tab**.
- Never auto-replace; always opt-in (a POS must not silently change what was typed).
- Fully degrades: if offline or the call fails, typing is unaffected.

**Smarter than a dictionary:** seed suggestions from the shop's *own* history. Pull the
distinct list of past descriptions/models from Firestore and pass them as context so
Claude prefers terms AKM actually sells (brands, instrument models) over generic English.

**Files touched (later):** `app-firestore.js` (input listeners + accept handler),
`ai-client.js` (new — wraps the fetch-with-ID-token), small CSS for the suggestion chip.

---

## 3. Feature 2 — Inventory recording

**Goal:** every invoice line item already names a product + qty. Capture that into a
**stock ledger** so AKM can see what sold, what's moving, and (optionally) what's left.

**Where AI helps:** the same product is typed many ways (`Yamaha F310`, `yamaha f-310`,
`F310 guitar`). AI **normalises** each line to a canonical product so the ledger doesn't
fragment into dozens of near-duplicates.

**Data model (new Firestore collections)**

```
products/{productId}
  canonicalName : "Yamaha F310 Acoustic Guitar"
  aliases       : ["yamaha f310", "f-310", ...]
  category      : "Guitars"
  unitPrice     : 0            // last/typical price (optional)
  stockOnHand   : <int|null>   // null = not stock-tracked
  createdAt, updatedAt

inventoryLedger/{entryId}
  productId, productName
  change        : -1           // sold 1 (negative); +N for received stock
  source        : "invoice"    // | "manual" | "repair"
  refNumber     : "INV-..."    // invoice/job it came from
  dateObj       : timestamp
```

**Flow:** on invoice save, a Cloud Function trigger (`onCreate` for `invoices/`) or the
client posts each line to `aiInventory`, which matches it to an existing `products` doc
(or creates one) and writes an `inventoryLedger` entry. Stock-on-hand is decremented for
tracked items. Receiving new stock is a manual "Stock In" form (Phase 2b).

> Keep it **opt-in per product** at first — not every line (e.g. a one-off repair part)
> needs stock tracking. Start as a *sales ledger* (what sold), graduate to *stock levels*
> once the canonical product list is clean.

**New UI (later):** an "Inventory" button/modal mirroring the History modal — searchable
product list, stock-in form, and "low stock" flags on the dashboard.

---

## 4. Feature 3 — Detailed monthly AI report

**Goal:** one click on the dashboard → a written, manager-ready summary of the month.

**Inputs** (already in Firestore): invoices, deposits, expenses, repairs for the month.
The dashboard already aggregates most of these.

**What the report covers**
- Total sales, by payment method (Cash/Card/Tabby/Cheque) and trend vs last month.
- Cash flow: sales − expenses − deposits = net cash movement; flag anomalies.
- VAT collected (5%) for the period — ties into the existing quarterly tax logic.
- Top products / categories (uses the Phase 2 inventory ledger once available).
- Repairs: opened / completed / collected / outstanding charges.
- A short plain-English narrative + 3–5 actionable observations.

**How:** dashboard gathers the month's aggregates into a compact JSON, posts it to
`aiReport`; Claude (`claude-opus-4-8`) returns Markdown. Render it in a modal with
**Print** and **Save to Drive / PDF** actions (the dashboard already has export plumbing).

**Cost:** ~once per month → negligible. Cache the generated report in
`reports/{yyyy-mm}` so re-opening doesn't re-bill.

---

## 5. Privacy & data handling

- AI calls send **business data** (item descriptions, amounts, sometimes customer
  name/phone) to Anthropic. Send the **minimum** needed: for spelling, just the field
  text; for reports, prefer **aggregates** over raw customer rows.
- Document this in the internal data-handling note; it stays within the
  `sales@akm-music.com`-only system and Anthropic's API (no training on API data).
- Keep the existing access restriction intact — the proxy enforces the same single-user
  rule as Firestore.

---

## 6. Phased rollout (ship value early)

| Phase | Scope | Effort |
|-------|-------|--------|
| **0** | Stand up `functions/` proxy with auth + `ANTHROPIC_API_KEY` secret; `aiSuggest` "hello world". | S |
| **1** | Spelling/suggestions on Description + repair fault (history-seeded). | M |
| **2a** | Sales ledger: normalise invoice lines → `products` + `inventoryLedger` (read-only reporting). | M |
| **2b** | Stock-on-hand + "Stock In" form + low-stock flags. | M |
| **3** | Monthly AI report on dashboard, cached in `reports/`. | M |

Each phase is independently shippable and independently reversible.

---

## 7. Open decisions for the user

1. **Hosting for the proxy** — Firebase Cloud Functions (recommended) vs the local
   `proxy-server.js` running on the shop PC?
2. **Inventory depth** — sales ledger only (what sold) first, or go straight to full
   stock-on-hand tracking?
3. **Report cadence** — monthly only, or also a weekly snapshot?
4. **Privacy** — OK to send customer name/phone to the AI, or strip to aggregates only?

> Nothing in this plan changes the live POS until built. The current deploy only adds the
> PWA/offline + responsive work and the deposit-rule fix.



always do npm run build and firebase deploy).