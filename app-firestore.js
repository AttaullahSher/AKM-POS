// AKM-POS v4.0 — Main POS Application
// Redesign: no sidebar, header-actions, history modal, full enter-nav, all bugs fixed.

import {
  auth, db, provider,
  signInWithPopup, onAuthStateChanged, signOut,
  waitForPendingWrites
} from './firebase-config.js';

import {
  peekNextInvoiceNumber,
  getNextDepositId,
  getNextExpenseId,
  saveInvoice,
  saveDeposit,
  saveExpense,
  createCashIn,
  getTodayInvoices,
  getTodayDeposits,
  getTodayExpenses,
  getTodayCashIns,
  getAllTimeCashFlow,
  loadRecentInvoices,
  markInvoiceAsRefunded,
  getInvoiceById,
  getInvoiceByNumber,
  markInvoiceSuperseded,
  formatDate,
  formatTime,
} from './firestore-utils.js';

import { APP_CONFIG, debugLog } from './config.js';
import { showToast } from './utils.js';
import { correctMusicalText } from './instrument-terms.js';

// UAE timezone date helper — prevents UTC midnight giving "yesterday" in +4
function todayUAE() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
}

// ─── Offline Sync Tracking ──────────────────────────────────────────
let _pendingSyncCount = parseInt(localStorage.getItem('akm_pending') || '0', 10);

function updateSyncBadge() {
  const badge = document.getElementById('syncBadge');
  if (!badge) return;
  if (_pendingSyncCount > 0) {
    badge.textContent = _pendingSyncCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function trackOfflineSave() {
  if (navigator.onLine) return;
  _pendingSyncCount++;
  localStorage.setItem('akm_pending', _pendingSyncCount);
  updateSyncBadge();
}

window.addEventListener('online', async () => {
  // Always flush offline queue and refresh from server, even if our local counter
  // shows 0 pending — network may have dropped silently without us knowing.
  try { await waitForPendingWrites(db); } catch {}
  if (_pendingSyncCount) {
    const synced = _pendingSyncCount;
    _pendingSyncCount = 0;
    localStorage.removeItem('akm_pending');
    showToast(`✅ ${synced} transaction${synced !== 1 ? 's' : ''} synced to cloud`, 'success');
  } else {
    showToast('✅ Back online — syncing...', 'info');
  }
  updateSyncBadge();
  // Reload invoice number and dashboard so we pick up any writes from other devices
  loadNextInvoiceNumber().catch(() => {});
  loadDashboardData().catch(() => {});
});

window.addEventListener('offline', updateSyncBadge);

// Refresh cash-in-hand whenever the user returns to this tab (e.g. after deleting
// an invoice on the dashboard) so the header chip stays accurate.
// Also correct a stale date field — if the page was left open overnight the date
// field may still show yesterday. Only resets if the value is already in the past.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) {
    loadDashboardData().catch(() => {});
    if (!isReprintMode) {
      const invDate = document.getElementById('invDate');
      const today   = todayUAE();
      if (invDate && invDate.value < today) invDate.value = today;
    }
  }
});

