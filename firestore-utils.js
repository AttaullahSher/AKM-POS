// Firestore Utility Functions — AKM-POS v3.0
// Fixed: deposit/expense/repair ID parsing, refund by docId, formatDate 'DD-MMM-YYYY'

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp
} from './firebase-config.js';

import { dbFiles } from './firebase-secondary.js';
import { APP_CONFIG, debugLog } from './config.js';

export { db };

// ─── Numbering Date Gate ──────────────────────────────────────
// Before 2026-07-01 → old format (YY-XXXXX / D-MMXX / E-MMXX / CI-MMXX)
// From  2026-07-01 → new format (IN-26-XXXX / DP-26-XXX / EX-26-XXX / CI-26-XXX)
const NEW_NUMBERING_START = new Date('2026-07-01');
const useNewNumbering     = new Date() >= NEW_NUMBERING_START;

// ─── Session Cache ────────────────────────────────────────────
// Prevents repeated Firestore reads within the same browser session.
// Today-caches expire automatically at midnight (UAE date key changes).
// All caches are busted after any write via invalidateCache().
const _todayCache  = Object.create(null); // { [YYYY-MM-DD]: { invoices, deposits, expenses, cashIns } }
let   _cfCache     = { ts: 0, data: null };           // getAllTimeCashFlow — 5-min TTL
let   _actCache    = { ts: 0, days: 0, data: null };  // getRecentActivity  — 5-min TTL
let   _invNumCache = { year: 0, value: null };         // peekNextInvoiceNumber
const _CACHE_TTL   = 5 * 60 * 1000;                   // 5 minutes

export function invalidateCache() {
  for (const k of Object.keys(_todayCache)) delete _todayCache[k];
  _cfCache.ts        = 0;
  _actCache.ts       = 0;
  _invNumCache.value = null;
}

// ─── Date Helpers ────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  const year    = d.getFullYear();
  const month   = String(d.getMonth() + 1).padStart(2, '0');
  const day     = String(d.getDate()).padStart(2, '0');
  const hours   = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const mon3    = MONTH_NAMES[d.getMonth()];

  switch (format) {
    case 'YYYY-MM-DD':       return `${year}-${month}-${day}`;
    case 'DD/MM/YYYY':       return `${day}/${month}/${year}`;
    case 'HH:mm:ss':         return `${hours}:${minutes}:${seconds}`;
    case 'DD MMM YYYY':      return `${day} ${mon3} ${year}`;
    case 'DD-MMM-YYYY':      return `${day}-${mon3}-${year}`;
    case 'DD MMM YYYY HH:mm:ss': return `${day} ${mon3} ${year} ${hours}:${minutes}:${seconds}`;
    case 'YYYY-MM-DD_HH-mm':   return `${year}-${month}-${day}_${hours}-${minutes}`;
    default:                 return d.toISOString();
  }
}

export function formatTime(date) {
  return formatDate(date, 'HH:mm:ss');
}

export function toTimestamp(date) {
  if (!date) return Timestamp.now();
  return Timestamp.fromDate(date instanceof Date ? date : new Date(date));
}

// ─── Atomic Counters ─────────────────────────────────────────

// localStorage counter cache — always readable offline, updated on every
// successful peek or commit so the offline fallback has an accurate base.
const LS_KEY = 'akm_inv_counter';
function readLocalCounter(year) {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return (v.year === year) ? (v.lastSequence || 0) : 0;
  } catch { return 0; }
}
function writeLocalCounter(year, lastSequence) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ year, lastSequence })); } catch {}
}

