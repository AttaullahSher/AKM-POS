// AKM-POS v3.0 — Main POS Application
// Fixes: VAT NaN, deposit/expense crash, auto-refresh storm, print timing,
//        addItemRow override, refund arg, triple Firebase init, keyboard nav.

import {
  auth, provider,
  signInWithPopup, onAuthStateChanged, signOut
} from './firebase-config.js';

import {
  getNextInvoiceNumber,
  getNextDepositId,
  getNextExpenseId,
  saveInvoice,
  saveDeposit,
  saveExpense,
  getTodayInvoices,
  getTodayDeposits,
  getTodayExpenses,
  loadRecentInvoices,
  markInvoiceAsRefunded,
  getInvoiceByNumber,
  formatDate,
  formatTime,
} from './firestore-utils.js';

import { APP_CONFIG, debugLog } from './config.js';
import { showToast } from './utils.js';

const ALLOWED_EMAIL  = APP_CONFIG.ALLOWED_EMAIL;
const VALIDATION     = APP_CONFIG.VALIDATION;
const BUSINESS       = APP_CONFIG.BUSINESS;
const PERF           = APP_CONFIG.PERFORMANCE;

function updateEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── Global State ────────────────────────────────────────────
let currentUser          = null;
let currentPaymentMethod = null;
let isReprintMode        = false;
let reprintInvoiceData   = null;
let originalInputStates  = [];

// ─── Print Helpers ───────────────────────────────────────────

function preparePrintLayout() {
  originalInputStates = [];
  const container = document.querySelector('.invoice-card');
  if (!container) return;

  // Hide empty rows
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const row   = document.querySelector(`tr[data-row-index="${i}"]`);
    const model = document.getElementById(`model${i}`);
    const desc  = document.getElementById(`description${i}`);
    if (row && model && desc && !model.value.trim() && !desc.value.trim()) {
      row.style.display = 'none';
      row.dataset.hiddenForPrint = '1';
    }
  }

  // Replace inputs with static spans
  container.querySelectorAll('input, .amount-cell').forEach(el => {
    const state = { element: el, display: el.style.display, parent: el.parentNode };
    originalInputStates.push(state);

    const span = document.createElement('span');
    span.className = 'print-text-replacement';
    span.textContent = el.classList.contains('amount-cell')
      ? (el.textContent || ' ')
      : (el.value || ' ');

    if (el.id?.includes('description')) {
      span.style.whiteSpace = 'pre-wrap';
      span.style.wordBreak  = 'break-word';
    }

    el.style.display = 'none';
    el.parentNode.insertBefore(span, el);
  });
}

function restorePrintLayout() {
  document.querySelectorAll('.print-text-replacement').forEach(s => s.remove());
  originalInputStates.forEach(s => { s.element.style.display = s.display; });
  originalInputStates = [];

  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const row = document.querySelector(`tr[data-row-index="${i}"]`);
    if (row && row.dataset.hiddenForPrint) {
      if (i > 3) {
        const model = document.getElementById(`model${i}`);
        if (!model?.value.trim()) row.style.display = 'none';
        else row.style.display = '';
      } else {
        row.style.display = '';
      }
      delete row.dataset.hiddenForPrint;
    }
  }
}

window.addEventListener('beforeprint', preparePrintLayout);
window.addEventListener('afterprint',  restorePrintLayout);

// ─── Error Handlers ──────────────────────────────────────────

window.addEventListener('unhandledrejection', (e) => {
  console.error('❌ Unhandled rejection:', e.reason);
  if (e.reason?.message?.includes('Failed to fetch')) {
    showToast('⚠️ Network issue. Check your connection.', 'error');
  }
  e.preventDefault();
});

// ─── Auth ────────────────────────────────────────────────────

async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    if (result.user.email !== ALLOWED_EMAIL) {
      await signOut(auth);
      showToast(`Access denied. Only ${ALLOWED_EMAIL} may sign in.`, 'error');
      return;
    }
    currentUser = result.user;
    showMainApp();
  } catch (err) {
    console.error('Login error:', err);
    showToast('Login failed. Please try again.', 'error');
  }
}