// Warn before closing tab if there are writes still queued to sync.
// This catches the accidental-close scenario that causes missing invoices.
window.addEventListener('beforeunload', e => {
  if (_pendingSyncCount > 0) {
    e.preventDefault();
    return (e.returnValue = `${_pendingSyncCount} invoice(s) are still syncing. Closing now may lose data.`);
  }
});

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
let currentDepositType   = 'Cash';
let isReprintMode        = false;
let reprintInvoiceData   = null;
let needsPageRefresh     = false;
let originalInputStates  = [];
let _depositSaving       = false;
let _expenseSaving       = false;

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
    const [invoices, deposits, expenses, cashIns, allTime] = await Promise.all([
      getTodayInvoices(),
      getTodayDeposits(),
      getTodayExpenses(),
      getTodayCashIns(),
      getAllTimeCashFlow(),
    ]);

    let totalSales = 0, totalVAT = 0, paidInvoices = 0;
    let cash = 0, card = 0, tabby = 0, cheque = 0;
    invoices.forEach(inv => {
      if (inv.status === 'Paid' && !inv.deleted && !inv.superseded) {
        totalSales += inv.payment?.grandTotal || 0;
        totalVAT   += inv.payment?.vat        || 0;
        cash       += inv.impacts?.cash       || 0;
        card       += inv.impacts?.card       || 0;
        tabby      += inv.impacts?.tabby      || 0;
        cheque     += inv.impacts?.cheque     || 0;
        paidInvoices++;
      }
    });
    const activeCashIns     = cashIns.filter(c => !c.deleted);
    const totalCashIns      = activeCashIns.reduce((s, c) => s + (c.amount || 0), 0);
    const activeDeps        = deposits.filter(d => !d.deleted);
    const cashDeposits      = activeDeps.filter(d => (d.depositType || 'Cash') === 'Cash');
    const chequeDeposits    = activeDeps.filter(d => d.depositType === 'Cheque');
    const totalCashDeposits = cashDeposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalChequeDeps   = chequeDeposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalExpenses     = expenses.filter(e => !e.deleted).reduce((s, e) => s + (e.amount || 0), 0);
    const cashInHand        = cash + totalCashIns - totalCashDeposits - totalExpenses;

    const actualCashInHand  = allTime?.cashInHand ?? (cash + totalCashIns - totalCashDeposits - totalExpenses);
    const money = (n) => 'AED ' + (Number(n) || 0).toFixed(2);
    const pw = window.open('', '_blank', 'width=340,height=760');
    pw.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Daily Report — ${formatDate(today,'DD MMM YYYY')}</title>
      <style>
        /* 80 mm thermal paper — zero page margins, body handles spacing */
        @page { size: 80mm auto; margin: 0; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body {
          font-family:'Montserrat',Arial,sans-serif;
          color:#000; background:#fff;
          width:76mm;
          margin:2mm auto;
          padding:3mm;
          border:1px solid #000;
          font-size:12px;
          line-height:1.55;
        }
        .head { text-align:center; border-bottom:1.5px solid #000; padding-bottom:4px; margin-bottom:4px; }
        .head h1  { font-size:18px; font-weight:900; letter-spacing:1px; }
        .head .sub{ font-size:12px; font-weight:700; }
        .head .dt { font-size:12px; }
        .sec { margin-bottom:6px; }
        .sec-t {
          font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.5px;
          border-bottom:1px dashed #000; padding-bottom:2px; margin-bottom:3px;
        }
        .row {
          display:flex; justify-content:space-between;
          align-items:baseline; gap:3px; padding:1px 0;
        }
        .row .lbl { flex:1; }
        .row .val { white-space:nowrap; flex-shrink:0; font-weight:700; font-size:15px; }
        .row.total {
          border-top:1px solid #000; margin-top:3px; padding-top:3px;
          font-weight:900; font-size:15px;
        }
        .li { padding:2px 0; border-bottom:1px dotted #999; }
        .li-top { display:flex; justify-content:space-between; gap:3px; font-weight:700; }
        .li-top .val { white-space:nowrap; flex-shrink:0; font-size:15px; }
        .li-sub { font-size:8.5px; color:#444; margin-top:1px; }
        .foot {
          text-align:center; border-top:1px dashed #000;
          margin-top:6px; padding-top:4px; font-size:8.5px;
        }
        .no-print {
          display:flex; gap:8px; justify-content:center;
          margin-top:14px; padding-top:10px;
          border-top:1px solid #e5e7eb;
        }
        .no-print button {
          flex:1; padding:9px 10px; border:none; border-radius:6px;
          font-size:12px; font-weight:700; cursor:pointer; font-family:inherit;
          transition:opacity .15s;
        }
        .no-print button:hover { opacity:.85; }
        .no-print button:disabled { opacity:.5; cursor:not-allowed; }
        @media print { .no-print { display:none; } }
      </style>
    </head><body>
      <div class="head">
        <h1>AKM MUSIC</h1>
        <div class="sub">Daily Report</div>
        <div class="dt">${formatDate(today,'DD MMM YYYY')}</div>
      </div>

      <div class="sec">
        <div class="sec-t">Sales Summary</div>
        <div class="row"><span class="lbl">Total Sales (incl VAT)</span><span class="val">${money(totalSales)}</span></div>
        <div class="row"><span class="lbl">VAT (5%)</span><span class="val">${money(totalVAT)}</span></div>
        <div class="row"><span class="lbl">Net Sales (excl VAT)</span><span class="val">${money(totalSales-totalVAT)}</span></div>
        <div class="row"><span class="lbl">Paid Invoices</span><span class="val">${paidInvoices}</span></div>
      </div>

      <div class="sec">
        <div class="sec-t">Payment Breakdown</div>
        <div class="row"><span class="lbl">Cash</span><span class="val">${money(cash)}</span></div>
        <div class="row"><span class="lbl">Card</span><span class="val">${money(card)}</span></div>
        <div class="row"><span class="lbl">Tabby</span><span class="val">${money(tabby)}</span></div>
        <div class="row"><span class="lbl">Cheque</span><span class="val">${money(cheque)}</span></div>
      </div>

      <div class="sec">
        <div class="sec-t">Today's Cash Flow</div>
        <div class="row"><span class="lbl">Cash Sales</span><span class="val">${money(cash)}</span></div>
        ${totalCashIns > 0 ? `<div class="row"><span class="lbl">+ Cash In</span><span class="val">${money(totalCashIns)}</span></div>` : ''}
        ${totalCashDeposits > 0 ? `<div class="row"><span class="lbl">− Cash Deposits</span><span class="val">${money(totalCashDeposits)}</span></div>` : ''}
        ${totalExpenses > 0 ? `<div class="row"><span class="lbl">− Expenses</span><span class="val">${money(totalExpenses)}</span></div>` : ''}
        ${totalChequeDeps > 0 ? `<div class="row" style="font-size:10px;color:#555"><span class="lbl">Cheque Deposits (memo)</span><span class="val" style="font-size:12px">${money(totalChequeDeps)}</span></div>` : ''}
        <div class="row total" style="font-size:16px;border-top:2px solid #000;margin-top:5px;padding-top:4px;"><span class="lbl">Cash In Hand</span><span class="val">${money(actualCashInHand)}</span></div>
      </div>

      ${activeCashIns.length ? `<div class="sec"><div class="sec-t">Cash In (${activeCashIns.length})</div>
        ${activeCashIns.map(c=>`<div class="li">
          <div class="li-top"><span>${c.cashInId||''}</span><span class="val">${money(c.amount)}</span></div>
          ${c.reference ? `<div class="li-sub">${c.reference}</div>` : ''}
        </div>`).join('')}
        <div class="row total"><span class="lbl">Total Cash In</span><span class="val">${money(totalCashIns)}</span></div>
      </div>` : ''}

      ${activeDeps.length ? `<div class="sec"><div class="sec-t">Bank Deposits (${activeDeps.length})</div>
        ${activeDeps.map(d=>`<div class="li">
          <div class="li-top"><span>${d.depositId||''}${d.depositor ? ` · ${d.depositor}` : ''} ${d.depositType==='Cheque'?'[CHQ]':''}</span><span class="val">${money(d.amount)}</span></div>
          <div class="li-sub">${d.bank||''}${d.slipNumber?` · Slip ${d.slipNumber}`:''}</div>
        </div>`).join('')}
        <div class="row total"><span class="lbl">Cash Deps</span><span class="val">${money(totalCashDeposits)}</span></div>
        ${totalChequeDeps > 0 ? `<div class="row"><span class="lbl">Cheque Deps</span><span class="val">${money(totalChequeDeps)}</span></div>` : ''}
      </div>` : ''}

      ${(() => { const activeExp = expenses.filter(e=>!e.deleted); return activeExp.length ? `<div class="sec"><div class="sec-t">Expenses (${activeExp.length})</div>
        ${activeExp.map(e=>`<div class="li">
          <div class="li-top"><span>${e.expenseId||''}</span><span class="val">${money(e.amount)}</span></div>
          ${e.description ? `<div class="li-sub">${e.description}</div>` : ''}
        </div>`).join('')}
        <div class="row total"><span class="lbl">Total Expenses</span><span class="val">${money(totalExpenses)}</span></div>
      </div>` : ''; })()}

      <div class="foot">
        Generated ${formatDate(new Date(),'DD MMM YYYY')} ${formatTime(new Date())}<br>
        AKM Music Centre LLC
      </div>

      <div class="no-print">
        <button onclick="window.print()" style="background:#0ea5e9;color:#fff;">🖨️ Print</button>
        <button id="saveJpgBtn" onclick="saveJpg()" style="background:#10b981;color:#fff;">💾 Save JPG</button>
        <button onclick="window.close()" style="background:#e5e7eb;color:#374151;">✖ Close</button>
      </div>
    </body>
    <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
    <script>
    async function saveJpg() {
      if (typeof html2canvas === 'undefined') {
        alert('Image library still loading — please try again in a second.');
        return;
      }
      const btn      = document.getElementById('saveJpgBtn');
      const noPrint  = document.querySelector('.no-print');
      btn.textContent = '⏳ Saving…';
      btn.disabled    = true;
      noPrint.style.display = 'none';
      await new Promise(r => setTimeout(r, 80)); // let DOM repaint before capture
      try {
        const canvas = await html2canvas(document.body, {
          scale: 4,
          backgroundColor: '#ffffff',
          logging: false,
          useCORS: true,
          scrollX: 0,
          scrollY: 0,
          windowWidth:  document.body.scrollWidth,
          windowHeight: document.body.scrollHeight,
        });
        canvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href    = url;
          const d   = new Date().toLocaleDateString('en-GB').replace(/\\//g, '-');
          a.download = 'AKM-Daily-Report-' + d + '.jpg';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
        }, 'image/jpeg', 0.95);
      } catch (e) {
        alert('Save failed: ' + e.message);
      } finally {
        noPrint.style.display = '';
        btn.textContent = '💾 Save JPG';
        btn.disabled    = false;
      }
    }
    <\/script>
    </html>`);
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
  // Loading screen was already hidden by showMainApp() — don't re-show it.
  // Show a placeholder in the invoice number while Firestore responds.
  initializeItemsTable();
  updateEl('invNum', '…');

  try {
    await loadNextInvoiceNumber();
    await loadDashboardData();
    setupAutoRefresh();
    scheduleMidnightRefresh();

    // Handle ?reprint=<docId> deep-link from dashboard "View" button
    const params = new URLSearchParams(window.location.search);
    const reprintId = params.get('reprint');
    if (reprintId) {
      history.replaceState(null, '', window.location.pathname);
      await window.handleReprintInvoice(reprintId);
    }

    showToast('✅ POS ready!', 'success');
  } catch (err) {
    console.error('Init error:', err);
    showToast('⚠️ Partial load — offline mode active.', 'warning');
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
      <td><input type="number" id="quantity${i}"     class="item-input" min="1" placeholder="1"   autocomplete="off" style="text-align:right"></td>
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
    showToast('Could not load invoice number — estimate shown', 'warning');
  }
}

// ─── Dashboard Stats (header chips) ────────────────────────────

async function loadDashboardData() {
  if (!currentUser) return;
  try {
    const [invoices, allTime] = await Promise.all([
      getTodayInvoices(),
      getAllTimeCashFlow(),
    ]);

    let totalSales = 0;
    invoices.forEach(inv => {
      if (inv.status === 'Paid' && !inv.deleted && !inv.superseded) {
        totalSales += inv.payment?.grandTotal || 0;
      }
    });

    const cashInHand = allTime?.cashInHand ?? 0;
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

  let saved = false;
  try {
    // Counter increment + invoice write are ONE atomic Firestore transaction.
    // If anything fails both roll back — the counter is never burned without a document.
    const previewNum = document.getElementById('invNum')?.textContent.trim();
    const { invoiceNumber } = await saveInvoice(data);
    updateEl('invNum', invoiceNumber);
    trackOfflineSave();
    if (invoiceNumber !== previewNum) {
      showToast(`Invoice number updated: ${previewNum} → ${invoiceNumber}`, 'info');
    } else {
      showToast('✅ Invoice saved!', 'success');
    }
    saved = true;
    setTimeout(() => { preparePrintLayout(); window.print(); }, 300);
  } catch (err) {
    console.error('Save error:', err);
    // Do NOT print — printing an unsaved invoice creates a phantom record with no Firestore entry.
    showToast('❌ Could not save invoice. Check your connection and try again.', 'error');
  } finally {
    setTimeout(() => {
      if (saved) {
        loadDashboardData().catch(() => {});
        loadNextInvoiceNumber().catch(() => {});
        resetInvoiceForm();
      }
      if (btn) { btn.disabled = false; btn.textContent = '🖨️ Save & Print Invoice'; }
    }, saved ? PERF.PRINT_RESTORE_DELAY : 0);
  }
}

function collectInvoiceData() {
  const invoiceNumber = document.getElementById('invNum')?.textContent.trim();
  const dateInput     = document.getElementById('invDate')?.value;
  if (!dateInput) { showToast('Please select invoice date.', 'error'); return null; }

  const date  = formatDate(new Date(dateInput), 'YYYY-MM-DD');
  const today = todayUAE();
  if (date > today) { showToast('Future dates are not allowed.', 'error'); document.getElementById('invDate').value = today; return null; }
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
    const row    = document.querySelector(`tr[data-row-index="${i}"]`);
    if (row && row.style.display === 'none') continue; // skip hidden rows

    const model  = document.getElementById(`model${i}`)?.value.trim() || '';
    const desc   = document.getElementById(`description${i}`)?.value.trim() || '';
    const qtyEl  = document.getElementById(`quantity${i}`);
    let   qty    = parseInt(qtyEl?.value) || 0;
    const priceEl= document.getElementById(`price${i}`);
    const price  = parseFloat(priceEl?.value) || 0;

    // Check if any data was entered in this row
    const hasAnyData = desc || price > 0 || qty > 0 || model;
    if (!hasAnyData) continue;

    // Friendly validation for partial rows
    if (!desc) {
      showToast(`Row ${i}: Description is required.`, 'error');
      document.getElementById(`description${i}`)?.focus();
      return null;
    }
    if (price <= 0) {
      showToast(`Row ${i}: Price is required.`, 'error');
      priceEl?.focus();
      return null;
    }
    if (qty === 0) { qty = 1; if (qtyEl) qtyEl.value = '1'; }

    items.push({ model, description: desc, quantity: qty, price, amount: qty * price });
  }
  if (!items.length) { showToast('Please add at least one item with description and price.', 'error'); return null; }

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
    const q = document.getElementById(`quantity${i}`); if (q) q.value = '';
    const p = document.getElementById(`price${i}`);    if (p) p.value = '';
    const a = document.getElementById(`amount${i}`);   if (a) a.textContent = '';
    const row = document.querySelector(`tr[data-row-index="${i}"]`);
    if (row && i > 3) row.style.display = 'none';
  }

  currentPaymentMethod = null;
  document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
  calculateTotals();

  const d = document.getElementById('invDate');
  if (d) d.value = todayUAE();
}

// ─── Reprint / Refund ──────────────────────────────────────────

window.handleReprintInvoice = async function(invoiceId) {
  showToast('Loading invoice…', 'info');
  try {
    const full = await getInvoiceById(invoiceId);
    if (!full)         { showToast('Invoice not found.', 'error');    return; }
    if (full.deleted)  { showToast('That invoice has been deleted.', 'error'); return; }
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

  // Clear ALL item rows first so stale data from a previously-loaded invoice doesn't bleed through
  for (let i = 1; i <= VALIDATION.MAX_ITEMS_PER_INVOICE; i++) {
    ['model','description'].forEach(f => { const el = document.getElementById(`${f}${i}`); if (el) el.value = ''; });
    const q = document.getElementById(`quantity${i}`); if (q) q.value = '';
    const p = document.getElementById(`price${i}`);    if (p) p.value = '';
    const a = document.getElementById(`amount${i}`);   if (a) a.textContent = '';
    const row = document.querySelector(`tr[data-row-index="${i}"]`);
    if (row && i > 3) row.style.display = 'none';
  }

  if (inv.items) {
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

  // Restore payment method selection
  currentPaymentMethod = inv.payment?.method || null;
  document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
  if (currentPaymentMethod) {
    document.querySelector(`.payment-btn.${currentPaymentMethod.toLowerCase()}`)?.classList.add('active');
  }

  calculateTotals();
  setReprintUI(inv);
}

// Action buttons: "reprint/refund" mode (viewing a saved invoice from History)
function setReprintUI(inv) {
  const printBtn  = document.getElementById('printBtn');
  const refundBtn = document.getElementById('refundBtn');
  const jpgBtn    = document.getElementById('jpgBtn');
  const clearBtn  = document.getElementById('clearBtn');
  const card      = document.querySelector('.invoice-card');
  const banner    = document.getElementById('reprintBanner');

  if (clearBtn) clearBtn.textContent = '🆕 New';
  if (jpgBtn)   jpgBtn.style.display = 'inline-flex';

  if (inv.superseded) {
    if (printBtn) { printBtn.disabled = false; printBtn.textContent = '🖨️ Reprint'; }
    if (refundBtn) refundBtn.style.display = 'none';
    if (card)   card.classList.add('invoice-superseded');
    if (banner) {
      banner.className = 'reprint-banner reprint-banner--superseded';
      banner.textContent = `⚠️ This invoice was superseded by ${inv.supersededBy || 'a newer version'} — read-only`;
      banner.style.display = '';
    }
  } else {
    if (printBtn) { printBtn.disabled = false; printBtn.textContent = '📝 Save & Reprint'; }
    if (refundBtn) {
      refundBtn.style.display = 'inline-flex';
      const refunded = inv.status === 'Refunded';
      refundBtn.disabled    = refunded;
      refundBtn.textContent = refunded ? '↩️ Refunded' : '↩️ Refund';
    }
    if (card)   card.classList.remove('invoice-superseded');
    if (banner) {
      banner.className = 'reprint-banner reprint-banner--active';
      banner.textContent = `✏️ Editing ${inv.invoiceNumber} — changes will be saved as a new amended invoice`;
      banner.style.display = '';
    }
  }
}

// Action buttons: normal "new invoice" mode
function setNewInvoiceUI() {
  const printBtn  = document.getElementById('printBtn');
  const refundBtn = document.getElementById('refundBtn');
  const jpgBtn    = document.getElementById('jpgBtn');
  const clearBtn  = document.getElementById('clearBtn');
  const card      = document.querySelector('.invoice-card');
  const banner    = document.getElementById('reprintBanner');
  if (printBtn)  { printBtn.disabled = false; printBtn.textContent = '🖨️ Save & Print Invoice'; }
  if (clearBtn)  clearBtn.textContent = '🗑️ Reset';
  if (refundBtn) refundBtn.style.display = 'none';
  if (jpgBtn)    jpgBtn.style.display    = 'none';
  if (card)      card.classList.remove('invoice-superseded');
  if (banner)    banner.style.display = 'none';
}

window.saveInvoiceAsJpg = async function() {
  const container = document.querySelector('.invoice-card');
  if (!container) return;

  const btn = document.getElementById('jpgBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  preparePrintLayout();
  await new Promise(r => setTimeout(r, 100));

  try {
    if (typeof html2canvas === 'undefined') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load image library'));
        document.head.appendChild(s);
      });
    }
    const canvas = await html2canvas(container, {
      scale: 4,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    });
    canvas.toBlob(blob => {
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const num  = document.getElementById('invNum')?.textContent?.trim() || 'invoice';
      a.download = `AKM-Invoice-${num}.jpg`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    }, 'image/jpeg', 0.95);
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    restorePrintLayout();
    if (btn) { btn.disabled = false; btn.textContent = '📸 Save JPG'; }
  }
};

window.shareInvoiceWhatsApp = function() {
  const inv = reprintInvoiceData;
  if (!inv) return;
  const itemLines = (inv.items || []).map(it =>
    `  • ${it.quantity || 1}x ${it.description || '—'} — AED ${(it.amount || 0).toFixed(2)}`
  ).join('\n');
  const sub   = (inv.payment?.subtotal   || 0).toFixed(2);
  const vat   = (inv.payment?.vat        || 0).toFixed(2);
  const total = (inv.payment?.grandTotal || 0).toFixed(2);
  const customer = inv.customer?.name  || 'Valued Customer';
  const phone    = inv.customer?.phone ? ` | ${inv.customer.phone}` : '';
  const msg = [
    `*AKM Music Centre LLC*`,
    `Invoice: *${inv.invoiceNumber}*`,
    `Date: ${inv.date || ''}`,
    `Customer: ${customer}${phone}`,
    ``,
    `*Items:*`,
    itemLines,
    ``,
    `Subtotal : AED ${sub}`,
    `VAT (5%) : AED ${vat}`,
    `*Total   : AED ${total}*`,
    `Payment  : ${inv.payment?.method || 'Cash'}`,
    `Status   : ${inv.status || 'Paid'}`,
    ``,
    `Thank you for your purchase! 🎵`,
  ].join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

async function getNextAmendmentNumber(baseNumber) {
  // Strip existing suffix so amendments of amendments chain from original
  const base = baseNumber.replace(/-[A-Z]$/, '');
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const candidate = `${base}-${letter}`;
    const existing  = await getInvoiceByNumber(candidate);
    if (!existing) return candidate;
  }
  throw new Error('Too many amendments on this invoice');
}

async function saveAsAmendment() {
  if (!isReprintMode || !reprintInvoiceData) return;
  const data = collectInvoiceData();
  if (!data) return;

  const btn = document.getElementById('printBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    const originalNumber  = reprintInvoiceData.originalInvoiceNumber || reprintInvoiceData.invoiceNumber;
    const originalId      = reprintInvoiceData.originalInvoiceId     || reprintInvoiceData.id;
    const amendmentNumber = await getNextAmendmentNumber(originalNumber);

    data.invoiceNumber         = amendmentNumber;
    data.isAmendment           = true;
    data.originalInvoiceId     = originalId;
    data.originalInvoiceNumber = originalNumber;

    updateEl('invNum', amendmentNumber);
    await saveInvoice(data);
    await markInvoiceSuperseded(reprintInvoiceData.id, amendmentNumber);
    trackOfflineSave();
    showToast(`✅ Invoice ${amendmentNumber} saved`, 'success');
    // afterprint event handles restorePrintLayout + resetToNewInvoice
    setTimeout(() => { preparePrintLayout(); window.print(); }, 300);
  } catch (err) {
    console.error('Amendment error:', err);
    showToast('❌ Save failed: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📝 Save & Reprint'; }
  } finally {
    setTimeout(() => loadDashboardData().catch(() => {}), PERF.PRINT_RESTORE_DELAY || 3000);
  }
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
  container.innerHTML = '<div class="history-loading">Loading today\'s activity…</div>';

  try {
    const [invoices, deposits, expenses, cashIns] = await Promise.all([
      getTodayInvoices(), getTodayDeposits(), getTodayExpenses(), getTodayCashIns(),
    ]);

    // Merge everything into one flat list, sort by time desc
    const todayDate = todayUAE();
    const allItems = [
      ...invoices.map(inv => ({
        _type: 'invoice', _id: inv.id, _deleted: !!inv.deleted,
        id:        inv.invoiceNumber,
        desc:      inv.customer?.name || inv.customer || 'Walk-in',
        time:      (inv.time || '').substring(0, 5),
        method:    inv.payment?.method || inv.payment || '',
        amount:    inv.payment?.grandTotal ?? (inv.grandTotal || 0),
        status:    inv.deleted ? 'Deleted' : (inv.status || 'Paid'),
        isBackdated: !inv.deleted && !!inv.date && inv.date !== todayDate,
        isAmendment: !!inv.isAmendment && !inv.superseded,
        isSuperseded: !!inv.superseded,
        origNum:   inv.originalInvoiceNumber || '',
        supBy:     inv.supersededBy || '',
        inv,
      })),
      ...cashIns.map(c => ({
        _type: 'cashin', _id: c.id, _deleted: !!c.deleted,
        id:     c.cashInId || '',
        desc:   c.reference || c.description || '—',
        time:   (c.time || '').substring(0, 5),
        method: '',
        amount: c.amount || 0,
        status: c.deleted ? 'Deleted' : 'Cash In',
      })),
      ...deposits.map(d => ({
        _type: 'deposit', _id: d.id, _deleted: !!d.deleted,
        id:     d.depositId || '',
        desc:   `${d.depositor || ''}${d.bank ? ` → ${d.bank}` : ''}` || '—',
        time:   (d.time || '').substring(0, 5),
        method: '',
        amount: d.amount || 0,
        status: d.deleted ? 'Deleted' : 'Deposited',
      })),
      ...expenses.map(e => ({
        _type: 'expense', _id: e.id, _deleted: !!e.deleted,
        id:     e.expenseId || '',
        desc:   e.description || '—',
        time:   (e.time || '').substring(0, 5),
        method: '',
        amount: e.amount || 0,
        status: e.deleted ? 'Deleted' : 'Expense',
      })),
    ].sort((a, b) => b.time.localeCompare(a.time));

    if (!allItems.length) {
      container.innerHTML = '<div class="history-empty">No activity today yet.</div>';
      return;
    }

    let html = `<div class="history-table-wrap"><table class="history-table"><thead><tr>
      <th>#&nbsp;/&nbsp;ID</th><th>Details</th><th>Time</th><th>Method</th>
      <th style="text-align:right">Amount (AED)</th><th>Status</th>
    </tr></thead><tbody>`;

    allItems.forEach(item => {
      const del  = item._deleted;
      const type = item._type;

      // Row styling
      let rowClass = del ? 'history-row-deleted' : '';
      if (!del && type === 'invoice') {
        if (item.inv?.status === 'Refunded') rowClass = 'history-row-refunded';
        else if (item.isAmendment)           rowClass = 'history-row-amendment';
        else if (item.isSuperseded)          rowClass = 'history-row-superseded';
      }

      // Clickable invoices (not deleted)
      const click  = (!del && type === 'invoice') ? `onclick="handleReprintInvoice('${item._id}'); closeHistoryModal();"` : '';
      const cursor = del ? 'style="cursor:default"' : '';

      // ID cell — red for backdated invoices
      const idStyle = item.isBackdated ? 'style="color:#dc2626;font-weight:800;"' : '';
      const badges  = type === 'invoice' ? [
        del                ? `<span class="history-amend-badge deleted-badge">DEL</span>`                                                     : '',
        item.isAmendment   ? `<span class="history-amend-badge" title="Amended from ${item.origNum}">AMEND</span>`                           : '',
        item.isSuperseded  ? `<span class="history-amend-badge superseded-badge" title="Superseded by ${item.supBy}">SUP</span>`             : '',
        item.isBackdated   ? `<span class="history-amend-badge" style="background:#fee2e2;color:#dc2626;border-color:#fca5a5;">OLD</span>`    : '',
      ].join('') : '';

      // Status badge colour
      const statusClass = del ? 'deleted'
        : type === 'invoice'  ? (item.inv?.status || 'paid').toLowerCase()
        : type === 'cashin'   ? 'cashin'
        : type === 'deposit'  ? 'deposited'
        : 'expensed';

      html += `<tr class="${rowClass}" ${click} ${cursor}>
        <td class="ht-num" ${idStyle}>${item.id}${badges}</td>
        <td>${item.desc}</td>
        <td class="ht-time">${item.time}</td>
        <td>${item.method ? `<span class="history-inv-method">${item.method}</span>` : ''}</td>
        <td class="ht-total">${del ? '—' : `AED ${item.amount.toFixed(2)}`}</td>
        <td><span class="history-inv-status ${statusClass}">${item.status}</span></td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    console.error('History error:', err);
    container.innerHTML = '<div style="color:#f43f5e;text-align:center;padding:20px;">Error loading activity.</div>';
  }
};

window.closeHistoryModal = function() {
  document.getElementById('historyModal')?.classList.remove('show');
};

// ─── Deposits ──────────────────────────────────────────────────

window.selectDepositType = function(button, type) {
  currentDepositType = type;
  document.querySelectorAll('#depositTypeGrid .deposit-type-btn').forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  const nameRow = document.getElementById('depositNameRow');
  if (nameRow) nameRow.style.display = type === 'Cheque' ? '' : 'none';
  if (type === 'Cheque') setTimeout(() => document.getElementById('depositName')?.focus(), 80);
};

// ─── Transaction Modal (Cash In / Cash Out) ──────────────────────

window.openCashInModal = function() {
  document.getElementById('ciAmount').value    = '';
  document.getElementById('ciReference').value = '';
  document.getElementById('txModal').style.display = 'flex';
  setTimeout(() => document.getElementById('ciAmount')?.focus(), 100);
};
window.openTransactionModal = window.openCashInModal; // keep old name working

window.closeTxModal = function() {
  document.getElementById('txModal').style.display = 'none';
};

window.submitCashIn = async function() {
  const amount    = parseFloat(document.getElementById('ciAmount')?.value);
  const reference = document.getElementById('ciReference')?.value?.trim().toUpperCase();

  if (!amount || amount <= 0) { showToast('Please enter a valid amount.', 'error'); return; }

  const btn = document.querySelector('#txModal .btn-success');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    await createCashIn({ amount, reference });
    showToast(`✅ Cash In AED ${amount.toFixed(2)} saved.`, 'success');
    window.closeTxModal();
    loadDashboardData().catch(() => {});
  } catch (err) {
    console.error('Cash In error:', err);
    showToast('❌ Could not save. Try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Save Cash In'; }
  }
};