export async function getNextInvoiceNumber() {
  const currentYear = new Date().getFullYear();

  if (!useNewNumbering) {
    // ── OLD FORMAT: YY-XXXXX ────────────────────────────────────────
    const counterRef = doc(db, 'counters', 'invoices');
    const yy         = String(currentYear).slice(-2);
    const INIT       = APP_CONFIG.BUSINESS.STARTING_INVOICE_NUMBER;

    const offlineFallback = () => {
      const last = readLocalCounter(currentYear);
      const next = Math.max(last + 1, INIT);
      writeLocalCounter(currentYear, next);
      return `${yy}-${String(next).padStart(5, '0')}`;
    };

    try {
      const result = await Promise.race([
        runTransaction(db, async (tx) => {
          const snap = await tx.get(counterRef);
          if (!snap.exists()) {
            tx.set(counterRef, { year: currentYear, lastSequence: INIT, updatedAt: serverTimestamp() });
            return { number: `${yy}-${String(INIT).padStart(5, '0')}`, sequence: INIT };
          }
          const data = snap.data();
          if (data.year !== currentYear) {
            tx.update(counterRef, { year: currentYear, lastSequence: INIT, updatedAt: serverTimestamp() });
            return { number: `${yy}-${String(INIT).padStart(5, '0')}`, sequence: INIT };
          }
          const next = data.lastSequence + 1;
          tx.update(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
          return { number: `${yy}-${String(next).padStart(5, '0')}`, sequence: next };
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 3000)),
      ]);
      writeLocalCounter(currentYear, result.sequence);
      return result.number;
    } catch {
      return offlineFallback();
    }
  }

  // ── NEW FORMAT: IN-26-XXXX ──────────────────────────────────────
  const year       = APP_CONFIG.BUSINESS.DOC_YEAR;
  const counterRef = doc(db, 'counters', `IN-${year}`);

  const offlineFallback = () => {
    const last = readLocalCounter(currentYear);
    const next = Math.max(last + 1, 1);
    writeLocalCounter(currentYear, next);
    return `IN-${year}-${String(next).padStart(4, '0')}`;
  };

  try {
    const result = await Promise.race([
      runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        if (!snap.exists()) {
          // First use: scan for any IN-26-XXXX already saved so we don't restart at 0001
          const existing = await getDocs(query(
            collection(db, 'invoices'),
            where('invoiceNumber', '>=', `IN-${year}-`),
            where('invoiceNumber', '<=', `IN-${year}-~`)
          ));
          let maxSeq = 0;
          existing.forEach(d => {
            const n = parseInt((d.data().invoiceNumber || '').split('-').pop(), 10);
            if (!isNaN(n)) maxSeq = Math.max(maxSeq, n);
          });
          const next = maxSeq + 1;
          tx.set(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
          return { number: `IN-${year}-${String(next).padStart(4, '0')}`, sequence: next };
        }
        const next = snap.data().lastSequence + 1;
        tx.update(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
        return { number: `IN-${year}-${String(next).padStart(4, '0')}`, sequence: next };
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 3000)),
    ]);
    writeLocalCounter(currentYear, result.sequence);
    return result.number;
  } catch {
    return offlineFallback();
  }
}

/**
 * Peek the NEXT invoice number WITHOUT consuming it (read-only).
 * Shown as a preview on load so refreshing the page never burns numbers.
 * The number is only committed via getNextInvoiceNumber() when an invoice saves.
 */
export async function peekNextInvoiceNumber() {
  const currentYear = new Date().getFullYear();
  if (_invNumCache.year === currentYear && _invNumCache.value !== null) {
    return _invNumCache.value;
  }

  if (!useNewNumbering) {
    // ── OLD FORMAT ──────────────────────────────────────────────────
    const counterRef = doc(db, 'counters', 'invoices');
    const yy         = String(currentYear).slice(-2);
    const INIT       = APP_CONFIG.BUSINESS.STARTING_INVOICE_NUMBER;
    try {
      const snap = await getDoc(counterRef);
      if (!snap.exists())            { const v = `${yy}-${String(INIT).padStart(5, '0')}`; _invNumCache = { year: currentYear, value: v }; return v; }
      const data = snap.data();
      if (data.year !== currentYear) { const v = `${yy}-${String(INIT).padStart(5, '0')}`; _invNumCache = { year: currentYear, value: v }; return v; }
      const next = (data.lastSequence || INIT) + 1;
      writeLocalCounter(currentYear, data.lastSequence);
      const value = `${yy}-${String(next).padStart(5, '0')}`;
      _invNumCache = { year: currentYear, value };
      return value;
    } catch (err) {
      console.error('❌ peekNextInvoiceNumber error:', err);
      const last = readLocalCounter(currentYear);
      return `${yy}-${String(Math.max(last + 1, INIT)).padStart(5, '0')}`;
    }
  }

  // ── NEW FORMAT: IN-26-XXXX ──────────────────────────────────────
  const year       = APP_CONFIG.BUSINESS.DOC_YEAR;
  const counterRef = doc(db, 'counters', `IN-${year}`);
  try {
    const snap = await getDoc(counterRef);
    const next = snap.exists() ? snap.data().lastSequence + 1 : 1;
    if (snap.exists()) writeLocalCounter(currentYear, snap.data().lastSequence);
    const value = `IN-${year}-${String(next).padStart(4, '0')}`;
    _invNumCache = { year: currentYear, value };
    return value;
  } catch (err) {
    console.error('❌ peekNextInvoiceNumber error:', err);
    const last = readLocalCounter(currentYear);
    return `IN-${year}-${String(Math.max(last + 1, 1)).padStart(4, '0')}`;
  }
}

// Generic monthly counter helper: prefix D→deposits, E→expenses, R→repairs
async function getNextMonthlyId(collectionName, prefix) {
  const counterRef = doc(db, 'counters', collectionName);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');

  const offlineFallback = async () => {
    const snap = await getDoc(counterRef);
    const next = (!snap.exists() || snap.data().month !== month)
      ? 1
      : (snap.data().lastSequence || 0) + 1;
    await setDoc(counterRef, { month, lastSequence: next, updatedAt: serverTimestamp() }, { merge: true });
    return `${prefix}-${month}${String(next).padStart(2, '0')}`;
  };

  try {
    return await Promise.race([
      runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        if (!snap.exists()) {
          tx.set(counterRef, { month, lastSequence: 1, updatedAt: serverTimestamp() });
          return `${prefix}-${month}01`;
        }
        const data = snap.data();
        if (data.month !== month) {
          tx.update(counterRef, { month, lastSequence: 1, updatedAt: serverTimestamp() });
          return `${prefix}-${month}01`;
        }
        const next = data.lastSequence + 1;
        tx.update(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
        return `${prefix}-${month}${String(next).padStart(2, '0')}`;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 3000)),
    ]);
  } catch {
    try   { return await offlineFallback(); }
    catch { return `${prefix}-${month}${Date.now().toString().slice(-2)}`; }
  }
}

