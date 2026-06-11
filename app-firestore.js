// AKM-POS v4.0 — Main POS Application
// Redesign: no sidebar, header-actions, history modal, full enter-nav, all bugs fixed.

import {
  auth, provider,
  signInWithPopup, onAuthStateChanged, signOut
} from './firebase-config.js';

import {
  getNextInvoiceNumber,
  peekNextInvoiceNumber,
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
import { correctMusicalText } from './instrument-terms.js';
import { initSyncStatus, notePendingWrite } from './sync-status.js';

// Auto-capitalise / spell-correct known instrument & brand words when leaving a
// Model or Description field (local dictionary — no AI, instant, offline).
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (el && el.classList?.contains('item-input') &&
      (el.id?.startsWith('model') || el.id?.startsWith('description'))) {
    const fixed = correctMusicalText(el.value);
    if (fixed !== el.value) el.value = fixed;
  }
});

const ALLOWED_EMAIL = APP_CONFIG.ALLOWED_EMAIL;
const VALIDATION    = APP_CONFIG.VALIDATION;
const BUSINESS      = APP_CONFIG.BUSINESS;
const PERF          = APP_CONFIG.PERFORMANCE;

function updateEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── Global State ─────────────────────────────────────────────
let currentUser          = null;
let currentPaymentMethod = null;
let isReprintMode        = false;
let reprintInvoiceData   = null;
let originalInputStates  = [];

// ─── Print Helpers ─────────────────────────────────────────────

function preparePrintLayout() {
  if (originalInputStates.length > 0) return;
  const container = document.querySelector('.invoice-card');
  if (!container) return;

  // Hide empty phone / TRN meta fields from print
  ['custPhone', 'custTRN'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value.trim()) {
      const field = el.closest('.meta-field');
      if (field) { field.style.display = 'none'; field.dataset.hiddenForPrint = '1'; }
    }
  });

  // Hide rows where description is empty and price is 0
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const row  = document.querySelector(`tr[data-row-index="${i}"]`);
    const desc = document.getElementById(`description${i}`);
    const price= document.getElementById(`price${i}`);
    if (row && desc && !desc.value.trim() && (!price || !parseFloat(price.value))) {
      row.style.display = 'none';
      row.dataset.hiddenForPrint = '1';
    }
  }

  container.querySelectorAll('input, select, .amount-cell').forEach(el => {
    originalInputStates.push({ element: el, display: el.style.display });
    const span = document.createElement('span');
    span.className = 'print-text-replacement';
    span.textContent = el.classList.contains('amount-cell')
      ? (el.textContent || '')
      : (el.value || '');
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

  // Restore hidden meta fields (phone / TRN)
  document.querySelectorAll('.meta-field[data-hidden-for-print]').forEach(f => {
    f.style.display = '';
    delete f.dataset.hiddenForPrint;
  });

  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const row = document.querySelector(`tr[data-row-index="${i}"]`);
    if (row && row.dataset.hiddenForPrint) {
      if (i > 3) {
        const desc = document.getElementById(`description${i}`);
        row.style.display = desc?.value.trim() ? '' : 'none';
      } else {
        row.style.display = '';
      }
      delete row.dataset.hiddenForPrint;
    }
  }
}

window.addEventListener('beforeprint', preparePrintLayout);
window.addEventListener('afterprint', () => {
  restorePrintLayout();
  // After reprinting a saved invoice, clear back to a fresh new invoice.
  if (isReprintMode) resetToNewInvoice();
});

// Empty the form and return to a fresh invoice (current date + next number preview)
function resetToNewInvoice() {
  isReprintMode      = false;
  reprintInvoiceData = null;
  resetInvoiceForm();
  loadNextInvoiceNumber();
}