window.openDepositModal = function() {
  const modal = document.getElementById('depositModal');
  if (modal) modal.classList.add('show');
  // Reset type to Cash
  currentDepositType = 'Cash';
  document.querySelectorAll('#depositTypeGrid .deposit-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#depositTypeGrid .deposit-type-btn.cash')?.classList.add('active');
  const nameRow = document.getElementById('depositNameRow');
  if (nameRow) nameRow.style.display = 'none';
  ['depositName','depositAmount','depositBank'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  setTimeout(() => document.getElementById('depositAmount')?.focus(), 100);
};

window.closeDepositModal = function() {
  document.getElementById('depositModal')?.classList.remove('show');
};

window.submitDeposit = async function() {
  if (_depositSaving) return;
  const amount = parseFloat(document.getElementById('depositAmount')?.value);
  const bank   = document.getElementById('depositBank')?.value.trim();
  const name   = currentDepositType === 'Cheque'
    ? document.getElementById('depositName')?.value.trim()
    : '';

  if (!amount || amount <= 0) { showToast('Enter a valid amount.', 'error'); document.getElementById('depositAmount')?.focus(); return; }
  if (!bank)   { showToast('Enter bank name.', 'error');    document.getElementById('depositBank')?.focus();   return; }
  if (currentDepositType === 'Cheque' && !name) { showToast('Enter company name.', 'error'); document.getElementById('depositName')?.focus(); return; }

  _depositSaving = true;
  const btn = document.querySelector('#depositModal .btn-success');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const depositId = await getNextDepositId();
    await saveDeposit({ depositId, amount, bank, depositor: name, depositType: currentDepositType });
    trackOfflineSave();
    showToast(`✅ ${currentDepositType} deposit AED ${amount.toFixed(2)} saved.`, 'success');
    closeDepositModal();
    await loadDashboardData();
  } catch (err) {
    console.error('Deposit error:', err);
    showToast('Failed to save deposit.', 'error');
  } finally {
    _depositSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = '✓ Save Deposit'; }
  }
};

