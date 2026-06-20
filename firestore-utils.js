// Firestore Utility Functions — AKM-POS v3.0
// Fixed: deposit/expense/repair ID parsing, refund by docId, formatDate 'DD-MMM-YYYY'

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
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

import { APP_CONFIG, debugLog } from './config.js';

export { db };

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
  const counterRef  = doc(db, 'counters', 'invoices');
  const currentYear = new Date().getFullYear();
  const yy          = String(currentYear).slice(-2);
  const INIT        = APP_CONFIG.BUSINESS.STARTING_INVOICE_NUMBER;

  // Offline fallback: localStorage is always available; also queues a Firestore
  // write so the server counter catches up when connection is restored.
  const offlineFallback = () => {
    const last = readLocalCounter(currentYear);
    const next = Math.max(last + 1, INIT);
    writeLocalCounter(currentYear, next);
    // Do NOT write back to Firestore here — if another device online already
    // incremented the counter past `next`, this setDoc would corrupt it with
    // a lower value when we reconnect. The transaction in the try-block above
    // is the only safe writer; localStorage is offline-only state.
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
    // Keep localStorage in sync so offline fallback has accurate base
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
  const counterRef  = doc(db, 'counters', 'invoices');
  const currentYear = new Date().getFullYear();
  const yy          = String(currentYear).slice(-2);
  const INIT        = APP_CONFIG.BUSINESS.STARTING_INVOICE_NUMBER;
  try {
    const snap = await getDoc(counterRef);
    if (!snap.exists())              return `${yy}-${String(INIT).padStart(5, '0')}`;
    const data = snap.data();
    if (data.year !== currentYear)   return `${yy}-${String(INIT).padStart(5, '0')}`;
    const next = (data.lastSequence || INIT) + 1;
    // Cache in localStorage so offline fallback starts from the right place
    writeLocalCounter(currentYear, data.lastSequence);
    return `${yy}-${String(next).padStart(5, '0')}`;
  } catch (err) {
    console.error('❌ peekNextInvoiceNumber error:', err);
    // Offline: return what localStorage says
    const last = readLocalCounter(currentYear);
    return `${yy}-${String(Math.max(last + 1, INIT)).padStart(5, '0')}`;
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

export const getNextDepositId     = () => getNextMonthlyId('deposits', 'D');
export const getNextExpenseId     = () => getNextMonthlyId('expenses', 'E');
export const getNextRepairJobNumber = () => getNextMonthlyId('repairs',  'R');

// Aliases for callers that use uppercase
export const getNextDepositID = getNextDepositId;
export const getNextExpenseID = getNextExpenseId;

// ─── Invoices ────────────────────────────────────────────────

export async function createInvoice(invoiceData) {
  const {
    invoiceNumber, date, customer, payment, items, status = 'Paid',
    isAmendment = false, originalInvoiceId = null, originalInvoiceNumber = null,
  } = invoiceData;
  const today = new Date();
  const yy    = String(today.getFullYear()).slice(-2);
  const seq   = parseInt((invoiceNumber.split('-')[1]) || '0', 10);

  const impacts = {
    cash:   payment.method === 'Cash'   ? payment.grandTotal : 0,
    card:   payment.method === 'Card'   ? payment.grandTotal : 0,
    tabby:  payment.method === 'Tabby'  ? payment.grandTotal : 0,
    cheque: payment.method === 'Cheque' ? payment.grandTotal : 0,
  };

  const invoice = {
    invoiceNumber,
    year: today.getFullYear(),
    sequence: seq,
    date: formatDate(new Date(date), 'YYYY-MM-DD'),
    dateObj: toTimestamp(new Date(date)),
    time: formatTime(today),
    createdAt: serverTimestamp(),
    customer: {
      name:  customer.name  || 'Walk-in Customer',
      phone: customer.phone || '',
      trn:   customer.trn   || '',
    },
    payment,
    items,
    status,
    impacts,
    refundedAt: null,
    notes: '',
    isAmendment,
    ...(isAmendment && { originalInvoiceId, originalInvoiceNumber }),
  };

  const docRef = await addDoc(collection(db, 'invoices'), invoice);
  debugLog('✅ Invoice saved:', invoiceNumber, docRef.id);
  return docRef.id;
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
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    // Simple equality query — no composite index needed
    const q = query(collection(db, 'invoices'), where('date', '==', today));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('❌ getTodayInvoices:', err);
    return [];
  }
}

export async function getTodayDeposits() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    const q = query(collection(db, 'deposits'), where('date', '==', today));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('❌ getTodayDeposits:', err);
    return [];
  }
}

export async function getTodayExpenses() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    const q = query(collection(db, 'expenses'), where('date', '==', today));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('❌ getTodayExpenses:', err);
    return [];
  }
}

// ─── Deposits ────────────────────────────────────────────────

export async function createDeposit(depositData) {
  const { depositId, amount, bank, slipNumber, depositor, depositType = 'Cash' } = depositData;
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
  const { expenseId, category = '', description, amount, receiptNumber } = expenseData;
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
    receiptNumber,
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
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 1825); // 5 years
  try {
    const [invSnap, depSnap, expSnap] = await Promise.all([
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
    ]);

    let totalCash = 0;
    invSnap.forEach(d => {
      const data = d.data();
      if (data.status === 'Paid' && !data.deleted) totalCash += data.impacts?.cash || 0;
    });
    let totalDeposits = 0;
    depSnap.forEach(d => {
      const data = d.data();
      // Only cash deposits reduce cash in hand; cheque deposits are informational
      if (!data.deleted && (data.depositType || 'Cash') === 'Cash') totalDeposits += data.amount || 0;
    });
    let totalExpenses = 0;
    expSnap.forEach(d => {
      if (!d.data().deleted) totalExpenses += d.data().amount || 0;
    });

    return {
      totalCash,
      totalDeposits,
      totalExpenses,
      cashInHand: totalCash - totalDeposits - totalExpenses,
    };
  } catch (err) {
    console.error('❌ getAllTimeCashFlow:', err);
    return null;
  }
}

// ─── Unified Activity Feed ───────────────────────────────────
// Returns invoices + deposits + expenses merged and sorted by date/time desc.
export async function getRecentActivity(days = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  try {
    const [invSnap, depSnap, expSnap] = await Promise.all([
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
    ]);

    const items = [];

    invSnap.forEach(d => {
      const data = d.data();
      items.push({
        id:          d.id,
        type:        'invoice',
        refId:       data.invoiceNumber || '',
        date:        data.date          || '',
        time:        data.time          || '00:00:00',
        createdAt:   data.createdAt     || null,
        description: data.customer?.name || 'Walk-in',
        amount:      data.payment?.grandTotal || 0,
        status:      data.status  || 'Paid',
        payment:     data.payment?.method || 'Cash',
        deleted:     data.deleted || false,
      });
    });

    depSnap.forEach(d => {
      const data = d.data();
      const slip = data.slipNumber ? ` · Slip: ${data.slipNumber}` : '';
      items.push({
        id:          d.id,
        type:        'deposit',
        refId:       data.depositId || '',
        date:        data.date      || '',
        time:        data.time      || '00:00:00',
        createdAt:   data.createdAt || null,
        description: `${data.depositor || ''}${data.bank ? ` → ${data.bank}` : ''}${slip}`,
        amount:      data.amount    || 0,
        status:      'Deposited',
        payment:     data.bank      || '',
        slip:        data.slipNumber || '',
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
        receipt:     data.receiptNumber || '',
        deleted:     data.deleted || false,
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
    bulkDeleteCollection('counters'),
  ]);
}
