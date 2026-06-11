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

export async function getNextInvoiceNumber() {
  const counterRef = doc(db, 'counters', 'invoices');
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const currentYear = new Date().getFullYear();
      const yy = String(currentYear).slice(-2);
      const INIT = APP_CONFIG.BUSINESS.STARTING_INVOICE_NUMBER;

      if (!snap.exists()) {
        tx.set(counterRef, { year: currentYear, lastSequence: INIT, updatedAt: serverTimestamp() });
        return `${yy}-${String(INIT).padStart(5, '0')}`;
      }
      const data = snap.data();
      if (data.year !== currentYear) {
        tx.update(counterRef, { year: currentYear, lastSequence: INIT, updatedAt: serverTimestamp() });
        return `${yy}-${String(INIT).padStart(5, '0')}`;
      }
      const next = data.lastSequence + 1;
      tx.update(counterRef, { lastSequence: next, updatedAt: serverTimestamp() });
      return `${yy}-${String(next).padStart(5, '0')}`;
    });
  } catch (err) {
    console.error('❌ Invoice counter error:', err);
    const yy = String(new Date().getFullYear()).slice(-2);
    return `${yy}-${Date.now().toString().slice(-5)}`;
  }
}

/**
 * Peek the NEXT invoice number WITHOUT consuming it (read-only).
 * Shown as a preview on load so refreshing the page never burns numbers.
 * The number is only committed via getNextInvoiceNumber() when an invoice saves.
 */
export async function peekNextInvoiceNumber() {
  const counterRef = doc(db, 'counters', 'invoices');
  const currentYear = new Date().getFullYear();
  const yy   = String(currentYear).slice(-2);
  const INIT = APP_CONFIG.BUSINESS.STARTING_INVOICE_NUMBER;
  try {
    const snap = await getDoc(counterRef);
    if (!snap.exists())              return `${yy}-${String(INIT).padStart(5, '0')}`;
    const data = snap.data();
    if (data.year !== currentYear)   return `${yy}-${String(INIT).padStart(5, '0')}`;
    const next = (data.lastSequence || INIT) + 1;
    return `${yy}-${String(next).padStart(5, '0')}`;
  } catch (err) {
    console.error('❌ peekNextInvoiceNumber error:', err);
    return `${yy}-${String(INIT).padStart(5, '0')}`;
  }
}

// Generic monthly counter helper: prefix D→deposits, E→expenses, R→repairs
async function getNextMonthlyId(collectionName, prefix) {
  const counterRef = doc(db, 'counters', collectionName);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  try {
    return await runTransaction(db, async (tx) => {
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
    });
  } catch (err) {
    console.error(`❌ ${collectionName} counter error:`, err);
    return `${prefix}-${month}${Date.now().toString().slice(-2)}`;
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
  const { invoiceNumber, date, customer, payment, items, status = 'Paid' } = invoiceData;
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
    return snap.docs.map(d => ({
      id: d.id,
      invoiceNumber: d.data().invoiceNumber,
      date: d.data().date,
      customer: d.data().customer?.name || 'Walk-in',
      payment: d.data().payment?.method || 'Cash',
      grandTotal: d.data().payment?.grandTotal || 0,
      status: d.data().status || 'Paid',
    }));
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
  const { depositId, amount, bank, slipNumber, depositor } = depositData;
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
    cashImpact: -amount,
    notes: '',
  };

  const docRef = await addDoc(collection(db, 'deposits'), deposit);
  debugLog('✅ Deposit saved:', depositId);
  return docRef.id;
}

// ─── Expenses ────────────────────────────────────────────────

export async function createExpense(expenseData) {
  const { expenseId, category, description, amount, receiptNumber } = expenseData;
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