// ─── Expenses ──────────────────────────────────────────────────

window.openExpenseModal = function() {
  const modal = document.getElementById('expenseModal');
  if (modal) modal.classList.add('show');
  ['expenseAmount','expenseDesc'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; if (i === 0) setTimeout(() => el.focus(), 100); }
  });
};

window.closeExpenseModal = function() {
  document.getElementById('expenseModal')?.classList.remove('show');
};

window.submitExpense = async function() {
  if (_expenseSaving) return;
  const amount   = parseFloat(document.getElementById('expenseAmount')?.value);
  const desc     = document.getElementById('expenseDesc')?.value.trim();

  if (!amount || amount <= 0) { showToast('Enter a valid amount.', 'error'); document.getElementById('expenseAmount')?.focus(); return; }
  if (!desc)     { showToast('Enter a description.', 'error');     document.getElementById('expenseDesc')?.focus();     return; }

  _expenseSaving = true;
  const btn = document.querySelector('#expenseModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const expenseId = await getNextExpenseId();
    await saveExpense({ expenseId, description: desc, amount });
    trackOfflineSave();
    showToast(`✅ Expense AED ${amount.toFixed(2)} saved.`, 'success');
    closeExpenseModal();
    await loadDashboardData();
  } catch (err) {
    console.error('Expense error:', err);
    showToast('Failed to save expense.', 'error');
  } finally {
    _expenseSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
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

// ─── Midnight Reset (UAE timezone) ──────────────────────────────

function showMidnightOverlay() {
  needsPageRefresh = true;
  const btn = document.getElementById('printBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
  if (document.getElementById('midnightOverlay')) return;
  const today = todayUAE();
  const [y, m, d] = today.split('-').map(Number);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${String(d).padStart(2,'0')} ${MON[m-1]} ${y}`;
  const el = document.createElement('div');
  el.id = 'midnightOverlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.92);display:flex;align-items:center;justify-content:center;font-family:inherit;';
  el.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:44px 36px;text-align:center;max-width:360px;width:90%;box-shadow:0 16px 60px rgba(0,0,0,.6);">
      <div style="font-size:60px;margin-bottom:10px;">🌙</div>
      <div style="font-size:24px;font-weight:900;color:#0f172a;margin-bottom:6px;">New Day!</div>
      <div style="font-size:14px;color:#64748b;line-height:1.7;margin-bottom:28px;">
        It's past midnight UAE time.<br>
        Refresh to start invoicing for<br>
        <strong style="color:#0ea5e9;font-size:16px;">${label}</strong>
      </div>
      <button onclick="location.reload()" style="background:#0ea5e9;color:#fff;border:none;border-radius:12px;padding:16px 0;font-size:17px;font-weight:800;cursor:pointer;width:100%;letter-spacing:.3px;box-shadow:0 4px 14px rgba(14,165,233,.4);">
        🔄 Refresh Now
      </button>
    </div>`;
  document.body.appendChild(el);
}

function scheduleMidnightRefresh() {
  // Compute ms remaining until midnight UAE (UTC+4)
  const UAEOffset  = 4 * 60 * 60 * 1000;
  const nowUAEMs   = Date.now() + UAEOffset;
  const msPerDay   = 24 * 60 * 60 * 1000;
  const msIntoDay  = nowUAEMs % msPerDay;
  const msToMidnight = msPerDay - msIntoDay + 5000; // 5s past midnight buffer

  setTimeout(() => {
    showMidnightOverlay();
    // Schedule again so if they refresh this fires for the next midnight too
    scheduleMidnightRefresh();
  }, msToMidnight);
  debugLog(`⏰ Midnight refresh in ${Math.round(msToMidnight / 60000)} min`);
}

// ─── Window Exports ─────────────────────────────────────────────

window.clearForm = function() {
  if (confirm('Clear the current invoice?')) {
    isReprintMode      = false;
    reprintInvoiceData = null;
    setNewInvoiceUI();
    resetInvoiceForm();
    loadNextInvoiceNumber();
    showToast('Form cleared.', 'info');
  }
};

window.saveAndPrint = function() {
  if (needsPageRefresh) { showMidnightOverlay(); return; }
  if (isReprintMode) {
    // Superseded invoices: just reprint the physical copy, never create another record
    if (reprintInvoiceData?.superseded) {
      setTimeout(() => { preparePrintLayout(); window.print(); }, 50);
    } else {
      // Only create an amendment record if total or payment method actually changed
      const origTotal  = reprintInvoiceData.payment?.grandTotal || 0;
      const origMethod = reprintInvoiceData.payment?.method || '';
      const currTotal  = parseFloat(document.getElementById('grandTotal')?.textContent?.replace(/[^0-9.]/g, '')) || 0;
      const currMethod = currentPaymentMethod || '';
      if (Math.abs(currTotal - origTotal) > 0.001 || currMethod !== origMethod) {
        saveAsAmendment();
      } else {
        setTimeout(() => { preparePrintLayout(); window.print(); }, 50);
      }
    }
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

    // Cash In modal Enter chain
    if (active.closest('#txModal') && e.key === 'Enter') {
      e.preventDefault();
      if (active.id === 'ciAmount') document.getElementById('ciReference')?.focus();
      else window.submitCashIn();
      return;
    }

    // Deposit modal Enter chain
    if (active.closest('#depositModal') && e.key === 'Enter') {
      e.preventDefault();
      const seq = currentDepositType === 'Cheque'
        ? ['depositName','depositAmount','depositBank']
        : ['depositAmount','depositBank'];
      const idx = seq.indexOf(active.id);
      if (idx >= 0 && idx < seq.length - 1) document.getElementById(seq[idx + 1])?.focus();
      else if (idx === seq.length - 1) window.submitDeposit();
      return;
    }

    // Expense modal Enter chain (skip textarea — newlines allowed there)
    if (active.closest('#expenseModal') && e.key === 'Enter' && active.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const seq = ['expenseAmount','expenseDesc'];
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
      if (document.getElementById('txModal')?.style.display === 'flex')       { window.closeTxModal();    return; }
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
  if (invDate) { invDate.value = todayUAE(); invDate.max = todayUAE(); }
  updateSyncBadge();

  // Auto-uppercase every text input in the invoice form — no Caps Lock needed.
  document.querySelector('.invoice-card')?.addEventListener('input', e => {
    const el = e.target;
    if (el.tagName !== 'INPUT' || el.type !== 'text') return;
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(pos, pos);
  });

  document.getElementById('googleSignInBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  setupKeyboard();

  // ─── VAT Calculator ────────────────────────────────────────
  const vatAfterEl  = document.getElementById('vatCalcAfter');
  const vatBeforeEl = document.getElementById('vatCalcBefore');
  const vatNoteEl   = document.getElementById('vatCalcNote');
  const VAT_RATE    = 0.05;
  let vatResetTimer;

  // Simulate exactly how calculateTotals() computes grand total from a base price.
  // This ensures the pre-VAT value we suggest will produce the expected invoice total.
  function simGrand(base) {
    const vat = parseFloat((base * VAT_RATE).toFixed(2));
    return parseFloat((base + vat).toFixed(2));
  }

  // Find a 2dp pre-VAT base whose invoice grand total equals `target`.
  // Tries floor, round, and ceil candidates. Returns { base, grand, exact }.
  function findPreVAT(target) {
    const raw = target / (1 + VAT_RATE);
    for (const fn of [Math.floor, Math.round, Math.ceil]) {
      const base  = fn(raw * 100) / 100;
      const grand = simGrand(base);
      if (Math.abs(grand - target) < 0.001) return { base, grand, exact: true };
    }
    // No clean 2dp base gives this total — return standard round with actual grand
    const base  = Math.round(raw * 100) / 100;
    return { base, grand: simGrand(base), exact: false };
  }

  const vatNote = (txt, warn = false) => {
    if (!vatNoteEl) return;
    vatNoteEl.textContent = txt;
    vatNoteEl.className = warn ? 'vat-calc-note vat-calc-warn' : 'vat-calc-note';
  };

  const scheduleVatReset = () => {
    clearTimeout(vatResetTimer);
    vatResetTimer = setTimeout(() => {
      if (vatAfterEl)  vatAfterEl.value  = '';
      if (vatBeforeEl) vatBeforeEl.value = '';
      vatNote('VAT 5% · fill either to calculate');
    }, 15000);
  };

  vatAfterEl?.addEventListener('input', () => {
    const after = parseFloat(vatAfterEl.value);
    if (!isNaN(after) && after > 0) {
      const { base, grand, exact } = findPreVAT(after);
      vatBeforeEl.value = base.toFixed(2);
      if (exact) {
        vatNote('VAT 5% · exact');
      } else {
        vatNote(`Enter ${base.toFixed(2)} → invoice = AED ${grand.toFixed(2)}`, true);
      }
    } else {
      vatBeforeEl.value = '';
      vatNote('VAT 5% · fill either to calculate');
    }
    scheduleVatReset();
  });

  vatBeforeEl?.addEventListener('input', () => {
    const before = parseFloat(vatBeforeEl.value);
    if (!isNaN(before) && before > 0) {
      vatAfterEl.value = parseFloat((before * (1 + VAT_RATE)).toFixed(2)).toFixed(2);
      vatNote('VAT 5%');
    } else {
      vatAfterEl.value = '';
      vatNote('VAT 5% · fill either to calculate');
    }
    scheduleVatReset();
  });
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