async function logout() {
  try {
    await signOut(auth);
    currentUser = null;
    showLoginScreen();
  } catch (err) {
    console.error('Logout error:', err);
    showToast('Logout failed.', 'error');
  }
}

function showLoginScreen() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display   = 'flex';
  document.getElementById('mainApp').style.display       = 'none';
}

function showMainApp() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display   = 'none';
  document.getElementById('mainApp').style.display       = 'flex';
  initializePOS();
}

// ─── Initialization ──────────────────────────────────────────

async function initializePOS() {
  debugLog('🚀 Initializing AKM-POS v3.0');
  const screen = document.getElementById('loadingScreen');
  if (screen) screen.style.display = 'flex';

  try {
    initializeItemsTable();
    setLoadingText('Loading invoice number…');
    await loadNextInvoiceNumber();

    setLoadingText('Loading dashboard…');
    await loadDashboardData();

    setLoadingText('Loading recent invoices…');
    await loadRecentInvoicesPanel();

    setupAutoRefresh();
    showToast('✅ POS ready!', 'success');
  } catch (err) {
    console.error('❌ Init error:', err);
    showToast('⚠️ Partial load — offline mode active.', 'warning');
  } finally {
    if (screen) setTimeout(() => { screen.style.display = 'none'; }, 300);
  }
}

function setLoadingText(msg) {
  const el = document.getElementById('loadingText');
  if (el) el.textContent = msg;
  debugLog('⏳', msg);
}

// ─── Items Table ─────────────────────────────────────────────

function initializeItemsTable() {
  const body = document.getElementById('itemsBody');
  if (!body) return;

  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const row = document.createElement('tr');
    row.setAttribute('data-row-index', i);
    row.innerHTML = `
      <td><input type="text"   id="model${i}"       class="item-input" placeholder="Model"       autocomplete="off"></td>
      <td><input type="text"   id="description${i}" class="item-input" placeholder="Description" autocomplete="off"></td>
      <td><input type="number" id="quantity${i}"     class="item-input" min="1" value="1"          autocomplete="off" style="text-align:right"></td>
      <td><input type="number" id="price${i}"        class="item-input" min="0" step="0.01" placeholder="0.00" autocomplete="off" style="text-align:right"></td>
      <td class="amount-cell"  id="amount${i}">0.00</td>`;

    if (i > 3) row.style.display = 'none';
    body.appendChild(row);

    const qtyEl    = row.querySelector(`#quantity${i}`);
    const priceEl  = row.querySelector(`#price${i}`);
    const amountEl = row.querySelector(`#amount${i}`);

    const recalc = () => {
      const amt = (parseFloat(qtyEl.value) || 0) * (parseFloat(priceEl.value) || 0);
      amountEl.textContent = amt.toFixed(2);
      calculateTotals();
    };

    qtyEl.addEventListener('input',  recalc);
    priceEl.addEventListener('input', recalc);

    // Enter on price → move to next row
    priceEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i < VALIDATION.MAX_ITEMS_PER_INVOICE) {
        const nextRow = document.querySelector(`tr[data-row-index="${i + 1}"]`);
        if (nextRow && nextRow.style.display === 'none') nextRow.style.display = '';
        document.getElementById(`model${i + 1}`)?.focus();
      }
    });
  }
  debugLog('✅ Items table ready (3 visible / 10 total)');
}

function calculateTotals() {
  let subtotal = 0;
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    subtotal += parseFloat(document.getElementById(`amount${i}`)?.textContent || '0') || 0;
  }
  const vat   = parseFloat((subtotal * BUSINESS.VAT_RATE).toFixed(2));
  const grand = parseFloat((subtotal + vat).toFixed(2));

  updateEl('subTotal',   subtotal.toFixed(2));
  updateEl('vatAmount',  vat.toFixed(2));
  updateEl('grandTotal', grand.toFixed(2));
}