// ─── Year-Keyed Counter (new format from 2026-07-01) ─────────
// Counter doc: counters/{PREFIX}-{DOC_YEAR}  e.g. counters/DP-26
// On first use: scans collection for any existing new-format IDs so the
// counter never restarts below an already-issued number.
async function getNextYearlyId(prefix, pad, collectionName, fieldName) {
  const year       = APP_CONFIG.BUSINESS.DOC_YEAR;
  const counterRef = doc(db, 'counters', `${prefix}-${year}`);

  const scanMaxExisting = async () => {
    try {
      const snap = await getDocs(query(
        collection(db, collectionName),
        where(fieldName, '>=', `${prefix}-${year}-`),
        where(fieldName, '<=', `${prefix}-${year}-~`)
      ));
      let max = 0;
      snap.forEach(d => {
        const n = parseInt((d.data()[fieldName] || '').split('-').pop(), 10);
        if (!isNaN(n)) max = Math.max(max, n);
      });
      return max;
    } catch { return 0; }
  };

  try {
    return await Promise.race([
      runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        if (!snap.exists()) {
          const maxExisting = await scanMaxExisting();
          const next = maxExisting + 1;
          tx.set(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
          return `${prefix}-${year}-${String(next).padStart(pad, '0')}`;
        }
        const next = snap.data().lastSequence + 1;
        tx.update(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
        return `${prefix}-${year}-${String(next).padStart(pad, '0')}`;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 3000)),
    ]);
  } catch {
    return `${prefix}-${year}-${Date.now().toString().slice(-4)}`;
  }
}

export const getNextDepositId = () => useNewNumbering
  ? getNextYearlyId('DP', 3, 'deposits', 'depositId')
  : getNextMonthlyId('deposits', 'D');

export const getNextExpenseId = () => useNewNumbering
  ? getNextYearlyId('EX', 3, 'expenses', 'expenseId')
  : getNextMonthlyId('expenses', 'E');

// RP-26-XXX — ready for future repairs page
export const getNextRepairJobNumber = () => useNewNumbering
  ? getNextYearlyId('RP', 3, 'repairs', 'repairNumber')
  : getNextMonthlyId('repairs', 'R');

// Aliases for callers that use uppercase
export const getNextDepositID = getNextDepositId;
export const getNextExpenseID = getNextExpenseId;

// ─── Invoices ────────────────────────────────────────────────

