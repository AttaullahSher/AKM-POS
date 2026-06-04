// Firestore Utility Functions
// AKM-POS v2.1 - Centralized Configuration

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

// Re-export db for use in other modules
export { db };

// ===== HELPER FUNCTIONS =====

/**
 * Format date to various formats
 * @param {Date|string} date - Date object or ISO string
 * @param {string} format - Format type: 'YYYY-MM-DD', 'DD/MM/YYYY', 'HH:mm:ss', 'DD MMM YYYY'
 * @returns {string} Formatted date string
 * @example
 * formatDate(new Date(), 'YYYY-MM-DD') // '2025-01-04'
 * formatDate(new Date(), 'DD MMM YYYY') // '04 Jan 2025'
 */
export function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  if (format === 'YYYY-MM-DD') {
    return `${year}-${month}-${day}`;
  } else if (format === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  } else if (format === 'HH:mm:ss') {
    return `${hours}:${minutes}:${seconds}`;
  } else if (format === 'DD MMM YYYY') {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${monthNames[d.getMonth()]} ${year}`;
  }
  
  return d.toISOString();
}

/**
 * Format time to HH:mm:ss
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Time in HH:mm:ss format
 * @example
 * formatTime(new Date()) // '14:30:45'
 */
export function formatTime(date) {
  return formatDate(date, 'HH:mm:ss');
}

/**
 * Convert Date to Firestore Timestamp
 * @param {Date|string} date - Date object or ISO string
 * @returns {Timestamp} Firestore Timestamp object
 */
export function toTimestamp(date) {
  if (!date) return Timestamp.now();
  return Timestamp.fromDate(date instanceof Date ? date : new Date(date));
}

// ===== COUNTER FUNCTIONS =====

/**
 * Get next invoice number (atomic transaction)
 * Format: YYYY-#####
 */
export async function getNextInvoiceNumber() {
  const counterRef = doc(db, 'counters', 'invoices');
  
  try {
    const result = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const currentYear = new Date().getFullYear();
      const yy = String(currentYear).slice(-2); // Last 2 digits
      
      if (!counterDoc.exists()) {
        // First time setup
        const initialSequence = 15001;
        transaction.set(counterRef, {
          year: currentYear,
          lastSequence: initialSequence,
          updatedAt: serverTimestamp()
        });
        return `${yy}-${String(initialSequence).padStart(5, '0')}`;
      }
      
      const data = counterDoc.data();
      
      if (data.year !== currentYear) {
        // New year - reset sequence
        const initialSequence = 15001;
        transaction.update(counterRef, {
          year: currentYear,
          lastSequence: initialSequence,
          updatedAt: serverTimestamp()
        });
        return `${yy}-${String(initialSequence).padStart(5, '0')}`;
      }
      
      // Same year - increment
      const newSequence = data.lastSequence + 1;
      transaction.update(counterRef, {
        lastSequence: newSequence,
        updatedAt: serverTimestamp()
      });
      
      return `${yy}-${String(newSequence).padStart(5, '0')}`;
    });
    
    return result;
  } catch (error) {
    console.error('❌ Error getting next invoice number:', error);
    // Fallback: use timestamp-based unique ID
    const yy = String(new Date().getFullYear()).slice(-2);
    const fallbackId = yy + '-' + Date.now().toString().slice(-5);
    console.warn('⚠️ Using fallback invoice number:', fallbackId);
    return fallbackId;
  }
}

/**
 * Get next deposit ID (atomic transaction)
 * Format: D-MM##
 */
export async function getNextDepositId() {
  const counterRef = doc(db, 'counters', 'deposits');
  
  try {
    const result = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      
      if (!counterDoc.exists()) {
        // First time setup
        transaction.set(counterRef, {
          month: month,
          lastSequence: 1,
          updatedAt: serverTimestamp()
        });
        return `D-${month}01`;
      }
      
      const data = counterDoc.data();
      
      if (data.month !== month) {
        // New month - reset sequence
        transaction.update(counterRef, {
          month: month,
          lastSequence: 1,
          updatedAt: serverTimestamp()
        });
        return `D-${month}01`;
      }
      
      // Same month - increment
      const newSequence = data.lastSequence + 1;
      transaction.update(counterRef, {
        lastSequence: newSequence,
        updatedAt: serverTimestamp()
      });
      
      return `D-${month}${String(newSequence).padStart(2, '0')}`;
    });
    
    return result;
  } catch (error) {
    console.error('❌ Error getting next deposit ID:', error);
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    return `D-${month}${Date.now().toString().slice(-2)}`;
  }
}

/**
 * Get next expense ID (atomic transaction)
 * Format: E-MM##
 */
export async function getNextExpenseId() {
  const counterRef = doc(db, 'counters', 'expenses');
  
  try {
    const result = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      
      if (!counterDoc.exists()) {
        // First time setup
        transaction.set(counterRef, {
          month: month,
          lastSequence: 1,
          updatedAt: serverTimestamp()
        });
        return `E-${month}01`;
      }
      
      const data = counterDoc.data();
      
      if (data.month !== month) {
        // New month - reset sequence
        transaction.update(counterRef, {
          month: month,
          lastSequence: 1,
          updatedAt: serverTimestamp()
        });
        return `E-${month}01`;
      }
      
      // Same month - increment
      const newSequence = data.lastSequence + 1;
      transaction.update(counterRef, {
        lastSequence: newSequence,
        updatedAt: serverTimestamp()
      });
      
      return `E-${month}${String(newSequence).padStart(2, '0')}`;
    });
    
    return result;
  } catch (error) {
    console.error('❌ Error getting next expense ID:', error);    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    return `E-${month}${Date.now().toString().slice(-2)}`;
  }
}

/**
 * Get next repair job number (atomic transaction)
 * Format: MMSS (month + sequence, e.g., 1201)
 */
/**
 * Get next repair job number (atomic transaction)
 * Format: R-MM##
 */
export async function getNextRepairJobNumber() {
  const counterRef = doc(db, 'counters', 'repairs');
  
  try {
    const result = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      
      if (!counterDoc.exists()) {
        transaction.set(counterRef, {
          month: month,
          lastSequence: 1,
          updatedAt: serverTimestamp()
        });
        return `R-${month}01`;
      }
      
      const data = counterDoc.data();
      
      if (data.month !== month) {
        transaction.update(counterRef, {
          month: month,
          lastSequence: 1,
          updatedAt: serverTimestamp()
        });
        return `R-${month}01`;
      }
      
      const newSequence = data.lastSequence + 1;
      transaction.update(counterRef, {
        lastSequence: newSequence,
        updatedAt: serverTimestamp()
      });
      
      return `R-${month}${String(newSequence).padStart(2, '0')}`;
    });
    
    return result;
  } catch (error) {
    console.error('❌ Error getting next repair job number:', error);
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    return `R-${month}${Date.now().toString().slice(-2)}`;
  }
}

// ===== INVOICE FUNCTIONS =====

/**
 * Create new invoice in Firestore
 */
export async function createInvoice(invoiceData) {
  try {
    const {
      invoiceNumber,
      date,
      customer,
      payment,
      items,
      status = 'Paid'
    } = invoiceData;
    
    const today = new Date();
    const year = today.getFullYear();
    const sequence = parseInt(invoiceNumber.split('-')[1]);
    
    // Calculate impacts
    const impacts = {
      cash: payment.method === 'Cash' ? payment.grandTotal : 0,
      card: payment.method === 'Card' ? payment.grandTotal : 0,
      tabby: payment.method === 'Tabby' ? payment.grandTotal : 0,
      cheque: payment.method === 'Cheque' ? payment.grandTotal : 0
    };
    
    const invoice = {
      invoiceNumber,
      year,
      sequence,
      date: formatDate(date, 'YYYY-MM-DD'),
      dateObj: toTimestamp(date),
      time: formatDate(today, 'HH:mm:ss'),
      createdAt: serverTimestamp(),
      customer: {
        name: customer.name || 'Walk-in Customer',
        phone: customer.phone || '',
        trn: customer.trn || ''
      },
      payment,
      items,
      status,
      impacts,
      refundedAt: null,
      notes: ''
    };
    
    const docRef = await addDoc(collection(db, 'invoices'), invoice);
    console.log('✅ Invoice created:', invoiceNumber, 'Document ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error creating invoice:', error);
    throw error;
  }
}

/**
 * Load recent invoices (last N days)
 */
export async function loadRecentInvoices(days = 7) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const q = query(
      collection(db, 'invoices'),
      where('dateObj', '>=', toTimestamp(cutoffDate)),
      orderBy('dateObj', 'desc'),
      limit(50)
    );
    
    const snapshot = await getDocs(q);
    const invoices = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      invoices.push({
        id: doc.id,
        invoiceNumber: data.invoiceNumber,
        date: data.date,
        customer: data.customer?.name || 'Walk-in',
        payment: data.payment?.method || 'Cash',
        grandTotal: data.payment?.grandTotal || 0,
        status: data.status || 'Paid'
      });
    });
    
    return invoices;
  } catch (error) {
    // Handle index-building errors gracefully
    if (error.code === 'failed-precondition' && error.message.includes('building')) {
      console.warn('⏳ Recent invoices index is still building. List will load when ready.');
      return [];
    }
    console.error('❌ Error loading recent invoices:', error);
    return [];
  }
}

/**
 * Load today's dashboard data
 */
export async function loadTodayDashboard() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    
    // Query today's paid invoices
    const invoicesQ = query(
      collection(db, 'invoices'),
      where('date', '==', today),
      where('status', '==', 'Paid')
    );
    
    const invoicesSnap = await getDocs(invoicesQ);
    
    let cash = 0, card = 0, tabby = 0, cheque = 0, totalCashIn = 0;
    
    invoicesSnap.forEach(doc => {
      const data = doc.data();
      cash += data.impacts.cash || 0;
      card += data.impacts.card || 0;
      tabby += data.impacts.tabby || 0;
      cheque += data.impacts.cheque || 0;
      totalCashIn += data.payment.grandTotal || 0;
    });
    
    // Query today's deposits
    const depositsQ = query(
      collection(db, 'deposits'),
      where('date', '==', today)
    );
    
    const depositsSnap = await getDocs(depositsQ);
    let totalCashOut = 0;
    
    depositsSnap.forEach(doc => {
      const data = doc.data();
      totalCashOut += Math.abs(data.cashImpact || 0);
    });
    
    // Query today's expenses
    const expensesQ = query(
      collection(db, 'expenses'),
      where('date', '==', today)
    );
    
    const expensesSnap = await getDocs(expensesQ);
    
    expensesSnap.forEach(doc => {
      const data = doc.data();
      totalCashOut += Math.abs(data.cashImpact || 0);
    });
    
    // Calculate all-time cash in hand (we need to query all invoices for this)
    // For now, we'll calculate just today's impact
    const cashInHand = totalCashIn - totalCashOut;
      return {
      cash,
      card,
      tabby,
      cheque,
      cashInHand
    };
  } catch (error) {
    // Handle index-building errors gracefully
    if (error.code === 'failed-precondition' && error.message.includes('building')) {
      console.warn('⏳ Dashboard index is still building. Metrics will load when ready.');
      return { cash: 0, card: 0, tabby: 0, cheque: 0, cashInHand: 0 };
    }
    console.error('❌ Error loading dashboard:', error);
    return {
      cash: 0,
      card: 0,
      tabby: 0,
      cheque: 0,
      cashInHand: 0
    };
  }
}

/**
 * Refund an invoice
 */
export async function refundInvoice(invoiceNumber) {
  try {
    // Find invoice by number
    const q = query(
      collection(db, 'invoices'),
      where('invoiceNumber', '==', invoiceNumber),
      limit(1)
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      throw new Error('Invoice not found');
    }
    
    const docRef = doc(db, 'invoices', snapshot.docs[0].id);
    
    await updateDoc(docRef, {
      status: 'Refunded',
      refundedAt: serverTimestamp(),
      // Zero out impacts
      'impacts.cash': 0,
      'impacts.card': 0,
      'impacts.tabby': 0,
      'impacts.cheque': 0
    });
    
    console.log('✅ Invoice refunded:', invoiceNumber);
    return true;
  } catch (error) {
    console.error('❌ Error refunding invoice:', error);
    throw error;
  }
}

/**
 * Get invoice by number (for reprint)
 */
export async function getInvoiceByNumber(invoiceNumber) {
  try {
    const q = query(
      collection(db, 'invoices'),
      where('invoiceNumber', '==', invoiceNumber),
      limit(1)
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return null;
    }
    
    return {
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data()
    };
  } catch (error) {
    console.error('❌ Error getting invoice:', error);
    return null;
  }
}

// ===== DEPOSIT FUNCTIONS =====

/**
 * Create deposit
 */
export async function createDeposit(depositData) {
  try {
    const {
      depositId,
      amount,
      bank,
      slipNumber,
      depositor
    } = depositData;
    
    const today = new Date();
    const yearMonth = depositId.split('-')[0];
    
    const deposit = {
      depositId,
      yearMonth,
      sequence: parseInt(depositId.split('-')[1]),
      date: formatDate(today, 'YYYY-MM-DD'),
      dateObj: toTimestamp(today),
      time: formatDate(today, 'HH:mm:ss'),
      createdAt: serverTimestamp(),
      amount,
      bank,
      slipNumber,
      depositor,
      cashImpact: -amount,
      notes: ''
    };
    
    const docRef = await addDoc(collection(db, 'deposits'), deposit);
    console.log('✅ Deposit created:', depositId);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error creating deposit:', error);
    throw error;
  }
}

// ===== EXPENSE FUNCTIONS =====

/**
 * Create expense
 */
export async function createExpense(expenseData) {
  try {
    const {
      expenseId,
      category,
      description,
      amount,
      receiptNumber
    } = expenseData;
    
    const today = new Date();
    const yearMonth = expenseId.split('-')[0];
    
    const expense = {
      expenseId,
      yearMonth,
      sequence: parseInt(expenseId.split('-')[1]),
      date: formatDate(today, 'YYYY-MM-DD'),
      dateObj: toTimestamp(today),
      time: formatDate(today, 'HH:mm:ss'),
      createdAt: serverTimestamp(),
      category,
      description,
      amount,
      receiptNumber,
      cashImpact: -amount,
      notes: ''
    };
    
    const docRef = await addDoc(collection(db, 'expenses'), expense);
    console.log('✅ Expense created:', expenseId);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error creating expense:', error);
    throw error;
  }
}

// ===== REPAIR FUNCTIONS =====

/**
 * Create repair job
 */
export async function createRepairJob(repairData) {
  try {
    const {
      jobNumber,
      customer,
      product,
      service,
      charges
    } = repairData;
    
    const today = new Date();
    const month = jobNumber.substring(0, 2);
    
    const repair = {
      jobNumber,
      month,
      sequence: parseInt(jobNumber.substring(2)),
      date: formatDate(today, 'YYYY-MM-DD'),
      dateObj: toTimestamp(today),
      createdAt: serverTimestamp(),
      customer: {
        name: customer.name || '',
        phone: customer.phone
      },
      product,
      service: service || '',
      charges: charges || 0,
      status: 'InProcess',
      completedAt: null,
      collectedAt: null,
      notes: ''
    };
    
    const docRef = await addDoc(collection(db, 'repairs'), repair);
    console.log('✅ Repair job created:', jobNumber);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error creating repair job:', error);
    throw error;
  }
}

/**
 * Load all repair jobs
 */
export async function loadRepairJobs() {
  try {
    const q = query(
      collection(db, 'repairs'),
      orderBy('dateObj', 'desc'),
      limit(100)
    );
    
    const snapshot = await getDocs(q);
    const repairs = [];
    
    snapshot.forEach(doc => {
      repairs.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return repairs;
  } catch (error) {
    // Handle index-building errors gracefully
    if (error.code === 'failed-precondition' && error.message.includes('building')) {
      console.warn('⏳ Repair jobs index is still building. List will load when ready.');
      return [];
    }
    console.error('❌ Error loading repair jobs:', error);
    return [];
  }
}

/**
 * Update repair job status
 */
export async function updateRepairStatus(jobNumber, newStatus) {
  try {
    const q = query(
      collection(db, 'repairs'),
      where('jobNumber', '==', jobNumber),
      limit(1)
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      throw new Error('Repair job not found');
    }
    
    const docRef = doc(db, 'repairs', snapshot.docs[0].id);
    const updateData = { status: newStatus };
    
    if (newStatus === 'Completed') {
      updateData.completedAt = serverTimestamp();
    } else if (newStatus === 'Collected') {
      updateData.collectedAt = serverTimestamp();
    }
    
    await updateDoc(docRef, updateData);
    console.log('✅ Repair status updated:', jobNumber, '->', newStatus);
    return true;
  } catch (error) {
    console.error('❌ Error updating repair status:', error);
    throw error;
  }
}

// ===== OFFLINE BACKUP =====

/**
 * Save to offline backup (localStorage fallback)
 */
export function saveOfflineBackup(type, data) {
  try {
    const backups = JSON.parse(localStorage.getItem('firestoreOfflineBackup') || '{}');
    if (!backups[type]) {
      backups[type] = [];
    }
    backups[type].push({
      ...data,
      offlineTimestamp: Date.now()
    });
    localStorage.setItem('firestoreOfflineBackup', JSON.stringify(backups));
    console.log(`💾 Saved to offline backup: ${type}`);
  } catch (error) {
    console.error('❌ Error saving offline backup:', error);
  }
}

/**
 * Get offline backups
 */
export function getOfflineBackups() {
  try {
    return JSON.parse(localStorage.getItem('firestoreOfflineBackup') || '{}');
  } catch (error) {
    console.error('❌ Error reading offline backups:', error);
    return {};
  }
}

/**
 * Clear offline backups after successful sync
 */
export function clearOfflineBackups() {
  try {
    localStorage.removeItem('firestoreOfflineBackup');
    console.log('🗑️ Offline backups cleared');
  } catch (error) {
    console.error('❌ Error clearing offline backups:', error);
  }
}

// ===== FUNCTION ALIASES (for backwards compatibility with import statements) =====

/**
 * Alias: saveInvoice -> createInvoice
 */
export const saveInvoice = createInvoice;

/**
 * Alias: saveDeposit -> createDeposit
 */
export const saveDeposit = createDeposit;

/**
 * Alias: saveExpense -> createExpense
 */
export const saveExpense = createExpense;

/**
 * Alias: getRecentInvoices -> loadRecentInvoices
 */
export const getRecentInvoices = loadRecentInvoices;

/**
 * Alias: markInvoiceAsRefunded -> refundInvoice
 */
export const markInvoiceAsRefunded = refundInvoice;

/**
 * Alias: saveRepairJob -> createRepairJob
 */
export const saveRepairJob = createRepairJob;

/**
 * Alias: getRecentRepairJobs -> loadRepairJobs
 */
export const getRecentRepairJobs = loadRepairJobs;

/**
 * Alias: updateRepairJobStatus -> updateRepairStatus
 */
export const updateRepairJobStatus = updateRepairStatus;

/**
 * Get today's invoices only (subset of loadTodayDashboard)
 */
export async function getTodayInvoices() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    const q = query(
      collection(db, 'invoices'),
      where('date', '==', today),
      where('status', '==', 'Paid'),
      orderBy('dateObj', 'desc')
    );
    const snapshot = await getDocs(q);
    const invoices = [];
    snapshot.forEach(doc => {
      invoices.push({ id: doc.id, ...doc.data() });
    });    return invoices;
  } catch (error) {
    if (error.code === 'failed-precondition' && error.message.includes('building')) {
      console.warn('⏳ Invoices index is still building. Dashboard will load when ready.');
      return [];
    }
    if (error.code === 'permission-denied') {
      console.error('❌ Permission denied. Please ensure you are signed in as sales@akm-music.com');
      return [];
    }
    console.error('❌ Error loading today invoices:', error);
    return [];
  }
}

/**
 * Get today's deposits only
 */
export async function getTodayDeposits() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    const q = query(
      collection(db, 'deposits'),
      where('date', '==', today),
      orderBy('dateObj', 'desc')
    );
    const snapshot = await getDocs(q);
    const deposits = [];
    snapshot.forEach(doc => {
      deposits.push({ id: doc.id, ...doc.data() });
    });    return deposits;
  } catch (error) {
    if (error.code === 'failed-precondition' && error.message.includes('building')) {
      console.warn('⏳ Deposits index is still building. Dashboard will load when ready.');
      return [];
    }
    console.error('❌ Error loading today deposits:', error);
    return [];
  }
}

/**
 * Get today's expenses only
 */
export async function getTodayExpenses() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    const q = query(
      collection(db, 'expenses'),
      where('date', '==', today),
      orderBy('dateObj', 'desc')
    );
    const snapshot = await getDocs(q);
    const expenses = [];
    snapshot.forEach(doc => {
      expenses.push({ id: doc.id, ...doc.data() });
    });    return expenses;
  } catch (error) {
    if (error.code === 'failed-precondition' && error.message.includes('building')) {
      console.warn('⏳ Expenses index is still building. Dashboard will load when ready.');
      return [];
    }
    console.error('❌ Error loading today expenses:', error);
    return [];
  }
}

/**
 * Alias: getNextDepositID -> getNextDepositId (case difference)
 */
export const getNextDepositID = getNextDepositId;

/**
 * Alias: getNextExpenseID -> getNextExpenseId (case difference)
 */
export const getNextExpenseID = getNextExpenseId;