// Show the next hidden item row (fixes the override bug)
function revealNextItemRow() {
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const row = document.querySelector(`tr[data-row-index="${i}"]`);
    if (row && row.style.display === 'none') {
      row.style.display = '';
      document.getElementById(`model${i}`)?.focus();
      return;
    }
  }
  showToast('Maximum 10 items per invoice.', 'warning');
}

// ─── Invoice Number ──────────────────────────────────────────

async function loadNextInvoiceNumber() {
  try {
    const num = await getNextInvoiceNumber();
    updateEl('invNum', num);
    const btn = document.getElementById('printBtn');
    if (btn && !isReprintMode) { btn.disabled = false; btn.textContent = '🖨️ Save & Print Invoice'; }
    debugLog('✅ Invoice number:', num);
  } catch (err) {
    console.error('❌ Invoice number error:', err);
    const yy = String(new Date().getFullYear()).slice(-2);
    updateEl('invNum', `${yy}-${BUSINESS.STARTING_INVOICE_NUMBER}`);
  }
}

// ─── Dashboard Data ──────────────────────────────────────────

async function loadDashboardData() {
  if (!currentUser) return;
  try {
    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(),
      getTodayDeposits(),
      getTodayExpenses(),
    ]);

    let cash = 0, card = 0, tabby = 0, cheque = 0;
    invoices.forEach(inv => {
      if (inv.status === 'Paid') {
        cash   += inv.impacts?.cash   || 0;
        card   += inv.impacts?.card   || 0;
        tabby  += inv.impacts?.tabby  || 0;
        cheque += inv.impacts?.cheque || 0;
      }
    });

    const totalSales    = cash + card + tabby + cheque;
    const totalDeposits = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const cashInHand    = cash - totalDeposits - totalExpenses;

    updateEl('todaySalesQuick',  `${totalSales.toFixed(2)}`);
    updateEl('cashInHandQuick',  `${cashInHand.toFixed(2)}`);
  } catch (err) {
    console.error('❌ Dashboard error:', err);
    updateEl('todaySalesQuick', '0.00');
    updateEl('cashInHandQuick', '0.00');
  }
}

// ─── Recent Invoices Panel (sidebar) ─────────────────────────