export async function createInvoice(invoiceData) {
  const {
    invoiceNumber: passedNumber,
    date, customer, payment, items, status = 'Paid',
    isAmendment = false, originalInvoiceId = null, originalInvoiceNumber = null,
  } = invoiceData;

  // Pre-generate a stable document ID so we know it before the write completes
  const invoiceRef  = doc(collection(db, 'invoices'));
  // processDate = UAE calendar date when the invoice was SAVED (always today, never backdated).
  // date = what the user typed (may be a past date for backdated invoices).
  const processDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  const currentYear = new Date().getFullYear();
  const yy          = String(currentYear).slice(-2);
  const INIT        = APP_CONFIG.BUSINESS.STARTING_INVOICE_NUMBER;
  const now         = new Date();

  const buildDoc = (invoiceNumber, sequence) => ({
    invoiceNumber,
    year: currentYear,
    sequence,
    date:        formatDate(new Date(date), 'YYYY-MM-DD'),
    processDate,
    dateObj:     toTimestamp(new Date(date)),
    time:        formatTime(now),
    createdAt:   serverTimestamp(),
    customer: {
      name:  customer.name  || 'Walk-in Customer',
      phone: customer.phone || '',
      email: customer.email || '',
      trn:   customer.trn   || '',
    },
    payment,
    items,
    status,
    impacts: {
      cash:   payment.method === 'Cash'   ? payment.grandTotal : 0,
      card:   payment.method === 'Card'   ? payment.grandTotal : 0,
      tabby:  payment.method === 'Tabby'  ? payment.grandTotal : 0,
      cheque: payment.method === 'Cheque' ? payment.grandTotal : 0,
    },
    refundedAt: null,
    notes: '',
    isAmendment,
    ...(isAmendment && { originalInvoiceId, originalInvoiceNumber }),
  });

  // Amendments already have a letter-suffix number assigned by the caller — just write the doc.
  if (isAmendment && passedNumber) {
    const seq = parseInt((passedNumber.split('-')[1]) || '0', 10);
    await setDoc(invoiceRef, buildDoc(passedNumber, seq));
    debugLog('✅ Amendment saved:', passedNumber, invoiceRef.id);
    return { id: invoiceRef.id, invoiceNumber: passedNumber };
  }

  // ── NEW FORMAT: IN-26-XXXX (from 2026-07-01) ──────────────────────────────
  if (useNewNumbering) {
    const year       = APP_CONFIG.BUSINESS.DOC_YEAR;
    const counterRef = doc(db, 'counters', `IN-${year}`);
    try {
      const result = await Promise.race([
        runTransaction(db, async (tx) => {
          const snap = await tx.get(counterRef);
          if (!snap.exists()) {
            // First use after reset: scan for any IN-26-XXXX already saved
            const existing = await getDocs(query(
              collection(db, 'invoices'),
              where('invoiceNumber', '>=', `IN-${year}-`),
              where('invoiceNumber', '<=', `IN-${year}-~`)
            ));
            let maxSeq = 0;
            existing.forEach(d => {
              const n = parseInt((d.data().invoiceNumber || '').split('-').pop(), 10);
              if (!isNaN(n)) maxSeq = Math.max(maxSeq, n);
            });
            const next = maxSeq + 1;
            const invoiceNumber = `IN-${year}-${String(next).padStart(4, '0')}`;
            tx.set(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
            tx.set(invoiceRef, buildDoc(invoiceNumber, next));
            return { invoiceNumber, sequence: next };
          }
          const next = snap.data().lastSequence + 1;
          const invoiceNumber = `IN-${year}-${String(next).padStart(4, '0')}`;
          tx.update(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
          tx.set(invoiceRef, buildDoc(invoiceNumber, next));
          return { invoiceNumber, sequence: next };
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      writeLocalCounter(currentYear, result.sequence);
      debugLog('✅ Invoice saved (new format):', result.invoiceNumber, invoiceRef.id);
      return { id: invoiceRef.id, invoiceNumber: result.invoiceNumber };
    } catch {
      const last = readLocalCounter(currentYear);
      const next = Math.max(last + 1, 1);
      writeLocalCounter(currentYear, next);
      const invoiceNumber = `IN-${year}-${String(next).padStart(4, '0')}`;
      await setDoc(invoiceRef, buildDoc(invoiceNumber, next));
      debugLog('📱 Invoice queued offline (new format):', invoiceNumber, invoiceRef.id);
      return { id: invoiceRef.id, invoiceNumber };
    }
  }

  // ── OLD FORMAT: YY-XXXXX (before 2026-07-01) ───────────────────────────────
  const counterRef = doc(db, 'counters', 'invoices');
  try {
    const result = await Promise.race([
      runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const data = snap.exists() ? snap.data() : {};
        const next = (data.year === currentYear && data.lastSequence >= INIT)
          ? data.lastSequence + 1 : INIT;
        const invoiceNumber = `${yy}-${String(next).padStart(5, '0')}`;

        tx.set(counterRef, { year: currentYear, lastSequence: next, updatedAt: serverTimestamp() }, { merge: true });
        tx.set(invoiceRef, buildDoc(invoiceNumber, next));

        return { invoiceNumber, sequence: next };
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    writeLocalCounter(currentYear, result.sequence);
    debugLog('✅ Invoice saved (online, atomic):', result.invoiceNumber, invoiceRef.id);
    return { id: invoiceRef.id, invoiceNumber: result.invoiceNumber };

  } catch {
    const last = readLocalCounter(currentYear);
    const next = Math.max(last + 1, INIT);
    writeLocalCounter(currentYear, next);
    const invoiceNumber = `${yy}-${String(next).padStart(5, '0')}`;

    await setDoc(invoiceRef, buildDoc(invoiceNumber, next));
    debugLog('📱 Invoice queued offline:', invoiceNumber, invoiceRef.id);
    return { id: invoiceRef.id, invoiceNumber };
  }
}

export async function upsertCustomer(name, mobile, email, trn) {
  if (!mobile || name === 'Walk-in Customer') return;
  try {
    const snap = await getDocs(
      query(collection(db, 'customers'), where('mobile', '==', mobile), limit(1))
    );
    const now = serverTimestamp();
    if (snap.empty) {
      await addDoc(collection(db, 'customers'), {
        name, mobile, email: email || '', trn: trn || '', lastSeen: now,
      });
    } else {
      const updates = { name, trn: trn || '', lastSeen: now };
      if (email) updates.email = email;
      await updateDoc(snap.docs[0].ref, updates);
    }
  } catch (err) {
    debugLog('upsertCustomer error:', err);
  }
  syncCustomerToFiles(name, mobile, email, trn).catch(() => {});
}

async function syncCustomerToFiles(name, mobile, email, trn) {
  try {
    const docRef = doc(dbFiles, 'customers', mobile);
    const data = {
      name, mobile,
      trn:       trn || '',
      lastSeen:  serverTimestamp(),
      source:    'POS',
      sourceApp: 'akm-daily',
    };
    if (email) data.email = email;
    await setDoc(docRef, data, { merge: true });
    debugLog('✅ syncCustomerToFiles:', mobile);
  } catch (err) {
    debugLog('syncCustomerToFiles error (ignored):', err);
  }
}

export async function loadRecentInvoices(days = 90) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const q = query(
      collection(db, 'invoices'),
      where('dateObj', '>=', toTimestamp(cutoff)),
      orderBy('dateObj', 'desc'),
      limit(200)
    );
    const snap = await getDocs(q);
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id:            d.id,
        invoiceNumber: data.invoiceNumber,
        date:          data.date,
        createdAt:     data.createdAt || null,
        customer:      data.customer?.name || 'Walk-in',
        payment:       data.payment?.method || 'Cash',
        grandTotal:    data.payment?.grandTotal || 0,
        status:        data.status || 'Paid',
      };
    });
    rows.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? -1;
      const bMs = b.createdAt?.toMillis?.() ?? -1;
      if (aMs !== -1 || bMs !== -1) return bMs - aMs;
      return (b.date || '').localeCompare(a.date || '');
    });
    return rows;
  } catch (err) {
    if (err.code === 'failed-precondition') { console.warn('⏳ Index building…'); return []; }
    console.error('❌ loadRecentInvoices:', err);
    return [];
  }
}

// Fix: refund by Firestore document ID (not invoice number)
export async function refundInvoice(docId) {
  const docRef = doc(db, 'invoices', docId);
  await updateDoc(docRef, {
    status: 'Refunded',
    refundedAt: serverTimestamp(),
    'impacts.cash':   0,
    'impacts.card':   0,
    'impacts.tabby':  0,
    'impacts.cheque': 0,
  });
  debugLog('✅ Invoice refunded:', docId);
}

export async function markInvoiceSuperseded(invoiceId, amendmentNumber) {
  const docRef = doc(db, 'invoices', invoiceId);
  await updateDoc(docRef, { superseded: true, supersededBy: amendmentNumber, supersededAt: serverTimestamp() });
  debugLog('✅ Invoice superseded:', invoiceId, '→', amendmentNumber);
}

export async function getInvoiceById(docId) {
  const snap = await getDoc(doc(db, 'invoices', docId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getInvoiceByNumber(invoiceNumber) {
  try {
    const q    = query(collection(db, 'invoices'), where('invoiceNumber', '==', invoiceNumber), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (err) {
    console.error('❌ getInvoiceByNumber:', err);
    return null;
  }
}

export async function loadRecentDeposits(days = 90) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const q = query(
      collection(db, 'deposits'),
      where('dateObj', '>=', toTimestamp(cutoff)),
      orderBy('dateObj', 'desc'),
      limit(500)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (err.code === 'failed-precondition') { console.warn('⏳ Index building…'); return []; }
    console.error('❌ loadRecentDeposits:', err);
    return [];
  }
}

export async function loadRecentExpenses(days = 90) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const q = query(
      collection(db, 'expenses'),
      where('dateObj', '>=', toTimestamp(cutoff)),
      orderBy('dateObj', 'desc'),
      limit(500)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (err.code === 'failed-precondition') { console.warn('⏳ Index building…'); return []; }
    console.error('❌ loadRecentExpenses:', err);
    return [];
  }
}

// ─── Today Queries ───────────────────────────────────────────

export async function getTodayInvoices() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  if (_todayCache[today]?.invoices) return _todayCache[today].invoices;
  try {
    // UAE midnight = 00:00 +04:00, which is 20:00 UTC the previous calendar day
    const dayStart = Timestamp.fromDate(new Date(`${today}T00:00:00+04:00`));
    const dayEnd   = Timestamp.fromDate(new Date(`${today}T23:59:59+04:00`));
    // Triple query so every invoice physically created today is counted:
    //  1. processDate — new invoices (even if date was backdated)
    //  2. date        — legacy invoices without processDate where date == today
    //  3. createdAt   — catch-all: any invoice saved today in UAE time (handles
    //                   pre-processDate invoices with a backdated date field)
    const [byProcess, byDate, byCreatedAt] = await Promise.all([
      getDocs(query(collection(db, 'invoices'), where('processDate', '==', today))),
      getDocs(query(collection(db, 'invoices'), where('date',        '==', today))),
      getDocs(query(collection(db, 'invoices'), where('createdAt', '>=', dayStart), where('createdAt', '<=', dayEnd))),
    ]);
    const seen = new Set();
    const docs = [];
    for (const snap of [byProcess, byDate, byCreatedAt]) {
      for (const d of snap.docs) {
        if (!seen.has(d.id)) { seen.add(d.id); docs.push({ id: d.id, ...d.data() }); }
      }
    }
    if (!_todayCache[today]) _todayCache[today] = {};
    _todayCache[today].invoices = docs;
    return docs;
  } catch (err) {
    console.error('❌ getTodayInvoices:', err);
    return [];
  }
}

export async function getTodayDeposits() {
  const today = formatDate(new Date(), 'YYYY-MM-DD');
  if (_todayCache[today]?.deposits) return _todayCache[today].deposits;
  try {
    const q = query(collection(db, 'deposits'), where('date', '==', today));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_todayCache[today]) _todayCache[today] = {};
    _todayCache[today].deposits = docs;
    return docs;
  } catch (err) {
    console.error('❌ getTodayDeposits:', err);
    return [];
  }
}

export async function getTodayExpenses() {
  const today = formatDate(new Date(), 'YYYY-MM-DD');
  if (_todayCache[today]?.expenses) return _todayCache[today].expenses;
  try {
    const q = query(collection(db, 'expenses'), where('date', '==', today));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_todayCache[today]) _todayCache[today] = {};
    _todayCache[today].expenses = docs;
    return docs;
  } catch (err) {
    console.error('❌ getTodayExpenses:', err);
    return [];
  }
}

export async function getTodayCashIns() {
  const today = formatDate(new Date(), 'YYYY-MM-DD');
  if (_todayCache[today]?.cashIns) return _todayCache[today].cashIns;
  try {
    const q = query(collection(db, 'cash_ins'), where('date', '==', today));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_todayCache[today]) _todayCache[today] = {};
    _todayCache[today].cashIns = docs;
    return docs;
  } catch (err) {
    console.error('❌ getTodayCashIns:', err);
    return [];
  }
}