// ─── Daily Report (80mm thermal) ───────────────────────────────
window.printDailyReport = async function() {
  try {
    showToast('Generating daily report…', 'info');
    const today = new Date();
    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(),
      getTodayDeposits(),
      getTodayExpenses()
    ]);

    let totalSales = 0, totalVAT = 0, paidInvoices = 0;
    let cash = 0, card = 0, tabby = 0, cheque = 0;
    invoices.forEach(inv => {
      if (inv.status === 'Paid') {
        totalSales += inv.payment?.grandTotal || 0;
        totalVAT   += inv.payment?.vat        || 0;
        cash       += inv.impacts?.cash       || 0;
        card       += inv.impacts?.card       || 0;
        tabby      += inv.impacts?.tabby      || 0;
        cheque     += inv.impacts?.cheque     || 0;
        paidInvoices++;
      }
    });
    const totalDeposits = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const cashInHand    = cash - totalDeposits - totalExpenses;

    const money = (n) => 'AED ' + (Number(n) || 0).toFixed(2);
    const pw = window.open('', '_blank', 'width=420,height=720');
    pw.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Daily Report — ${formatDate(today,'DD MMM YYYY')}</title>
      <style>
        @page { size: 80mm auto; margin: 3mm 4mm; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Montserrat',Arial,sans-serif; color:#000; background:#fff;
               width:72mm; margin:0 auto; padding:6px 0; font-size:10px; line-height:1.45; }
        .head { text-align:center; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:6px; }
        .head h1 { font-size:15px; font-weight:900; letter-spacing:1px; }
        .head .sub { font-size:10px; font-weight:700; }
        .head .date { font-size:10px; }
        .sec { margin-bottom:8px; }
        .sec-t { font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.5px;
                 border-bottom:1px dashed #000; padding-bottom:2px; margin-bottom:4px; }
        .row { display:flex; justify-content:space-between; gap:8px; padding:1px 0; }
        .row b { font-weight:800; }
        .row.total { border-top:1px solid #000; margin-top:3px; padding-top:3px;
                     font-weight:900; font-size:11px; }
        .li { padding:3px 0; border-bottom:1px dotted #999; }
        .li-top { display:flex; justify-content:space-between; gap:6px; font-weight:700; }
        .li-sub { font-size:9px; color:#333; }
        .foot { text-align:center; border-top:1px dashed #000; margin-top:8px; padding-top:5px; font-size:9px; }
        .no-print { text-align:center; margin-top:14px; }
        .no-print button { padding:8px 14px; border:none; border-radius:6px; font-size:12px;
                font-weight:700; cursor:pointer; font-family:inherit; }
        @media print { .no-print { display:none; } body { width:auto; padding:0; } }
      </style>
    </head><body>
      <div class="head">
        <h1>AKM MUSIC</h1>
        <div class="sub">Daily Report</div>
        <div class="date">${formatDate(today,'DD MMM YYYY')}</div>
      </div>

      <div class="sec">
        <div class="sec-t">Sales Summary</div>
        <div class="row"><span>Total Sales (incl VAT)</span><b>${money(totalSales)}</b></div>
        <div class="row"><span>VAT (5%)</span><span>${money(totalVAT)}</span></div>
        <div class="row"><span>Net Sales (excl VAT)</span><span>${money(totalSales-totalVAT)}</span></div>
        <div class="row"><span>Paid Invoices</span><b>${paidInvoices}</b></div>
      </div>

      <div class="sec">
        <div class="sec-t">Payment Breakdown</div>
        <div class="row"><span>Cash</span><span>${money(cash)}</span></div>
        <div class="row"><span>Card</span><span>${money(card)}</span></div>
        <div class="row"><span>Tabby</span><span>${money(tabby)}</span></div>
        <div class="row"><span>Cheque</span><span>${money(cheque)}</span></div>
      </div>

      <div class="sec">
        <div class="sec-t">Cash Flow</div>
        <div class="row"><span>Cash Sales</span><span>${money(cash)}</span></div>
        <div class="row"><span>− Bank Deposits</span><span>${money(totalDeposits)}</span></div>
        <div class="row"><span>− Expenses</span><span>${money(totalExpenses)}</span></div>
        <div class="row total"><span>Cash in Hand</span><span>${money(cashInHand)}</span></div>
      </div>

      ${deposits.length ? `<div class="sec"><div class="sec-t">Bank Deposits (${deposits.length})</div>
        ${deposits.map(d=>`<div class="li"><div class="li-top"><span>${d.depositId||''} · ${d.depositor||''}</span><span>${money(d.amount)}</span></div><div class="li-sub">${d.bank||''}${d.slipNumber?` · Slip ${d.slipNumber}`:''}</div></div>`).join('')}
        <div class="row total"><span>Total Deposits</span><span>${money(totalDeposits)}</span></div></div>` : ''}

      ${expenses.length ? `<div class="sec"><div class="sec-t">Expenses (${expenses.length})</div>
        ${expenses.map(e=>`<div class="li"><div class="li-top"><span>${e.expenseId||''}</span><span>${money(e.amount)}</span></div><div class="li-sub">${e.description||''}${e.receiptNumber?` · Rcpt ${e.receiptNumber}`:''}</div></div>`).join('')}
        <div class="row total"><span>Total Expenses</span><span>${money(totalExpenses)}</span></div></div>` : ''}

      <div class="foot">
        Generated ${formatDate(new Date(),'DD MMM YYYY')} ${formatTime(new Date())}<br>
        AKM Music Centre LLC
      </div>

      <div class="no-print">
        <button onclick="window.print()" style="background:#0ea5e9;color:#fff;">🖨️ Print</button>
        <button onclick="window.close()" style="background:#e5e7eb;color:#374151;margin-left:8px;">✖ Close</button>
      </div>
    </body></html>`);
    pw.document.close();
    showToast('Daily report generated', 'success');
  } catch (err) {
    console.error('❌ Daily report error:', err);
    showToast('Failed to generate daily report', 'error');
  }
};

// ─── Error Handlers ────────────────────────────────────────────

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  if (e.reason?.message?.includes('Failed to fetch')) {
    showToast('⚠️ Network issue. Check your connection.', 'error');
  }
  e.preventDefault();
});

// ─── Auth ──────────────────────────────────────────────────────

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

// ─── Initialization ────────────────────────────────────────────

async function initializePOS() {
  debugLog('🚀 Initializing AKM-POS v4.0');
  const screen = document.getElementById('loadingScreen');
  if (screen) screen.style.display = 'flex';

  try {
    initSyncStatus();
    initializeItemsTable();
    setLoadingText('Loading invoice number…');
    await loadNextInvoiceNumber();

    setLoadingText('Loading today\'s stats…');
    await loadDashboardData();

    setupAutoRefresh();
    showToast('✅ POS ready!', 'success');
  } catch (err) {
    console.error('Init error:', err);
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

// ─── Items Table ────────────────────────────────────────────────

function initializeItemsTable() {
  const body = document.getElementById('itemsBody');
  if (!body) return;

  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const row = document.createElement('tr');
    row.setAttribute('data-row-index', i);
    row.innerHTML = `
      <td><input type="text"   id="model${i}"       class="item-input" placeholder="Model"       autocomplete="off"></td>
      <td><input type="text"   id="description${i}" class="item-input" placeholder="Description" autocomplete="off"></td>
      <td><input type="number" id="quantity${i}"     class="item-input" min="1" value="1"         autocomplete="off" style="text-align:right"></td>
      <td><input type="number" id="price${i}"        class="item-input" min="0" step="0.01" placeholder="0.00" autocomplete="off" style="text-align:right"></td>
      <td class="amount-cell"  id="amount${i}"></td>`;

    if (i > 3) row.style.display = 'none';
    body.appendChild(row);

    const modelEl = document.getElementById(`model${i}`);
    const descEl  = document.getElementById(`description${i}`);
    const qtyEl   = document.getElementById(`quantity${i}`);
    const priceEl = document.getElementById(`price${i}`);
    const amountEl= document.getElementById(`amount${i}`);

    // Recalculate on input
    const recalc = () => {
      const amt = (parseFloat(qtyEl.value) || 0) * (parseFloat(priceEl.value) || 0);
      amountEl.textContent = amt > 0 ? amt.toFixed(2) : '';
      calculateTotals();
    };
    qtyEl.addEventListener('input',  recalc);
    priceEl.addEventListener('input', recalc);

    // ── Enter navigation within each row ──
    // model → description
    modelEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      descEl?.focus();
    });

    // description → qty
    descEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      qtyEl?.focus();
    });

    // qty → price
    qtyEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      priceEl?.focus();
    });

    // price → next row model (reveal if hidden) OR payment if last
    priceEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i < VALIDATION.MAX_ITEMS_PER_INVOICE) {
        const nextRow = document.querySelector(`tr[data-row-index="${i + 1}"]`);
        if (nextRow && nextRow.style.display === 'none') nextRow.style.display = '';
        document.getElementById(`model${i + 1}`)?.focus();
      } else {
        // Last row → jump to first payment button
        document.querySelector('.payment-btn.cash')?.focus();
      }
    });
  }
  debugLog('✅ Items table ready (3 visible / 10 total)');
}

function calculateTotals() {
  let subtotal = 0;
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const txt = document.getElementById(`amount${i}`)?.textContent?.trim() || '0';
    subtotal += parseFloat(txt) || 0;
  }
  const vat   = parseFloat((subtotal * BUSINESS.VAT_RATE).toFixed(2));
  const grand = parseFloat((subtotal + vat).toFixed(2));

  updateEl('subTotal',   subtotal.toFixed(2));
  updateEl('vatAmount',  vat.toFixed(2));
  updateEl('grandTotal', grand.toFixed(2));
}

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

// ─── Invoice Number ─────────────────────────────────────────────

async function loadNextInvoiceNumber() {
  try {
    // Peek only — refreshing the page must NOT consume an invoice number.
    const num = await peekNextInvoiceNumber();
    updateEl('invNum', num);
    if (!isReprintMode) setNewInvoiceUI();
    debugLog('✅ Next invoice (preview):', num);
  } catch (err) {
    console.error('Invoice number error:', err);
    const yy = String(new Date().getFullYear()).slice(-2);
    updateEl('invNum', `${yy}-${BUSINESS.STARTING_INVOICE_NUMBER}`);
  }
}

// ─── Dashboard Stats (header chips) ────────────────────────────

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

    updateEl('todaySalesQuick', totalSales.toFixed(2));
    updateEl('cashInHandQuick', cashInHand.toFixed(2));
  } catch (err) {
    console.error('Dashboard error:', err);
    updateEl('todaySalesQuick', '0.00');
    updateEl('cashInHandQuick', '0.00');
  }
}

// ─── Save & Print ───────────────────────────────────────────────

async function saveNewInvoice() {
  const data = collectInvoiceData();
  if (!data) return;

  const btn = document.getElementById('printBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    // Commit the real sequential number NOW (only on a valid save). Page loads
    // only peek, so refreshing never burns a number — it's consumed here.
    const committed = await getNextInvoiceNumber();
    data.invoiceNumber = committed;
    updateEl('invNum', committed);

    await saveInvoice(data);
    notePendingWrite();
    showToast('✅ Invoice saved!', 'success');
    setTimeout(() => { preparePrintLayout(); window.print(); }, 300);
  } catch (err) {
    console.error('Save error:', err);
    showToast('⚠️ Save error — printing anyway (offline mode).', 'warning');
    setTimeout(() => { preparePrintLayout(); window.print(); }, 300);
  } finally {
    setTimeout(async () => {
      await loadDashboardData();
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

  const date          = formatDate(new Date(dateInput), 'YYYY-MM-DD');
  const customerName  = document.getElementById('custName')?.value.trim() || 'Walk-in Customer';
  const customerPhone = document.getElementById('custPhone')?.value.trim() || '';
  const customerTRN   = document.getElementById('custTRN')?.value.trim()   || '';

  if (!currentPaymentMethod) { showToast('Please select a payment method.', 'error'); return null; }

  const subtotal  = parseFloat(document.getElementById('subTotal')?.textContent)  || 0;
  const vat       = parseFloat(document.getElementById('vatAmount')?.textContent)  || 0;
  const grandTotal= parseFloat(document.getElementById('grandTotal')?.textContent) || 0;

  if (grandTotal <= 0) { showToast('Invoice total must be greater than zero.', 'error'); return null; }

  const items = [];
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    const model = document.getElementById(`model${i}`)?.value.trim() || '';
    const desc  = document.getElementById(`description${i}`)?.value.trim() || '';
    const qty   = parseInt(document.getElementById(`quantity${i}`)?.value)  || 0;
    const price = parseFloat(document.getElementById(`price${i}`)?.value)   || 0;
    if (desc && qty > 0 && price > 0) items.push({ model, description: desc, quantity: qty, price, amount: qty * price });
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

// ─── Reprint / Refund ──────────────────────────────────────────

window.handleReprintInvoice = async function(invoiceId) {
  showToast('Loading invoice…', 'info');
  try {
    const invoices = await loadRecentInvoices(365);
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) { showToast('Invoice not found.', 'error'); return; }

    const full = await getInvoiceByNumber(inv.invoiceNumber);
    if (!full) { showToast('Invoice data unavailable.', 'error'); return; }

    isReprintMode      = true;
    reprintInvoiceData = full;
    populateReprintForm(full);
    showToast(`Reprint: Invoice ${full.invoiceNumber}`, 'info', 2000);
  } catch (err) {
    console.error('Reprint error:', err);
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

  const body = document.getElementById('itemsBody');
  if (body && inv.items) {
    inv.items.forEach((item, idx) => {
      const i = idx + 1;
      const row = document.querySelector(`tr[data-row-index="${i}"]`);
      if (row) row.style.display = '';
      const m    = document.getElementById(`model${i}`);       if (m) m.value = item.model || '';
      const desc = document.getElementById(`description${i}`); if (desc) desc.value = item.description || '';
      const q    = document.getElementById(`quantity${i}`);    if (q) q.value = item.quantity || 1;
      const p    = document.getElementById(`price${i}`);       if (p) p.value = item.price || 0;
      const a    = document.getElementById(`amount${i}`);      if (a) a.textContent = item.amount > 0 ? item.amount.toFixed(2) : '';
    });
  }
  calculateTotals();
  setReprintUI(inv);
}

// Action buttons: "reprint/refund" mode (viewing a saved invoice from History)
function setReprintUI(inv) {
  const printBtn  = document.getElementById('printBtn');
  const refundBtn = document.getElementById('refundBtn');
  const clearBtn  = document.getElementById('clearBtn');
  if (printBtn) { printBtn.disabled = false; printBtn.textContent = '🖨️ Reprint'; }
  if (clearBtn) clearBtn.textContent = '🆕 New';
  if (refundBtn) {
    refundBtn.style.display = 'inline-flex';
    const refunded = inv.status === 'Refunded';
    refundBtn.disabled    = refunded;
    refundBtn.textContent = refunded ? '↩️ Refunded' : '↩️ Refund';
  }
}

// Action buttons: normal "new invoice" mode
function setNewInvoiceUI() {
  const printBtn  = document.getElementById('printBtn');
  const refundBtn = document.getElementById('refundBtn');
  const clearBtn  = document.getElementById('clearBtn');
  if (printBtn) { printBtn.disabled = false; printBtn.textContent = '🖨️ Save & Print Invoice'; }
  if (clearBtn) clearBtn.textContent = '🗑️ Reset';
  if (refundBtn) refundBtn.style.display = 'none';
}

window.handleRefund = async function() {
  if (!isReprintMode || !reprintInvoiceData) return;
  if (reprintInvoiceData.status === 'Refunded') { showToast('Invoice already refunded.', 'warning'); return; }
  if (!confirm(`Refund invoice ${reprintInvoiceData.invoiceNumber}? This reverses its cash/sales impact and cannot be undone.`)) return;

  const refundedNumber = reprintInvoiceData.invoiceNumber;
  const refundBtn = document.getElementById('refundBtn');
  if (refundBtn) { refundBtn.disabled = true; refundBtn.textContent = '⏳ Refunding…'; }
  try {
    await markInvoiceAsRefunded(reprintInvoiceData.id);
    notePendingWrite();
    showToast(`Invoice ${refundedNumber} refunded.`, 'success');
    await loadDashboardData();
    resetToNewInvoice();   // empty the form back to a fresh invoice
  } catch (err) {
    console.error('Refund error:', err);
    showToast('Failed to refund invoice.', 'error');
    if (refundBtn) { refundBtn.disabled = false; refundBtn.textContent = '↩️ Refund'; }
  }
};

// ─── History Modal ─────────────────────────────────────────────

window.openHistoryModal = async function() {
  const modal = document.getElementById('historyModal');
  if (modal) modal.classList.add('show');

  const container = document.getElementById('historyList');
  if (!container) return;
  container.innerHTML = '<div class="history-loading">Loading invoices…</div>';

  try {
    const invoices = await loadRecentInvoices(90);
    if (!invoices.length) {
      container.innerHTML = '<div class="history-empty">No invoices in the last 90 days.</div>';
      return;
    }
    // Serial order: newest invoice number first (invoices on the same day share a
    // midnight dateObj, so the DB can't order them — sort by number here).
    const seq = (n) => parseInt((n || '').split('-')[1], 10) || 0;
    invoices.sort((a, b) => seq(b.invoiceNumber) - seq(a.invoiceNumber));
    container.innerHTML = `
      <div class="history-grid">
        ${invoices.slice(0, 120).map(inv => `
          <div class="history-card ${inv.status === 'Refunded' ? 'refunded' : ''}"
               onclick="handleReprintInvoice('${inv.id}'); closeHistoryModal();">
            <div class="history-card-top">
              <span class="history-inv-num">${inv.invoiceNumber}</span>
              <span class="history-inv-total">AED ${(inv.grandTotal || 0).toFixed(2)}</span>
            </div>
            <div class="history-card-bottom">
              <span class="history-inv-customer">${inv.customer || 'Walk-in'}</span>
              <span class="history-inv-date">${inv.date || ''}</span>
            </div>
            <div class="history-card-footer">
              <span class="history-inv-method">${inv.payment || 'Cash'}</span>
              <span class="history-inv-status ${(inv.status || 'Paid').toLowerCase()}">${inv.status || 'Paid'}</span>
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch (err) {
    console.error('History error:', err);
    container.innerHTML = '<div style="color:#f43f5e;text-align:center;padding:20px;">Error loading invoices.</div>';
  }
};

window.closeHistoryModal = function() {
  document.getElementById('historyModal')?.classList.remove('show');
};

// ─── Deposits ──────────────────────────────────────────────────

window.openDepositModal = function() {
  const modal = document.getElementById('depositModal');
  if (modal) modal.classList.add('show');
  ['depositName','depositAmount','depositBank','depositRef'].forEach((id, i) => {
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
    notePendingWrite();
    showToast(`✅ Deposit AED ${amount.toFixed(2)} saved.`, 'success');
    closeDepositModal();
    await loadDashboardData();
  } catch (err) {
    console.error('Deposit error:', err);
    showToast('Failed to save deposit.', 'error');
  }
};

// ─── Expenses ──────────────────────────────────────────────────

window.openExpenseModal = function() {
  const modal = document.getElementById('expenseModal');
  if (modal) modal.classList.add('show');
  ['expenseDesc','expenseAmount','expenseReceipt'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; if (i === 0) setTimeout(() => el.focus(), 100); }
  });
};

window.closeExpenseModal = function() {
  document.getElementById('expenseModal')?.classList.remove('show');
};

window.submitExpense = async function() {
  const desc     = document.getElementById('expenseDesc')?.value.trim();
  const amount   = parseFloat(document.getElementById('expenseAmount')?.value);
  const receipt  = document.getElementById('expenseReceipt')?.value.trim();

  if (!desc)     { showToast('Enter a description.', 'error');     document.getElementById('expenseDesc')?.focus();     return; }
  if (!amount || amount <= 0) { showToast('Enter a valid amount.', 'error'); document.getElementById('expenseAmount')?.focus(); return; }
  if (!receipt)  { showToast('Enter a receipt number.', 'error');  document.getElementById('expenseReceipt')?.focus();  return; }

  try {
    const expenseId = await getNextExpenseId();
    await saveExpense({ expenseId, description: desc, amount, receiptNumber: receipt });
    notePendingWrite();
    showToast(`✅ Expense AED ${amount.toFixed(2)} saved.`, 'success');
    closeExpenseModal();
    await loadDashboardData();
  } catch (err) {
    console.error('Expense error:', err);
    showToast('Failed to save expense.', 'error');
  }
};

// ─── Auto-Refresh ───────────────────────────────────────────────

function setupAutoRefresh() {
  let failures = 0;
  setInterval(async () => {
    if (failures >= 3) return;
    try {
      await loadDashboardData();
      failures = 0;
    } catch (err) {
      failures++;
      if (failures === 1) console.error('Auto-refresh error:', err);
    }
  }, 30000);
}

// ─── Window Exports ─────────────────────────────────────────────

window.clearForm = function() {
  if (confirm('Clear the current invoice?')) {
    isReprintMode      = false;
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
  updateEl('printPaymentLine', `PAYMENT: ${method.toUpperCase()}`);
  debugLog('💳 Payment:', method);
};

window.addItemRow = function() {
  revealNextItemRow();
};

// ─── Keyboard Navigation ────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;

    // Deposit modal Enter chain
    if (active.closest('#depositModal') && e.key === 'Enter') {
      e.preventDefault();
      const seq = ['depositName','depositAmount','depositBank','depositRef'];
      const idx = seq.indexOf(active.id);
      if (idx >= 0 && idx < seq.length - 1) document.getElementById(seq[idx + 1])?.focus();
      else if (idx === seq.length - 1) window.submitDeposit();
      return;
    }

    // Expense modal Enter chain (skip textarea — newlines allowed there)
    if (active.closest('#expenseModal') && e.key === 'Enter' && active.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const seq = ['expenseDesc','expenseAmount','expenseReceipt'];
      const idx = seq.indexOf(active.id);
      if (idx >= 0 && idx < seq.length - 1) document.getElementById(seq[idx + 1])?.focus();
      else if (idx === seq.length - 1) window.submitExpense();
      return;
    }

    // Payment button keyboard navigation
    if (active.classList.contains('payment-btn')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        active.click();
        document.getElementById('printBtn')?.focus();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const btns = Array.from(document.querySelectorAll('.payment-btn'));
        const cur  = btns.indexOf(active);
        const next = e.key === 'ArrowRight'
          ? (cur + 1) % btns.length
          : (cur - 1 + btns.length) % btns.length;
        btns[next].focus();
        return;
      }
    }

    // Print button
    if (active.id === 'printBtn' && e.key === 'Enter') {
      e.preventDefault(); window.saveAndPrint(); return;
    }

    // Invoice meta: date → custName → custPhone → custTRN → model1
    if (active.closest('.invoice-meta') && e.key === 'Enter') {
      e.preventDefault();
      const seq = ['invDate','custName','custPhone','custTRN'];
      const idx = seq.indexOf(active.id);
      if (idx >= 0 && idx < seq.length - 1) document.getElementById(seq[idx + 1])?.focus();
      else document.getElementById('model1')?.focus();
      return;
    }

    // Escape closes any open modal
    if (e.key === 'Escape') {
      if (document.getElementById('depositModal')?.classList.contains('show')) { closeDepositModal(); return; }
      if (document.getElementById('expenseModal')?.classList.contains('show')) { closeExpenseModal(); return; }
      if (document.getElementById('historyModal')?.classList.contains('show')) { closeHistoryModal(); return; }
    }
  });
}

// ─── Modal click-outside close ─────────────────────────────────

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    window.closeDepositModal?.();
    window.closeExpenseModal?.();
    window.closeHistoryModal?.();
  }
});

// ─── DOMContentLoaded ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const invDate = document.getElementById('invDate');
  if (invDate) invDate.valueAsDate = new Date();

  document.getElementById('googleSignInBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  setupKeyboard();
});

// ─── Auth State ────────────────────────────────────────────────

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

debugLog('✅ app-firestore.js v4.0 loaded');