async function loadRecentInvoicesPanel() {
  if (!currentUser) return;
  const container = document.getElementById('recentInvoices');
  if (!container) return;

  try {
    const invoices = await loadRecentInvoices(60); // last 60 days
    if (!invoices.length) {
      container.innerHTML = '<div class="sidebar-empty">No recent invoices</div>';
      return;
    }
    container.innerHTML = invoices.slice(0, 50).map(inv => `
      <div class="recent-inv-card ${inv.status === 'Refunded' ? 'refunded' : ''}"
           onclick="handleReprintInvoice('${inv.id}')">
        <div class="recent-inv-top">
          <span class="recent-inv-num">${inv.invoiceNumber}</span>
          <span class="recent-inv-total">AED ${inv.grandTotal.toFixed(2)}</span>
        </div>
        <div class="recent-inv-bottom">
          <span class="recent-inv-customer">${inv.customer || 'Walk-in'}</span>
          <span class="recent-inv-method">${inv.payment}</span>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error('❌ Recent invoices error:', err);
    container.innerHTML = '<div class="sidebar-empty" style="color:#F43F5E">Load error</div>';
  }
}

// ─── Save & Print ─────────────────────────────────────────────

async function saveNewInvoice() {
  const data = collectInvoiceData();
  if (!data) return;

  const btn = document.getElementById('printBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    await saveInvoice(data);
    showToast('✅ Invoice saved!', 'success');
    setTimeout(() => window.print(), 300);
  } catch (err) {
    console.error('❌ Save error:', err);
    showToast('⚠️ Save error — printing anyway (offline mode).', 'warning');
    setTimeout(() => window.print(), 300);
  } finally {
    setTimeout(async () => {
      await loadDashboardData();
      await loadRecentInvoicesPanel();
      await loadNextInvoiceNumber();
      resetInvoiceForm();
      if (btn) { btn.disabled = false; btn.textContent = '🖨️ Save & Print Invoice'; }
    }, PERF.PRINT_RESTORE_DELAY);
  }
}

function collectInvoiceData() {
  const invoiceNumber = document.getElementById('invNum')?.textContent.trim();
  const dateInput     = document.getElementById('invDate')?.value;
  if (!dateInput) { showToast('Please select invoice date.', 'error'); return null; }

  const date         = formatDate(new Date(dateInput), 'YYYY-MM-DD');
  const customerName = document.getElementById('custName')?.value.trim() || 'Walk-in Customer';
  const customerPhone= document.getElementById('custPhone')?.value.trim() || '';
  const customerTRN  = document.getElementById('custTRN')?.value.trim()   || '';

  if (!currentPaymentMethod) { showToast('Please select a payment method.', 'error'); return null; }

  const subtotal  = parseFloat(document.getElementById('subTotal')?.textContent)   || 0;
  const vat       = parseFloat(document.getElementById('vatAmount')?.textContent)   || 0;
  const grandTotal= parseFloat(document.getElementById('grandTotal')?.textContent)  || 0;

  if (grandTotal <= 0) { showToast('Invoice total must be greater than zero.', 'error'); return null; }

  const items = [];
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const model = document.getElementById(`model${i}`)?.value.trim();
    const desc  = document.getElementById(`description${i}`)?.value.trim() || '';
    const qty   = parseInt(document.getElementById(`quantity${i}`)?.value)  || 0;
    const price = parseFloat(document.getElementById(`price${i}`)?.value)   || 0;
    if (model && qty > 0 && price > 0) items.push({ model, description: desc, quantity: qty, price, amount: qty * price });
  }
  if (!items.length) { showToast('Please add at least one item.', 'error'); return null; }

  const impacts = {
    cash:   currentPaymentMethod === 'Cash'   ? grandTotal : 0,
    card:   currentPaymentMethod === 'Card'   ? grandTotal : 0,
    tabby:  currentPaymentMethod === 'Tabby'  ? grandTotal : 0,
    cheque: currentPaymentMethod === 'Cheque' ? grandTotal : 0,
  };

  return {
    invoiceNumber, date,
    customer: { name: customerName, phone: customerPhone, trn: customerTRN },
    payment:  { method: currentPaymentMethod, subtotal, vat, grandTotal },
    items,
    status: 'Paid',
    impacts,
  };
}

function resetInvoiceForm() {
  ['custName','custPhone','custTRN'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    ['model','description'].forEach(f => { const el = document.getElementById(`${f}${i}`); if (el) el.value = ''; });
    const q = document.getElementById(`quantity${i}`); if (q) q.value = '1';
    const p = document.getElementById(`price${i}`);    if (p) p.value = '';
    const a = document.getElementById(`amount${i}`);   if (a) a.textContent = '0.00';
    const row = document.querySelector(`tr[data-row-index="${i}"]`);
    if (row && i > 3) row.style.display = 'none';
  }

  currentPaymentMethod = null;
  document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
  calculateTotals();

  const d = document.getElementById('invDate');
  if (d) d.valueAsDate = new Date();
}

// ─── Reprint / Refund ────────────────────────────────────────

window.handleReprintInvoice = async function(invoiceId) {
  showToast('Loading invoice…', 'info');
  try {
    // Find in recent list or fetch by docId (load recent invoices gives id+number)
    const invoices = await loadRecentInvoices(365);
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) { showToast('Invoice not found.', 'error'); return; }

    const full = await getInvoiceByNumber(inv.invoiceNumber);
    if (!full) { showToast('Invoice data unavailable.', 'error'); return; }

    isReprintMode    = true;
    reprintInvoiceData = full;
    populateReprintForm(full);
    showToast(`Reprint: Invoice ${full.invoiceNumber}`, 'info', 2000);
  } catch (err) {
    console.error('❌ Reprint error:', err);
    showToast('Error loading invoice.', 'error');
  }
};

function populateReprintForm(inv) {
  if (inv.invoiceNumber) updateEl('invNum', inv.invoiceNumber);
  const d = document.getElementById('invDate');
  if (d && inv.date) d.value = inv.date;
  const custName = document.getElementById('custName');
  if (custName) custName.value = inv.customer?.name || '';
  const custPhone = document.getElementById('custPhone');
  if (custPhone) custPhone.value = inv.customer?.phone || '';
  const custTRN = document.getElementById('custTRN');
  if (custTRN) custTRN.value = inv.customer?.trn || '';

  // Fill items
  const body = document.getElementById('itemsBody');
  if (body && inv.items) {
    inv.items.forEach((item, idx) => {
      const i = idx + 1;
      const row = document.querySelector(`tr[data-row-index="${i}"]`);
      if (row) { row.style.display = ''; }
      const m = document.getElementById(`model${i}`);       if (m) m.value = item.model || '';
      const desc = document.getElementById(`description${i}`); if (desc) desc.value = item.description || '';
      const q = document.getElementById(`quantity${i}`);    if (q) q.value = item.quantity || 1;
      const p = document.getElementById(`price${i}`);       if (p) p.value = item.price || 0;
      const a = document.getElementById(`amount${i}`);      if (a) a.textContent = (item.amount || 0).toFixed(2);
    });
  }
  calculateTotals();

  const btn = document.getElementById('printBtn');
  if (btn) { btn.disabled = false; btn.textContent = '🖨️ Reprint Invoice'; }
}

// ─── Deposits ────────────────────────────────────────────────

window.openDepositModal = function() {
  const modal = document.getElementById('depositModal');
  if (modal) modal.classList.add('show');
  ['depositName','depositAmount','depositBank','depositRef'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; if (i === 0) setTimeout(() => el.focus(), 100); }
  });
};

window.closeDepositModal = function() {
  document.getElementById('depositModal')?.classList.remove('show');
};

window.submitDeposit = async function() {
  const name   = document.getElementById('depositName')?.value.trim();
  const amount = parseFloat(document.getElementById('depositAmount')?.value);
  const bank   = document.getElementById('depositBank')?.value.trim();
  const slip   = document.getElementById('depositRef')?.value.trim();

  if (!name)             { showToast('Enter depositor name.', 'error');  document.getElementById('depositName')?.focus();   return; }
  if (!amount || amount <= 0) { showToast('Enter a valid amount.', 'error'); document.getElementById('depositAmount')?.focus(); return; }
  if (!bank)             { showToast('Enter bank name.', 'error');        document.getElementById('depositBank')?.focus();   return; }
  if (!slip)             { showToast('Enter slip number.', 'error');      document.getElementById('depositRef')?.focus();    return; }

  try {
    const depositId = await getNextDepositId();
    await saveDeposit({ depositId, amount, bank, slipNumber: slip, depositor: name });
    showToast(`✅ Deposit AED ${amount.toFixed(2)} saved.`, 'success');
    closeDepositModal();
    await loadDashboardData();
  } catch (err) {
    console.error('❌ Deposit error:', err);
    showToast('Failed to save deposit.', 'error');
  }
};

// ─── Expenses ────────────────────────────────────────────────

window.openExpenseModal = function() {
  const modal = document.getElementById('expenseModal');
  if (modal) modal.classList.add('show');
  ['expenseCategory','expenseDesc','expenseAmount','expenseReceipt'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; if (i === 0) setTimeout(() => el.focus(), 100); }
  });
};

window.closeExpenseModal = function() {
  document.getElementById('expenseModal')?.classList.remove('show');
};

window.submitExpense = async function() {
  const category = document.getElementById('expenseCategory')?.value;
  const desc     = document.getElementById('expenseDesc')?.value.trim();
  const amount   = parseFloat(document.getElementById('expenseAmount')?.value);
  const receipt  = document.getElementById('expenseReceipt')?.value.trim();

  if (!category) { showToast('Select a category.', 'error');        document.getElementById('expenseCategory')?.focus(); return; }
  if (!desc)     { showToast('Enter a description.', 'error');      document.getElementById('expenseDesc')?.focus();     return; }
  if (!amount || amount <= 0) { showToast('Enter a valid amount.', 'error'); document.getElementById('expenseAmount')?.focus(); return; }
  if (!receipt)  { showToast('Enter a receipt number.', 'error');   document.getElementById('expenseReceipt')?.focus();  return; }

  try {
    const expenseId = await getNextExpenseId();
    await saveExpense({ expenseId, category, description: desc, amount, receiptNumber: receipt });
    showToast(`✅ Expense AED ${amount.toFixed(2)} saved.`, 'success');
    closeExpenseModal();
    await loadDashboardData();
  } catch (err) {
    console.error('❌ Expense error:', err);
    showToast('Failed to save expense.', 'error');
  }
};

// ─── Daily Report ─────────────────────────────────────────────

window.printDailyReport = async function() {
  try {
    showToast('Generating daily report…', 'info');
    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(), getTodayDeposits(), getTodayExpenses(),
    ]);

    let cash = 0, card = 0, tabby = 0, cheque = 0, refunds = 0;
    invoices.forEach(inv => {
      if (inv.status === 'Refunded') { refunds++; return; }
      cash   += inv.impacts?.cash   || 0;
      card   += inv.impacts?.card   || 0;
      tabby  += inv.impacts?.tabby  || 0;
      cheque += inv.impacts?.cheque || 0;
    });
    const totalSales    = cash + card + tabby + cheque;
    const totalDeposits = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const cashInHand    = cash - totalDeposits - totalExpenses;
    const reportDate    = formatDate(new Date(), 'DD-MMM-YYYY');

    const container = document.getElementById('dailyReportContainer');
    container.innerHTML = `
      <div style="font-family:Arial;font-size:13px;max-width:320px;margin:0 auto;">
        <div style="text-align:center;font-weight:bold;font-size:16px;">AKM Music Centre</div>
        <div style="text-align:center;font-size:13px;margin-bottom:6px;">Daily Report — ${reportDate}</div>
        <hr>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:3px 0;font-weight:bold;">Total Sales</td>  <td style="text-align:right;font-weight:bold;">AED ${totalSales.toFixed(2)}</td></tr>
          <tr><td style="padding:3px 0;">— Cash</td>   <td style="text-align:right;">AED ${cash.toFixed(2)}</td></tr>
          <tr><td style="padding:3px 0;">— Card</td>   <td style="text-align:right;">AED ${card.toFixed(2)}</td></tr>
          <tr><td style="padding:3px 0;">— Tabby</td>  <td style="text-align:right;">AED ${tabby.toFixed(2)}</td></tr>
          <tr><td style="padding:3px 0;">— Cheque</td> <td style="text-align:right;">AED ${cheque.toFixed(2)}</td></tr>
        </table>
        <hr>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:3px 0;">Bank Deposits</td><td style="text-align:right;">AED ${totalDeposits.toFixed(2)}</td></tr>
          <tr><td style="padding:3px 0;">Expenses</td>     <td style="text-align:right;">AED ${totalExpenses.toFixed(2)}</td></tr>
          <tr><td style="padding:3px 0;font-weight:bold;">Cash in Hand</td><td style="text-align:right;font-weight:bold;">AED ${cashInHand.toFixed(2)}</td></tr>
          <tr><td style="padding:3px 0;">Refunds</td>      <td style="text-align:right;">${refunds}</td></tr>
        </table>
      </div>`;

    document.body.classList.add('printing-daily-report');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-daily-report'), 600);
  } catch (err) {
    console.error('❌ Daily report error:', err);
    showToast('Failed to generate report.', 'error');
  }
};

// ─── Auto-Refresh ─────────────────────────────────────────────

function setupAutoRefresh() {
  setInterval(async () => {
    try {
      await loadDashboardData();
      await loadRecentInvoicesPanel();
    } catch (err) { console.error('Auto-refresh error:', err); }
  }, PERF.AUTO_REFRESH_INTERVAL);   // uses correct 10000ms value
}

// ─── Window Exports ──────────────────────────────────────────

window.clearForm = function() {
  if (confirm('Clear the form?')) {
    isReprintMode = false;
    reprintInvoiceData = null;
    loadNextInvoiceNumber();
    resetInvoiceForm();
    showToast('Form cleared.', 'info');
  }
};

window.saveAndPrint = function() {
  if (isReprintMode) {
    window.print();
  } else {
    saveNewInvoice();
  }
};

window.selectPayment = function(button, method) {
  currentPaymentMethod = method;
  document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  debugLog('💳 Payment:', method);
};

// Fixed: show hidden rows instead of just focusing empty ones
window.addItemRow = function() {
  revealNextItemRow();
};

window.scrollToTop = function() {
  document.querySelector('.sidebar')?.scrollTo({ top: 0, behavior: 'smooth' });
};

// ─── Keyboard Navigation ──────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;

    // Deposit modal Enter navigation
    if (active.closest('#depositModal') && e.key === 'Enter') {
      e.preventDefault();
      const seq = ['depositName','depositAmount','depositBank','depositRef'];
      const idx = seq.indexOf(active.id);
      if (idx < seq.length - 1) document.getElementById(seq[idx + 1])?.focus();
      else window.submitDeposit();
      return;
    }

    // Expense modal Enter navigation (skip textarea — Enter should insert newlines there)
    if (active.closest('#expenseModal') && e.key === 'Enter' && active.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const seq = ['expenseCategory','expenseDesc','expenseAmount','expenseReceipt'];
      const idx = seq.indexOf(active.id);
      if (idx < seq.length - 1) document.getElementById(seq[idx + 1])?.focus();
      else window.submitExpense();
      return;
    }

    // Payment button arrow keys
    if (active.classList.contains('payment-btn')) {
      if (e.key === 'Enter')       { e.preventDefault(); active.click(); document.getElementById('printBtn')?.focus(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const btns = Array.from(document.querySelectorAll('.payment-btn'));
        const cur  = btns.indexOf(active);
        const next = e.key === 'ArrowRight' ? (cur + 1) % btns.length : (cur - 1 + btns.length) % btns.length;
        btns[next].focus();
        return;
      }
    }

    // Print button Enter
    if (active.id === 'printBtn' && e.key === 'Enter') {
      e.preventDefault(); window.saveAndPrint(); return;
    }

    // Invoice meta Enter
    if (active.closest('.invoice-meta') && e.key === 'Enter') {
      e.preventDefault();
      const seq = ['invDate','custName','custPhone','custTRN'];
      const idx = seq.indexOf(active.id);
      if (idx < seq.length - 1) document.getElementById(seq[idx + 1])?.focus();
      else document.getElementById('model1')?.focus();
      return;
    }
  });
}

// ─── Modal Click-outside Close ───────────────────────────────

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    window.closeDepositModal?.();
    window.closeExpenseModal?.();
  }
});

// ─── DOMContentLoaded ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const invDate = document.getElementById('invDate');
  if (invDate) invDate.valueAsDate = new Date();

  document.getElementById('googleSignInBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  setupKeyboard();
});

// ─── Auth State ───────────────────────────────────────────────

onAuthStateChanged(auth, (user) => {
  if (user && user.email === ALLOWED_EMAIL) {
    currentUser = user;
    showMainApp();
  } else {
    currentUser = null;
    showLoginScreen();
  }
});

window.signInWithGoogle = signInWithGoogle;
window.logout           = logout;

// Expose Firestore utils for repair module
window.firestoreUtils = { saveDeposit, saveExpense, saveInvoice, formatDate, formatTime };

debugLog('✅ app-firestore.js v3.0 loaded');