export async function createCashIn({ amount, reference = '' }) {
  const today    = new Date();
  const cashInId = await getNextCashInId();
  const docRef   = await addDoc(collection(db, 'cash_ins'), {
    cashInId,
    amount,
    reference,
    date:      formatDate(today, 'YYYY-MM-DD'),
    dateObj:   toTimestamp(today),
    time:      formatTime(today),
    createdAt: serverTimestamp(),
    deleted:   false,
  });
  return docRef.id;
}

export const getNextCashInId = () => useNewNumbering
  ? getNextYearlyId('CI', 3, 'cash_ins', 'cashInId')
  : getNextMonthlyId('cash_ins_counter', 'CI');

// ─── Deposits ────────────────────────────────────────────────

export async function createDeposit(depositData) {
  const { depositId, amount, bank, slipNumber = '', depositor = '', depositType = 'Cash' } = depositData;
  // depositId format: D-MM## e.g. D-0601
  // Extract month from parts[1] first two chars
  const parts    = depositId.split('-');           // ['D', '0601']
  const monthStr = parts[1] ? parts[1].substring(0, 2) : '00';
  const seqNum   = parts[1] ? parseInt(parts[1].substring(2), 10) : 0;
  const today    = new Date();

  const deposit = {
    depositId,
    month: monthStr,
    yearMonth: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`, // required by Firestore rules + queryable
    sequence: seqNum,
    date: formatDate(today, 'YYYY-MM-DD'),
    dateObj: toTimestamp(today),
    time: formatTime(today),
    createdAt: serverTimestamp(),
    amount,
    bank,
    slipNumber,
    depositor,
    depositType,
    cashImpact: depositType === 'Cash' ? -amount : 0,
    notes: '',
  };

  const docRef = await addDoc(collection(db, 'deposits'), deposit);
  debugLog('✅ Deposit saved:', depositId);
  return docRef.id;
}

// ─── Expenses ────────────────────────────────────────────────

export async function createExpense(expenseData) {
  const { expenseId, category = '', description, amount } = expenseData;
  // expenseId format: E-MM## e.g. E-0601
  const parts    = expenseId.split('-');
  const monthStr = parts[1] ? parts[1].substring(0, 2) : '00';
  const seqNum   = parts[1] ? parseInt(parts[1].substring(2), 10) : 0;
  const today    = new Date();

  const expense = {
    expenseId,
    month: monthStr,
    sequence: seqNum,
    date: formatDate(today, 'YYYY-MM-DD'),
    dateObj: toTimestamp(today),
    time: formatTime(today),
    createdAt: serverTimestamp(),
    category,
    description,
    amount,
    cashImpact: -amount,
    notes: '',
  };

  const docRef = await addDoc(collection(db, 'expenses'), expense);
  debugLog('✅ Expense saved:', expenseId);
  return docRef.id;
}

// ─── Repairs ────────────────────────────────────────────────

export async function createRepairJob(repairData) {
  const { jobNumber, customer, product, service, charges } = repairData;
  // jobNumber format: R-MM## e.g. R-0601
  const parts    = jobNumber.split('-');
  const monthStr = parts[1] ? parts[1].substring(0, 2) : '00';
  const seqNum   = parts[1] ? parseInt(parts[1].substring(2), 10) : 0;
  const today    = new Date();

  const repair = {
    jobNumber,
    month: monthStr,
    sequence: seqNum,
    date: formatDate(today, 'YYYY-MM-DD'),
    dateObj: toTimestamp(today),
    createdAt: serverTimestamp(),
    customer: {
      name:  customer.name  || '',
      phone: customer.phone || '',
    },
    product,
    service:  service  || '',
    charges:  charges  || 0,
    status:   'InProcess',
    completedAt:  null,
    collectedAt:  null,
    notes: '',
  };

  const docRef = await addDoc(collection(db, 'repairs'), repair);
  debugLog('✅ Repair job saved:', jobNumber);
  return docRef.id;   // return plain string ID
}

export async function loadRepairJobs(days = 365) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const q = query(
      collection(db, 'repairs'),
      where('dateObj', '>=', toTimestamp(cutoff)),
      orderBy('dateObj', 'desc'),
      limit(200)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (err.code === 'failed-precondition') { console.warn('⏳ Index building…'); return []; }
    console.error('❌ loadRepairJobs:', err);
    return [];
  }
}

export async function updateRepairStatus(docId, newStatus) {
  const docRef   = doc(db, 'repairs', docId);
  const update   = { status: newStatus };
  if (newStatus === 'Completed') update.completedAt = serverTimestamp();
  if (newStatus === 'Collected') update.collectedAt = serverTimestamp();
  await updateDoc(docRef, update);
  debugLog('✅ Repair status updated:', docId, '->', newStatus);
}

// ─── Offline Backup (localStorage fallback) ──────────────────

export function saveOfflineBackup(type, data) {
  try {
    const backups = JSON.parse(localStorage.getItem('firestoreOfflineBackup') || '{}');
    if (!backups[type]) backups[type] = [];
    backups[type].push({ ...data, offlineTimestamp: Date.now() });
    localStorage.setItem('firestoreOfflineBackup', JSON.stringify(backups));
  } catch (err) { console.error('❌ Offline backup error:', err); }
}

export function getOfflineBackups() {
  try { return JSON.parse(localStorage.getItem('firestoreOfflineBackup') || '{}'); }
  catch { return {}; }
}

export function clearOfflineBackups() {
  try { localStorage.removeItem('firestoreOfflineBackup'); }
  catch (err) { console.error('❌ Clear backup error:', err); }
}

// ─── Aliases ────────────────────────────────────────────────
export const saveInvoice           = createInvoice;
export const saveDeposit           = createDeposit;
export const saveExpense           = createExpense;
export const saveRepairJob         = createRepairJob;
export const getRecentInvoices     = loadRecentInvoices;
export const getRecentRepairJobs   = loadRepairJobs;
export const markInvoiceAsRefunded = refundInvoice;
export const updateRepairJobStatus = updateRepairStatus;
export const getRecentDeposits     = loadRecentDeposits;
export const getRecentExpenses     = loadRecentExpenses;

// ─── Soft Delete ────────────────────────────────────────────
// Marks a document as deleted without removing it. The ID / number is
// preserved forever for audit trail and is NEVER reused by counters.
export async function softDeleteDocument(collectionName, docId) {
  const docRef = doc(db, collectionName, docId);
  await updateDoc(docRef, {
    deleted:   true,
    deletedAt: serverTimestamp(),
  });
  debugLog('🗑️ Soft deleted:', collectionName, docId);
}

// ─── All-Time Cash Flow (5-year lookback) ───────────────────
// Returns { totalCash, totalDeposits, totalExpenses, cashInHand }
// Used for the running "Cash in Hand" stat that carries forward across days.
// Deleted documents are excluded from all totals.
export async function getAllTimeCashFlow() {
  if (_cfCache.data !== null && Date.now() - _cfCache.ts < _CACHE_TTL) {
    return _cfCache.data;
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 1825); // 5 years
  try {
    const [invSnap, depSnap, expSnap, cashInSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'invoices'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc')
      )),
      getDocs(query(
        collection(db, 'deposits'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc')
      )),
      getDocs(query(
        collection(db, 'expenses'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc')
      )),
      getDocs(query(
        collection(db, 'cash_ins'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc')
      )),
    ]);

    let totalCash = 0;
    invSnap.forEach(d => {
      const data = d.data();
      // Exclude deleted AND superseded — superseded invoices are replaced by their amendment
      if (data.status === 'Paid' && !data.deleted && !data.superseded) {
        totalCash += data.impacts?.cash || 0;
      }
    });
    let totalDeposits = 0;
    depSnap.forEach(d => {
      const data = d.data();
      if (!data.deleted && (data.depositType || 'Cash') === 'Cash') totalDeposits += data.amount || 0;
    });
    let totalExpenses = 0;
    expSnap.forEach(d => {
      if (!d.data().deleted) totalExpenses += d.data().amount || 0;
    });
    let totalCashIns = 0;
    cashInSnap.forEach(d => {
      if (!d.data().deleted) totalCashIns += d.data().amount || 0;
    });

    const result = {
      totalCash,
      totalCashIns,
      totalDeposits,
      totalExpenses,
      cashInHand: totalCash + totalCashIns - totalDeposits - totalExpenses,
    };
    _cfCache = { ts: Date.now(), data: result };
    return result;
  } catch (err) {
    console.error('❌ getAllTimeCashFlow:', err);
    return null;
  }
}

// ─── Unified Activity Feed ───────────────────────────────────
// Returns invoices + deposits + expenses merged and sorted by date/time desc.
export async function getRecentActivity(days = 90) {
  if (_actCache.data !== null && _actCache.days === days && Date.now() - _actCache.ts < _CACHE_TTL) {
    return _actCache.data;
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  try {
    const [invSnap, depSnap, expSnap, ciSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'invoices'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc'),
        limit(300)
      )),
      getDocs(query(
        collection(db, 'deposits'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc'),
        limit(300)
      )),
      getDocs(query(
        collection(db, 'expenses'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc'),
        limit(300)
      )),
      getDocs(query(
        collection(db, 'cash_ins'),
        where('dateObj', '>=', toTimestamp(cutoff)),
        orderBy('dateObj', 'desc'),
        limit(300)
      )),
    ]);

    const items = [];

    invSnap.forEach(d => {
      const data = d.data();
      items.push({
        id:          d.id,
        type:        'invoice',
        refId:       data.invoiceNumber || '',
        date:        data.date          || '',
        processDate: data.processDate   || '',
        time:        data.time          || '00:00:00',
        createdAt:   data.createdAt     || null,
        description: data.customer?.name || 'Walk-in',
        amount:      data.payment?.grandTotal || 0,
        status:      data.status  || 'Paid',
        payment:     data.payment?.method || 'Cash',
        deleted:     data.deleted    || false,
        superseded:  data.superseded || false,
      });
    });

    depSnap.forEach(d => {
      const data = d.data();
      items.push({
        id:          d.id,
        type:        'deposit',
        refId:       data.depositId || '',
        date:        data.date      || '',
        time:        data.time      || '00:00:00',
        createdAt:   data.createdAt || null,
        description: `${data.depositor || ''}${data.bank ? ` → ${data.bank}` : ''}`,
        amount:      data.amount    || 0,
        status:      'Deposited',
        deleted:     data.deleted || false,
      });
    });

    expSnap.forEach(d => {
      const data = d.data();
      items.push({
        id:          d.id,
        type:        'expense',
        refId:       data.expenseId  || '',
        date:        data.date       || '',
        time:        data.time       || '00:00:00',
        createdAt:   data.createdAt  || null,
        description: data.description || '',
        amount:      data.amount     || 0,
        status:      'Expense',
        deleted:     data.deleted || false,
      });
    });

    ciSnap.forEach(d => {
      const data = d.data();
      items.push({
        id:          d.id,
        type:        'cashin',
        refId:       data.cashInId  || '',
        date:        data.date      || '',
        time:        data.time      || '00:00:00',
        createdAt:   data.createdAt || null,
        description: data.reference || '—',
        amount:      data.amount    || 0,
        status:      'Cash In',
        deleted:     data.deleted   || false,
      });
    });

    // Sort by createdAt desc so backdated invoices stay in creation order.
    // Fall back to date+time string sort for old docs without createdAt.
    items.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? -1;
      const bMs = b.createdAt?.toMillis?.() ?? -1;
      if (aMs !== -1 || bMs !== -1) return bMs - aMs;
      const dc = b.date.localeCompare(a.date);
      return dc !== 0 ? dc : b.time.localeCompare(a.time);
    });

    _actCache = { ts: Date.now(), days, data: items };
    return items;
  } catch (err) {
    if (err.code === 'failed-precondition') {
      console.warn('⏳ Index building for activity feed…');
    } else {
      console.error('❌ getRecentActivity:', err);
    }
    return [];
  }
}

// ─── DB Export/Import Helpers ─────────────────────────────────
// Used by the dashboard DB-Export and DB-Import features.

export async function getAllDocsForExport() {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const [invSnap, depSnap, expSnap] = await Promise.all([
    getDocs(query(collection(db, 'invoices'), where('dateObj', '>=', toTimestamp(cutoff)), orderBy('dateObj', 'asc'))),
    getDocs(query(collection(db, 'deposits'), where('dateObj', '>=', toTimestamp(cutoff)), orderBy('dateObj', 'asc'))),
    getDocs(query(collection(db, 'expenses'), where('dateObj', '>=', toTimestamp(cutoff)), orderBy('dateObj', 'asc'))),
  ]);
  return {
    invoices: invSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    deposits: depSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    expenses: expSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

export async function bulkDeleteCollection(collName) {
  const snap = await getDocs(collection(db, collName));
  if (snap.empty) return;
  const CHUNK = 499;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function bulkSetDocs(collName, entries) {
  if (!entries.length) return;
  const CHUNK = 499;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = writeBatch(db);
    entries.slice(i, i + CHUNK).forEach(({ id, data }) => {
      batch.set(doc(db, collName, id), data);
    });
    await batch.commit();
  }
}

export async function resetAllCollections() {
  await Promise.all([
    bulkDeleteCollection('invoices'),
    bulkDeleteCollection('deposits'),
    bulkDeleteCollection('expenses'),
    bulkDeleteCollection('cash_ins'),
    bulkDeleteCollection('repairs'),
    bulkDeleteCollection('counters'),
  ]);
}
