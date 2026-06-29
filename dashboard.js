// dashboard.js — AKM-POS Dashboard v5.0
// Unified activity feed (invoices + deposits + expenses sorted by timestamp),
// all-time cash-in-hand carry-forward, offline indicator, in-memory cache.

import { auth, onAuthStateChanged, signOut } from './firebase-config.js';
import {
  db,
  getTodayInvoices,
  markInvoiceAsRefunded,
  softDeleteDocument,
  formatDate,
  formatTime,
  getAllTimeCashFlow,
  getRecentActivity,
  getAllDocsForExport,
  bulkDeleteCollection,
  bulkSetDocs,
  resetAllCollections,
  invalidateCache,
} from './firestore-utils.js';
import { collection, query, where, orderBy, getDocs, Timestamp, serverTimestamp } from './firebase-config.js';
import { APP_CONFIG, debugLog } from './config.js';
import { showToast } from './utils.js';

const ALLOWED_EMAIL = APP_CONFIG.ALLOWED_EMAIL;

// ─── XLSX Lazy Loader ────────────────────────────────────────────
// SheetJS (~430 KB) is deferred until the user triggers Export or Import.
let _xlsxPromise = null;
function ensureXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (!_xlsxPromise) {
    _xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src     = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload  = resolve;
      s.onerror = () => {
        _xlsxPromise = null; // allow retry on next call
        reject(new Error('Failed to load XLSX library — check your connection.'));
      };
      document.head.appendChild(s);
    });
  }
  return _xlsxPromise;
}

let currentUser      = null;
let currentTaxReport = null;
let allActivity        = [];
let activeTypeFilter   = 'all';
let activeDateFilter   = 'all';
let activeSearchQuery  = '';

const TAX_QUARTERS = {
  Q1: { name: 'Q1: Apr–Jun', months: [4, 5, 6] },
  Q2: { name: 'Q2: Jul–Sep', months: [7, 8, 9] },
  Q3: { name: 'Q3: Oct–Dec', months: [10, 11, 12] },
  Q4: { name: 'Q4: Jan–Mar', months: [1, 2, 3] }
};

// getAllTimeCashFlow is cached at the firestore-utils level (5-min TTL).
// invalidateCache() from firestore-utils busts that cache after any write.

// ─── Offline Indicator ───────────────────────────────────────────

function updateOfflineIndicator() {
  const el = document.getElementById('offlineIndicator');
  if (!el) return;
  if (navigator.onLine) {
    el.style.display = 'none';
  } else {
    el.style.display = 'flex';
  }
}

window.addEventListener('online',  updateOfflineIndicator);
window.addEventListener('offline', updateOfflineIndicator);

// ─── Initialization ─────────────────────────────────────────────

async function initDashboard() {
  debugLog('🚀 AKM Dashboard v5.0');
  updateOfflineIndicator();

  // Show dashboard immediately — data loads in the background
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('dashboardApp').style.display  = 'block';

  // Set up refresh intervals unconditionally (not dependent on first load succeeding)
  setInterval(() => { invalidateCache(); loadDashboardStats(); loadActivityFeed(); }, 300_000);

  try {
    await Promise.all([loadDashboardStats(), loadActivityFeed()]);
    showToast('Dashboard loaded', 'success');
  } catch (err) {
    console.error('❌ Dashboard init error:', err);
    showToast('Error loading dashboard', 'error');
  }
}

// ─── Stats ──────────────────────────────────────────────────────

async function loadDashboardStats() {
  try {
    // Both are cached at the firestore-utils level — real reads only when cache is stale
    const [cfData, invoices] = await Promise.all([
      getAllTimeCashFlow(),
      getTodayInvoices(),
    ]);
    const cashInHand = cfData?.cashInHand ?? 0;

    let totalSales = 0, totalVAT = 0, invoiceCount = 0;
    let cash = 0, card = 0, tabby = 0, cheque = 0;

    invoices.forEach(inv => {
      if (inv.status === 'Paid' && !inv.deleted && !inv.superseded) {
        totalSales += inv.payment?.grandTotal || 0;
        totalVAT   += inv.payment?.vat        || 0;
        cash       += inv.impacts?.cash       || 0;
        card       += inv.impacts?.card       || 0;
        tabby      += inv.impacts?.tabby      || 0;
        cheque     += inv.impacts?.cheque     || 0;
        invoiceCount++;
      }
    });

    updateEl('cashInHand',        cashInHand.toFixed(2));
    updateEl('todayTotalSales',   totalSales.toFixed(2));
    updateEl('todayInvoiceCount', `${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''}`);
    updateEl('todayVAT',          totalVAT.toFixed(2));
    updateEl('cashSales',         cash.toFixed(2));
    updateEl('cardSales',         card.toFixed(2));
    updateEl('tabbySales',        tabby.toFixed(2));
    updateEl('chequeSales',       cheque.toFixed(2));
  } catch (err) {
    console.error('❌ Stats error:', err);
    showToast('Could not refresh stats — check connection', 'warning');
  }
}

// ─── Activity Feed ───────────────────────────────────────────────

async function loadActivityFeed() {
  const tbody = document.getElementById('activityTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Loading activity…</td></tr>';
  }
  try {
    allActivity = await getRecentActivity(90);
    applyActivityFilters();
  } catch (err) {
    console.error('❌ Activity load error:', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-error">Error loading activity</td></tr>';
    }
  }
}

function applyActivityFilters() {
  let filtered = [...allActivity];

  if (activeTypeFilter !== 'all') {
    filtered = filtered.filter(item => item.type === activeTypeFilter);
  }

  const now = new Date();
  // effectiveDate: processDate (new) → createdAt UAE date (pre-processDate legacy) → date (oldest fallback)
  const effectiveDate = item => {
    if (item.processDate) return item.processDate;
    const cAt = item.createdAt?.toDate?.()?.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    return cAt || item.date;
  };
  if (activeDateFilter === 'today') {
    const today = formatDate(now, 'YYYY-MM-DD');
    filtered = filtered.filter(item => effectiveDate(item) === today);
  } else if (activeDateFilter === 'week') {
    const cut = formatDate(new Date(now - 7 * 86400000), 'YYYY-MM-DD');
    filtered = filtered.filter(item => effectiveDate(item) >= cut);
  } else if (activeDateFilter === 'month') {
    const cut = formatDate(new Date(now - 30 * 86400000), 'YYYY-MM-DD');
    filtered = filtered.filter(item => effectiveDate(item) >= cut);
  }

  if (activeSearchQuery) {
    const q = activeSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(item => (item.refId || '').toLowerCase().includes(q));
  }

  displayActivity(filtered);
}

window.setTypeFilter = function(type) {
  activeTypeFilter = type;
  const sel = document.getElementById('typeFilter');
  if (sel && sel.value !== type) sel.value = type;
  applyActivityFilters();
};

window.setDateFilter = function(date) {
  activeDateFilter = date;
  const sel = document.getElementById('periodFilter');
  if (sel && sel.value !== date) sel.value = date;
  applyActivityFilters();
};

window.setInvoiceSearch = function(val) {
  activeSearchQuery = val;
  applyActivityFilters();
};

window.loadMoreActivity = async function() {
  showToast('Loading 6 months of activity…', 'info');
  try {
    allActivity = await getRecentActivity(180);
    applyActivityFilters();
  } catch (err) {
    console.error('❌ Load more error:', err);
    showToast('Failed to load more activity', 'error');
  }
};

// ─── Display ─────────────────────────────────────────────────────

const _MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDateStr(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${String(d).padStart(2,'0')} ${_MON[m-1]} ${y}`;
}

function fmtTimeStr(s) {
  return s ? s.slice(0, 5) : '';
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayActivity(items) {
  const tbody = document.getElementById('activityTableBody');
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No activity for this filter</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    const isRefunded   = item.type === 'invoice' && item.status === 'Refunded';
    const isDeleted    = item.deleted    === true;
    const isSuperseded = item.type === 'invoice' && item.superseded === true;

    let rowClass = `row-type-${item.type}`;
    if (isDeleted)        rowClass = 'row-deleted';
    else if (isSuperseded) rowClass += ' row-superseded';
    else if (isRefunded)  rowClass += ' row-refunded';

    // Type badge
    const typeLabel = item.type === 'invoice' ? 'Invoice'
                    : item.type === 'deposit'  ? 'Deposit'
                    : item.type === 'cashin'   ? 'Cash In'
                    :                            'Expense';
    const typeBadge = `<span class="type-badge type-${item.type}">${typeLabel}</span>`;

    // Date + time stacked — red if the invoice date differs from the day it was actually saved
    const savedDate = item.processDate ||
      (item.createdAt?.toDate?.()?.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }) ?? '');
    const isBackdated = item.type === 'invoice' && savedDate && item.date !== savedDate;
    const dateStr  = isBackdated
      ? `<span style="color:#dc2626;font-weight:700;" title="Entered ${fmtDateStr(item.date)}, saved ${fmtDateStr(savedDate)}">${fmtDateStr(item.date)}</span>`
      : fmtDateStr(item.date);
    const dateCell = `${dateStr}<br><span class="time-badge">${fmtTimeStr(item.time)}</span>`;

    // Amount — invoices and cash-ins are income (+), deposits/expenses are outflows (−)
    const isOut    = (item.type !== 'invoice' && item.type !== 'cashin') || isRefunded || isDeleted;
    const amtClass = isOut ? 'amount-out' : 'amount-in';
    const amtSign  = isOut ? '−' : '+';
    const amtCell  = `<span class="${amtClass}">${amtSign} AED ${item.amount.toFixed(2)}</span>`;

    // Info cell — payment method badge for invoices only
    const info = item.type === 'invoice'
      ? `<span class="payment-badge ${(item.payment || '').toLowerCase()}">${item.payment}</span>`
      : '';

    // Status badge — deleted overrides everything
    let statusBadge;
    if (isDeleted) {
      statusBadge = `<span class="status-badge deleted">Deleted</span>`;
    } else if (isSuperseded) {
      statusBadge = `<span class="status-badge superseded">Superseded</span>`;
    } else if (item.type === 'invoice') {
      statusBadge = `<span class="status-badge ${item.status.toLowerCase()}">${item.status}</span>`;
    } else if (item.type === 'deposit') {
      statusBadge = `<span class="status-badge deposited">Deposited</span>`;
    } else if (item.type === 'cashin') {
      statusBadge = `<span class="status-badge cashin">Cash In</span>`;
    } else {
      statusBadge = `<span class="status-badge expensed">Expense</span>`;
    }

    // Actions — deleted rows have no actions; live rows always get Delete button
    let actions = '';
    if (!isDeleted) {
      if (item.type === 'invoice') {
        actions += `<button onclick="reprintInvoice('${item.id}')" class="btn-table-action btn-view">View</button>`;
        if (!isRefunded) {
          actions += `<button onclick="refundInvoice('${item.id}','${esc(item.refId)}')" class="btn-table-action btn-refund">Refund</button>`;
        } else {
          actions += '<span class="refunded-label">Refunded</span>';
        }
      }
      actions += `<button onclick="deleteActivity('${item.type}','${item.id}','${esc(item.refId)}')" class="btn-table-action btn-delete" title="Delete (PIN required)">🗑️</button>`;
    }

    return `<tr class="${rowClass}">
      <td>${typeBadge}</td>
      <td><strong>${esc(item.refId)}</strong></td>
      <td class="date-time-cell">${dateCell}</td>
      <td class="desc-cell">${esc(item.description)}</td>
      <td class="amount-cell">${amtCell}</td>
      <td class="info-cell">${info}<br>${statusBadge}</td>
      <td><div class="table-action-buttons">${actions}</div></td>
    </tr>`;
  }).join('');
}

// ─── Invoice Actions ─────────────────────────────────────────────

window.reprintInvoice = function(id) {
  window.location.href = `index.html?reprint=${id}`;
};

window.refundInvoice = async function(id, num) {
  if (!confirm(`Refund invoice ${num}?`)) return;
  try {
    await markInvoiceAsRefunded(id);
    showToast('Invoice refunded', 'success');
    invalidateCache();
    await Promise.all([loadDashboardStats(), loadActivityFeed()]);
  } catch (err) {
    console.error('❌ Refund error:', err);
    showToast('Failed to refund invoice', 'error');
  }
};

// ─── Delete (PIN-protected soft delete) ──────────────────────────
// The record is kept for audit; the ID/number is never reused.
// Deleted items show in the feed with strikethrough but are excluded
// from all financial totals (cash in hand, sales, VAT, etc.).

const COLLECTION_MAP = { invoice: 'invoices', deposit: 'deposits', expense: 'expenses', cashin: 'cash_ins' };

window.deleteActivity = async function(type, id, refId) {
  const pin = window.prompt(`🔒 PIN required to delete ${type} ${refId}:`);
  if (pin === null) return;
  if (pin.trim() !== '2532') { showToast('Incorrect PIN', 'error'); return; }

  if (!confirm(`Delete ${type} "${refId}"?\n\nIt will be marked Deleted and removed from all totals. The ID is kept for audit and will never be reused.`)) return;

  try {
    await softDeleteDocument(COLLECTION_MAP[type], id);
    showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} ${refId} deleted`, 'success');
    invalidateCache();
    await Promise.all([loadDashboardStats(), loadActivityFeed()]);
  } catch (err) {
    console.error('❌ Delete error:', err);
    showToast('Failed to delete — try again', 'error');
  }
};

// ─── Tax Reports ─────────────────────────────────────────────────

window.openTaxReportModal = function() {
  document.getElementById('taxReportModal').classList.add('show');
  const today    = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay  = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  document.getElementById('taxReportFromDate').valueAsDate = firstDay;
  document.getElementById('taxReportToDate').valueAsDate   = lastDay;
};

window.closeTaxReportModal = function() {
  document.getElementById('taxReportModal').classList.remove('show');
};

window.generateQuarterlyReport = async function(quarter) {
  const qi = TAX_QUARTERS[quarter];
  if (!qi) return;
  const yr        = new Date().getFullYear();
  const startDate = new Date(yr, Math.min(...qi.months) - 1, 1);
  const endDate   = new Date(yr, Math.max(...qi.months), 0);
  await generateTaxReport(startDate, endDate, qi.name);
};

window.generateCustomDateReport = async function() {
  const from = document.getElementById('taxReportFromDate').valueAsDate;
  const to   = document.getElementById('taxReportToDate').valueAsDate;
  if (!from || !to) { showToast('Please select both dates', 'error'); return; }
  if (from > to)    { showToast('From date must be before to date', 'error'); return; }
  await generateTaxReport(from, to, `${formatDate(from,'DD MMM YYYY')} – ${formatDate(to,'DD MMM YYYY')}`);
};

async function generateTaxReport(startDate, endDate, periodName) {
  try {
    showToast('Generating tax report…', 'info');
    const invoices = await queryInvoicesByDateRange(startDate, endDate);
    if (!invoices.length) {
      showToast('No invoices found for this period', 'warning');
      document.getElementById('taxReportDisplay').style.display = 'none';
      return;
    }

    let totalSales = 0, totalVAT = 0;
    let cashSales = 0, cardSales = 0, tabbySales = 0, chequeSales = 0;
    let paidInvoices = 0, refundedInvoices = 0;

    const details = invoices.map(inv => {
      const subtotal   = inv.payment?.subtotal   || 0;
      const vat        = inv.payment?.vat        || 0;
      const grandTotal = inv.payment?.grandTotal || 0;
      if (!inv.superseded) {
        if (inv.status === 'Paid') {
          totalSales  += grandTotal;
          totalVAT    += vat;
          cashSales   += inv.impacts?.cash   || 0;
          cardSales   += inv.impacts?.card   || 0;
          tabbySales  += inv.impacts?.tabby  || 0;
          chequeSales += inv.impacts?.cheque || 0;
          paidInvoices++;
        } else if (inv.status === 'Refunded') {
          refundedInvoices++;
        }
      }
      return {
        invoiceNumber: inv.invoiceNumber,
        date: inv.date,
        customer: inv.customer?.name || 'Walk-in',
        subtotal, vat, grandTotal,
        payment: inv.payment?.method || 'Cash',
        status: inv.superseded ? `Superseded→${inv.supersededBy}` : inv.status
      };
    });

    currentTaxReport = {
      periodName,
      startDate: formatDate(startDate, 'YYYY-MM-DD'),
      endDate:   formatDate(endDate,   'YYYY-MM-DD'),
      totalSales, totalVAT, cashSales, cardSales, tabbySales, chequeSales,
      paidInvoices, refundedInvoices, invoices: details
    };

    displayTaxReport(currentTaxReport);
    showToast('Tax report generated', 'success');
  } catch (err) {
    console.error('❌ Tax report error:', err);
    showToast('Failed to generate tax report', 'error');
  }
}

async function queryInvoicesByDateRange(startDate, endDate) {
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  const q = query(
    collection(db, 'invoices'),
    where('dateObj', '>=', Timestamp.fromDate(startDate)),
    where('dateObj', '<=', Timestamp.fromDate(end)),
    orderBy('dateObj', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('❌ queryInvoicesByDateRange error:', err);
    if (err.code === 'failed-precondition') {
      showToast('Database index building. Try again in a minute.', 'warning');
    }
    return [];
  }
}

function displayTaxReport(data) {
  document.getElementById('taxReportContent').innerHTML = `
    <div class="tax-report">
      <h3>${data.periodName}</h3>
      <p class="report-period">${data.startDate} — ${data.endDate}</p>
      <div class="report-summary">
        <div class="summary-item"><div class="summary-label">Total Sales (incl. VAT)</div><div class="summary-value">AED ${data.totalSales.toFixed(2)}</div></div>
        <div class="summary-item"><div class="summary-label">Total VAT (5%)</div><div class="summary-value">AED ${data.totalVAT.toFixed(2)}</div></div>
        <div class="summary-item"><div class="summary-label">Net Sales (excl. VAT)</div><div class="summary-value">AED ${(data.totalSales - data.totalVAT).toFixed(2)}</div></div>
        <div class="summary-item"><div class="summary-label">Total Invoices</div><div class="summary-value">${data.paidInvoices}</div></div>
      </div>
      <div class="payment-breakdown">
        <div class="breakdown-item">💵 Cash: <strong>AED ${data.cashSales.toFixed(2)}</strong></div>
        <div class="breakdown-item">💳 Card: <strong>AED ${data.cardSales.toFixed(2)}</strong></div>
        <div class="breakdown-item">📱 Tabby: <strong>AED ${data.tabbySales.toFixed(2)}</strong></div>
        <div class="breakdown-item">📝 Cheque: <strong>AED ${data.chequeSales.toFixed(2)}</strong></div>
      </div>
      ${data.refundedInvoices > 0 ? `<div class="refund-notice">⚠️ Refunded Invoices: ${data.refundedInvoices}</div>` : ''}
      <h4>Invoice Details</h4>
      <table class="report-table">
        <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th>Subtotal</th><th>VAT</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead>
        <tbody>
          ${data.invoices.map(inv => `
            <tr class="${inv.status === 'Refunded' ? 'refunded-row' : ''}">
              <td>${inv.invoiceNumber}</td><td>${inv.date}</td><td>${inv.customer}</td>
              <td>AED ${inv.subtotal.toFixed(2)}</td><td>AED ${inv.vat.toFixed(2)}</td>
              <td><strong>AED ${inv.grandTotal.toFixed(2)}</strong></td>
              <td>${inv.payment}</td>
              <td><span class="status-${inv.status.toLowerCase()}">${inv.status}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  document.getElementById('taxReportDisplay').style.display = 'block';
}

// ─── Exports ────────────────────────────────────────────────────

window.exportTaxReportCSV = function() {
  if (!currentTaxReport) { showToast('No report data', 'error'); return; }
  const d = currentTaxReport;
  let csv = 'AKM Music Centre LLC - VAT/Tax Report\n';
  csv += `Period:,${d.periodName}\nFrom:,${d.startDate}\nTo:,${d.endDate}\n\n`;
  csv += `Summary\nTotal Sales (incl. VAT),AED ${d.totalSales.toFixed(2)}\n`;
  csv += `Total VAT (5%),AED ${d.totalVAT.toFixed(2)}\n`;
  csv += `Net Sales (excl. VAT),AED ${(d.totalSales - d.totalVAT).toFixed(2)}\n`;
  csv += `Total Invoices,${d.paidInvoices}\n\n`;
  csv += `Payment Breakdown\nCash,AED ${d.cashSales.toFixed(2)}\nCard,AED ${d.cardSales.toFixed(2)}\nTabby,AED ${d.tabbySales.toFixed(2)}\nCheque,AED ${d.chequeSales.toFixed(2)}\n\n`;
  csv += `Invoice Details\nInvoice Number,Date,Customer,Subtotal,VAT,Total,Payment Method,Status\n`;
  d.invoices.forEach(inv => {
    csv += `${inv.invoiceNumber},${inv.date},"${inv.customer}",${inv.subtotal.toFixed(2)},${inv.vat.toFixed(2)},${inv.grandTotal.toFixed(2)},${inv.payment},${inv.status}\n`;
  });
  downloadBlob(csv, 'text/csv', `VAT_Report_${d.startDate}_to_${d.endDate}.csv`);
  showToast('CSV exported', 'success');
};

window.exportTaxReportExcel = function() {
  if (!currentTaxReport) { showToast('No report data', 'error'); return; }
  const d = currentTaxReport;

  const cyan   = '#0ea5e9', cyanDk = '#0369a1', cyanLt = '#e0f2fe';
  const white  = '#ffffff', darkTxt = '#0c4a6e', midTxt = '#374151';
  const ltGray = '#f9fafb', border  = '#e2e8f0';

  const thStyle = `style="background:${cyan};color:${white};font-weight:700;padding:8px 12px;border:1px solid ${cyanDk};font-size:13px;text-align:left;"`;
  const tdStyle = (bg = white) => `style="padding:7px 12px;border:1px solid ${border};font-size:12px;background:${bg};color:${midTxt};"`;
  const tdRight = (bg = white) => `style="padding:7px 12px;border:1px solid ${border};font-size:12px;background:${bg};color:${midTxt};text-align:right;"`;
  const sumLbl  = `style="padding:8px 12px;border:1px solid ${border};font-weight:600;background:${cyanLt};color:${darkTxt};font-size:13px;"`;
  const sumVal  = `style="padding:8px 12px;border:1px solid ${border};font-weight:700;background:${white};color:${darkTxt};font-size:13px;text-align:right;"`;

  const rows = d.invoices.map((inv, i) => {
    const bg = i % 2 === 0 ? white : ltGray;
    const sc = inv.status === 'Refunded' ? '#fef2f2' : bg;
    return `<tr>
      <td ${tdStyle(sc)}>${inv.invoiceNumber}</td><td ${tdStyle(sc)}>${inv.date}</td>
      <td ${tdStyle(sc)}>${inv.customer}</td>
      <td ${tdRight(sc)}>AED ${inv.subtotal.toFixed(2)}</td>
      <td ${tdRight(sc)}>AED ${inv.vat.toFixed(2)}</td>
      <td ${tdRight(sc)}><b>AED ${inv.grandTotal.toFixed(2)}</b></td>
      <td ${tdStyle(sc)}>${inv.payment}</td><td ${tdStyle(sc)}>${inv.status}</td>
    </tr>`;
  }).join('');

  const html = `
<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>body{font-family:Calibri,Arial,sans-serif;}table{border-collapse:collapse;width:100%;}</style>
</head><body>
<table style="width:100%;margin-bottom:24px;">
  <tr>
    <td style="padding:16px 0;font-size:22px;font-weight:800;color:${cyan};">🎵 AKM MUSIC</td>
    <td style="text-align:right;padding:16px 0;font-size:12px;color:#6b7280;">AKM Music Centre LLC<br>VAT Registration: UAE</td>
  </tr>
</table>
<table style="width:100%;margin-bottom:20px;border-top:3px solid ${cyan};">
  <tr>
    <td style="padding:10px 0;font-size:18px;font-weight:700;color:${cyanDk};">VAT / Tax Report</td>
    <td style="text-align:right;padding:10px 0;color:#374151;font-size:13px;">Period: <b>${d.periodName}</b></td>
  </tr>
  <tr>
    <td style="font-size:12px;color:#6b7280;">From: ${d.startDate} &nbsp;&nbsp; To: ${d.endDate}</td>
    <td style="text-align:right;font-size:12px;color:#6b7280;">Exported: ${formatDate(new Date(),'DD MMM YYYY')}</td>
  </tr>
</table>
<h3 style="color:${cyanDk};margin:16px 0 8px;font-size:14px;">Summary</h3>
<table style="width:340px;margin-bottom:20px;">
  <tr><td ${sumLbl}>Total Sales (incl. VAT)</td><td ${sumVal}>AED ${d.totalSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Total VAT (5%)</td><td ${sumVal}>AED ${d.totalVAT.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Net Sales (excl. VAT)</td><td ${sumVal}>AED ${(d.totalSales - d.totalVAT).toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Total Paid Invoices</td><td ${sumVal}>${d.paidInvoices}</td></tr>
  ${d.refundedInvoices > 0 ? `<tr><td ${sumLbl} style="color:#b91c1c;">Refunded Invoices</td><td ${sumVal} style="color:#b91c1c;">${d.refundedInvoices}</td></tr>` : ''}
</table>
<h3 style="color:${cyanDk};margin:16px 0 8px;font-size:14px;">Payment Breakdown</h3>
<table style="width:340px;margin-bottom:24px;">
  <tr><td ${sumLbl}>💵 Cash</td><td ${sumVal}>AED ${d.cashSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>💳 Card</td><td ${sumVal}>AED ${d.cardSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>📱 Tabby</td><td ${sumVal}>AED ${d.tabbySales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>📝 Cheque</td><td ${sumVal}>AED ${d.chequeSales.toFixed(2)}</td></tr>
</table>
<h3 style="color:${cyanDk};margin:16px 0 8px;font-size:14px;">Invoice Details</h3>
<table>
  <thead><tr>
    <th ${thStyle}>Invoice #</th><th ${thStyle}>Date</th><th ${thStyle}>Customer</th>
    <th ${thStyle} style="text-align:right;">Subtotal</th><th ${thStyle} style="text-align:right;">VAT</th>
    <th ${thStyle} style="text-align:right;">Total</th><th ${thStyle}>Payment</th><th ${thStyle}>Status</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="3" style="padding:8px 12px;font-weight:700;background:${cyanLt};color:${darkTxt};border:1px solid ${border};">Totals</td>
    <td ${tdRight(cyanLt)} style="font-weight:700;color:${darkTxt};">AED ${(d.totalSales - d.totalVAT).toFixed(2)}</td>
    <td ${tdRight(cyanLt)} style="font-weight:700;color:${darkTxt};">AED ${d.totalVAT.toFixed(2)}</td>
    <td ${tdRight(cyanLt)} style="font-weight:700;color:${darkTxt};">AED ${d.totalSales.toFixed(2)}</td>
    <td colspan="2" style="padding:8px 12px;background:${cyanLt};border:1px solid ${border};"></td>
  </tr></tfoot>
</table>
<p style="margin-top:24px;font-size:11px;color:#9ca3af;border-top:1px solid ${border};padding-top:12px;">
  AKM Music Centre LLC — Generated by AKM-POS v5.0 on ${formatDate(new Date(),'DD MMM YYYY')} at ${formatTime(new Date())}
</p>
</body></html>`;

  downloadBlob(html, 'application/vnd.ms-excel', `VAT_Report_${d.startDate}_to_${d.endDate}.xls`);
  showToast('Excel exported', 'success');
};

window.printTaxReport = function() {
  if (!currentTaxReport) { showToast('No report to print', 'error'); return; }
  const d = currentTaxReport;
  const money = (n) => 'AED ' + (Number(n) || 0).toFixed(2);
  const rows = d.invoices.map(inv => `
    <tr class="${inv.status === 'Refunded' ? 'ref' : ''}">
      <td>${inv.invoiceNumber}</td><td>${inv.date}</td><td>${inv.customer}</td>
      <td class="r">${inv.subtotal.toFixed(2)}</td><td class="r">${inv.vat.toFixed(2)}</td>
      <td class="r"><b>${inv.grandTotal.toFixed(2)}</b></td><td>${inv.payment}</td><td>${inv.status}</td>
    </tr>`).join('');

  const pw = window.open('', '_blank', 'width=900,height=800');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>VAT Report — ${d.periodName}</title>
    <style>
      @page{size:A4;margin:14mm;}*{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Montserrat',Arial,sans-serif;color:#1e293b;font-size:12px;}
      .head{text-align:center;border-bottom:3px solid #0ea5e9;padding-bottom:14px;margin-bottom:18px;}
      .head h1{font-size:22px;color:#0369a1;letter-spacing:1px;}
      .head .co{font-size:13px;font-weight:600;margin-top:4px;}
      .head .trn{font-size:11px;color:#64748b;margin-top:2px;}
      .head .period{font-size:13px;font-weight:700;margin-top:8px;}
      .head .dates{font-size:11px;color:#64748b;}
      .summary{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;}
      .sum{flex:1 1 22%;border:1px solid #e2e8f0;border-left:4px solid #0ea5e9;border-radius:6px;padding:10px 12px;background:#f8fafc;}
      .sum .l{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:600;}
      .sum .v{font-size:16px;font-weight:800;color:#0c4a6e;margin-top:3px;}
      .pay{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;margin-bottom:16px;}
      .pay b{color:#0369a1;}
      h2{font-size:13px;color:#0369a1;margin:12px 0 6px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#0ea5e9;color:#fff;font-size:11px;padding:7px 8px;text-align:left;}
      th.r{text-align:right;}
      td{padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;}
      td.r{text-align:right;}
      tr.ref td{color:#dc2626;text-decoration:line-through;}
      .foot{margin-top:20px;border-top:1px solid #e5e7eb;padding-top:10px;font-size:10px;color:#94a3b8;text-align:center;}
      .no-print{text-align:center;margin-top:18px;}
      .no-print button{padding:9px 18px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}
      @media print{.no-print{display:none;}}
    </style>
  </head><body>
    <div class="head">
      <h1>VAT / TAX REPORT</h1>
      <div class="co">${APP_CONFIG.COMPANY_NAME_EN}</div>
      <div class="trn">TRN: ${APP_CONFIG.COMPANY_TRN}</div>
      <div class="period">${d.periodName}</div>
      <div class="dates">${d.startDate} — ${d.endDate}</div>
    </div>
    <div class="summary">
      <div class="sum"><div class="l">Total Sales (incl VAT)</div><div class="v">${money(d.totalSales)}</div></div>
      <div class="sum"><div class="l">Total VAT (5%)</div><div class="v">${money(d.totalVAT)}</div></div>
      <div class="sum"><div class="l">Net Sales (excl VAT)</div><div class="v">${money(d.totalSales - d.totalVAT)}</div></div>
      <div class="sum"><div class="l">Paid Invoices</div><div class="v">${d.paidInvoices}</div></div>
    </div>
    <div class="pay">
      <span>Cash: <b>${money(d.cashSales)}</b></span>
      <span>Card: <b>${money(d.cardSales)}</b></span>
      <span>Tabby: <b>${money(d.tabbySales)}</b></span>
      <span>Cheque: <b>${money(d.chequeSales)}</b></span>
      ${d.refundedInvoices > 0 ? `<span>Refunded: <b>${d.refundedInvoices}</b></span>` : ''}
    </div>
    <h2>Invoice Details (${d.invoices.length})</h2>
    <table>
      <thead><tr>
        <th>Invoice #</th><th>Date</th><th>Customer</th>
        <th class="r">Subtotal</th><th class="r">VAT</th><th class="r">Total</th>
        <th>Payment</th><th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">Generated ${formatDate(new Date(),'DD MMM YYYY')} ${formatTime(new Date())} — ${APP_CONFIG.COMPANY_NAME_EN}</div>
    <div class="no-print">
      <button onclick="window.print()" style="background:#0ea5e9;color:#fff;">🖨️ Print</button>
      <button onclick="window.close()" style="background:#e5e7eb;color:#374151;margin-left:8px;">✖ Close</button>
    </div>
  </body></html>`);
  pw.document.close();
};

// ─── Export All / Backup ─────────────────────────────────────────

function requirePin(action = 'continue') {
  const pin = window.prompt(`🔒 Enter PIN to ${action}:`);
  if (pin === null) return false;
  if (pin.trim() !== '2532') { showToast('Incorrect PIN', 'error'); return false; }
  return true;
}

window.openExportModal = function() {
  const modal = document.getElementById('exportModal');
  if (!modal) return;
  const m = document.getElementById('exportMonth');
  if (m && !m.value) {
    const now = new Date();
    m.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  modal.classList.add('show');
};

window.closeExportModal = function() {
  document.getElementById('exportModal')?.classList.remove('show');
};

// ─── Database Modal ──────────────────────────────────────────

window.openDbModal = function() {
  document.getElementById('dbModal')?.classList.add('show');
};

window.closeDbModal = function() {
  document.getElementById('dbModal')?.classList.remove('show');
};

// ─── Reset All Data ──────────────────────────────────────────
// Deletes invoices, deposits, expenses and _counters.
// Requires PIN + confirmation phrase to prevent accidents.

window.resetAllData = async function() {
  const pin = window.prompt('🔒 Enter PIN to reset all data:');
  if (pin === null) return;
  if (pin.trim() !== '2532') { showToast('Incorrect PIN', 'error'); return; }

  const confirm1 = window.prompt(
    '⚠️ This will permanently delete ALL invoices, deposits, expenses and counters.\n\nType  RESET  (all caps) to confirm:'
  );
  if (confirm1 === null) return;
  if (confirm1.trim() !== 'RESET') { showToast('Reset cancelled — type RESET exactly.', 'info'); return; }

  if (!confirm('Last chance — delete everything and start from zero?')) return;

  const btn = document.querySelector('#dbModal .db-btn-danger');
  if (btn) { btn.disabled = true; btn.textContent = 'Resetting…'; }
  try {
    showToast('Resetting database…', 'info');
    await resetAllCollections();
    closeDbModal();
    showToast('All data reset — reloading…', 'success');
    // Reload after reset so the Firestore IndexedDB cache is cleared and
    // re-synced from scratch (avoids BloomFilter mismatches on stale local data).
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    console.error('❌ Reset error:', err);
    const isPermission = err.code === 'permission-denied' || err.message?.includes('permission');
    showToast(isPermission
      ? 'Permission denied — sign in as sales@akm-music.com and try again'
      : `Reset failed: ${err.message || 'check your connection and try again'}`,
      'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Reset'; }
  }
};

window.doExport = async function(mode) {
  if (!requirePin('export data')) return;
  let startDate, endDate, label;
  if (mode === 'month') {
    const val = document.getElementById('exportMonth')?.value;
    if (!val) { showToast('Pick a month first.', 'error'); return; }
    const [y, m] = val.split('-').map(Number);
    startDate = new Date(y, m - 1, 1);
    endDate   = new Date(y, m, 0);
    label     = val;
  } else {
    startDate = new Date(2000, 0, 1);
    endDate   = new Date();
    label     = 'All-Time';
  }
  closeExportModal();
  await exportData(startDate, endDate, label);
};

async function queryByDateRange(collName, startDate, endDate) {
  const end = new Date(endDate); end.setHours(23, 59, 59, 999);
  const q = query(
    collection(db, collName),
    where('dateObj', '>=', Timestamp.fromDate(startDate)),
    where('dateObj', '<=', Timestamp.fromDate(end)),
    orderBy('dateObj', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function exportData(startDate, endDate, label) {
  try {
    showToast(`Generating report (${label})…`, 'info');
    const today = new Date();
    const [invRaw, depRaw, expRaw] = await Promise.all([
      queryByDateRange('invoices', startDate, endDate),
      queryByDateRange('deposits', startDate, endDate),
      queryByDateRange('expenses', startDate, endDate)
    ]);

    const invoices = invRaw.filter(inv => !inv.deleted);
    const deposits = depRaw.filter(d  => !d.deleted);
    const expenses = expRaw.filter(e  => !e.deleted);

    // ── Compute summary figures ─────────────────────────────
    let totalSales = 0, totalVAT = 0, netSales = 0;
    let cashSales = 0, cardSales = 0, tabbySales = 0, chequeSales = 0;
    let refundCount = 0;
    invoices.forEach(inv => {
      if (inv.status === 'Paid') {
        totalSales  += inv.payment?.grandTotal || 0;
        totalVAT    += inv.payment?.vat        || 0;
        cashSales   += inv.impacts?.cash       || 0;
        cardSales   += inv.impacts?.card       || 0;
        tabbySales  += inv.impacts?.tabby      || 0;
        chequeSales += inv.impacts?.cheque     || 0;
      } else if (inv.status === 'Refunded') {
        refundCount++;
      }
    });
    netSales = totalSales - totalVAT;
    const totalDeposits = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const cashInHand = cashSales - totalDeposits - totalExpenses;
    const paidCount  = invoices.filter(i => i.status === 'Paid').length;

    // ── Style helpers ───────────────────────────────────────
    const cyan = '#0ea5e9', cyanDk = '#0369a1', cyanLt = '#e0f2fe';
    const white = '#ffffff', ltGray = '#f9fafb', border = '#e2e8f0', mid = '#374151', dk = '#0c4a6e';
    const th  = `style="background:${cyan};color:${white};font-weight:700;padding:7px 12px;border:1px solid ${cyanDk};font-size:12px;"`;
    const thr = `style="background:${cyan};color:${white};font-weight:700;padding:7px 12px;border:1px solid ${cyanDk};font-size:12px;text-align:right;"`;
    const td  = (bg=white) => `style="padding:6px 11px;border:1px solid ${border};font-size:11.5px;background:${bg};color:${mid};"`;
    const tdr = (bg=white) => `style="padding:6px 11px;border:1px solid ${border};font-size:11.5px;background:${bg};color:${mid};text-align:right;"`;
    const sumLbl = `style="padding:8px 12px;border:1px solid ${border};font-weight:600;background:${cyanLt};color:${dk};font-size:12px;"`;
    const sumVal = `style="padding:8px 12px;border:1px solid ${border};font-weight:700;background:${white};color:${dk};font-size:12px;text-align:right;"`;

    // ── Table rows ──────────────────────────────────────────
    const invRows = invoices.map((inv, i) => {
      const bg = inv.status === 'Refunded' ? '#fef2f2' : (i % 2 === 0 ? white : ltGray);
      return `<tr>
        <td ${td(bg)}>${inv.invoiceNumber || ''}</td>
        <td ${td(bg)}>${inv.date || ''}</td>
        <td ${td(bg)}>${inv.customer?.name || 'Walk-in'}</td>
        <td ${tdr(bg)}>${(inv.payment?.subtotal || 0).toFixed(2)}</td>
        <td ${tdr(bg)}>${(inv.payment?.vat      || 0).toFixed(2)}</td>
        <td ${tdr(bg)}><b>${(inv.payment?.grandTotal || 0).toFixed(2)}</b></td>
        <td ${td(bg)}>${inv.payment?.method || 'Cash'}</td>
        <td ${td(bg)}>${inv.status || 'Paid'}</td>
      </tr>`;
    }).join('');

    const depRows = deposits.map((dep, i) => {
      const bg = i % 2 === 0 ? white : ltGray;
      return `<tr>
        <td ${td(bg)}>${dep.depositId || ''}</td>
        <td ${td(bg)}>${dep.date || ''}</td>
        <td ${td(bg)}>${dep.depositor || ''}</td>
        <td ${td(bg)}>${dep.bank || ''}</td>
        <td ${tdr(bg)}><b>${(dep.amount || 0).toFixed(2)}</b></td>
        <td ${td(bg)}>${dep.slipNumber || ''}</td>
      </tr>`;
    }).join('');

    const expRows = expenses.map((exp, i) => {
      const bg = i % 2 === 0 ? white : ltGray;
      return `<tr>
        <td ${td(bg)}>${exp.expenseId || ''}</td>
        <td ${td(bg)}>${exp.date || ''}</td>
        <td ${td(bg)}>${exp.description || ''}</td>
        <td ${tdr(bg)}><b>${(exp.amount || 0).toFixed(2)}</b></td>
        <td ${td(bg)}>${exp.receiptNumber || ''}</td>
      </tr>`;
    }).join('');

    const html = `
<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>body{font-family:Calibri,Arial,sans-serif;}table{border-collapse:collapse;}</style>
</head><body>

<!-- ── Header ─────────────────────────────────────────── -->
<table style="width:100%;margin-bottom:8px;border-bottom:3px solid ${cyan};">
  <tr>
    <td style="padding:14px 0 8px;font-size:22px;font-weight:800;color:${cyan};">AKM MUSIC</td>
    <td style="text-align:right;padding:14px 0 8px;font-size:11px;color:#6b7280;">
      Ajmal Khan Mohammed Music Centre LLC<br>
      TRN: ${APP_CONFIG.COMPANY_TRN}
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 10px;font-size:15px;font-weight:700;color:${cyanDk};">Monthly Business Report</td>
    <td style="text-align:right;padding:0 0 10px;font-size:11px;color:#374151;">
      Period: <b>${label}</b><br>
      Exported: ${formatDate(today,'DD MMM YYYY')} ${formatTime(today)}
    </td>
  </tr>
</table>

<!-- ── Summary ────────────────────────────────────────── -->
<h3 style="color:${cyanDk};margin:16px 0 8px;font-size:13px;">Business Summary</h3>
<table style="width:360px;margin-bottom:8px;">
  <tr><td ${sumLbl}>Total Sales (incl. VAT)</td><td ${sumVal}>AED ${totalSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Total VAT Collected (5%)</td><td ${sumVal}>AED ${totalVAT.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Net Sales (excl. VAT)</td><td ${sumVal}>AED ${netSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Paid Invoices</td><td ${sumVal}>${paidCount}</td></tr>
  ${refundCount > 0 ? `<tr><td ${sumLbl} style="color:#b91c1c;">Refunded Invoices</td><td ${sumVal} style="color:#b91c1c;">${refundCount}</td></tr>` : ''}
</table>

<!-- ── Payment breakdown ──────────────────────────────── -->
<h3 style="color:${cyanDk};margin:16px 0 8px;font-size:13px;">Sales by Payment Method</h3>
<table style="width:360px;margin-bottom:8px;">
  <tr><td ${sumLbl}>💵 Cash</td><td ${sumVal}>AED ${cashSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>💳 Card</td><td ${sumVal}>AED ${cardSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>📱 Tabby</td><td ${sumVal}>AED ${tabbySales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>📝 Cheque</td><td ${sumVal}>AED ${chequeSales.toFixed(2)}</td></tr>
</table>

<!-- ── Cash flow ──────────────────────────────────────── -->
<h3 style="color:${cyanDk};margin:16px 0 8px;font-size:13px;">Cash Flow (Period)</h3>
<table style="width:360px;margin-bottom:20px;">
  <tr><td ${sumLbl}>Cash Sales</td><td ${sumVal}>AED ${cashSales.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Bank Deposits</td><td style="padding:8px 12px;border:1px solid ${border};font-weight:700;background:${white};color:#b91c1c;font-size:12px;text-align:right;">− AED ${totalDeposits.toFixed(2)}</td></tr>
  <tr><td ${sumLbl}>Expenses</td><td style="padding:8px 12px;border:1px solid ${border};font-weight:700;background:${white};color:#b91c1c;font-size:12px;text-align:right;">− AED ${totalExpenses.toFixed(2)}</td></tr>
  <tr>
    <td style="padding:9px 12px;border:1px solid ${border};font-weight:800;background:${cyanDk};color:${white};font-size:13px;">Cash in Hand (period)</td>
    <td style="padding:9px 12px;border:1px solid ${border};font-weight:800;background:${cyanDk};color:${white};font-size:13px;text-align:right;">AED ${cashInHand.toFixed(2)}</td>
  </tr>
</table>

<!-- ── Invoices ───────────────────────────────────────── -->
<h3 style="color:${cyanDk};margin:24px 0 8px;font-size:13px;">Invoices (${invoices.length})</h3>
<table>
  <thead><tr>
    <th ${th}>Invoice #</th><th ${th}>Date</th><th ${th}>Customer</th>
    <th ${thr}>Subtotal</th><th ${thr}>VAT</th><th ${thr}>Total (AED)</th>
    <th ${th}>Payment</th><th ${th}>Status</th>
  </tr></thead>
  <tbody>${invRows || `<tr><td colspan="8" style="padding:10px;color:#6b7280;border:1px solid ${border};">No invoices for this period</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="5" style="padding:7px 11px;font-weight:700;background:${cyanLt};color:${dk};border:1px solid ${border};">Totals</td>
    <td style="padding:7px 11px;font-weight:800;background:${cyanLt};color:${dk};border:1px solid ${border};text-align:right;">AED ${totalSales.toFixed(2)}</td>
    <td colspan="2" style="background:${cyanLt};border:1px solid ${border};"></td>
  </tr></tfoot>
</table>

<!-- ── Deposits ───────────────────────────────────────── -->
<h3 style="color:${cyanDk};margin:28px 0 8px;font-size:13px;">Bank Deposits (${deposits.length})</h3>
<table>
  <thead><tr>
    <th ${th}>Deposit ID</th><th ${th}>Date</th><th ${th}>Depositor</th>
    <th ${th}>Bank</th><th ${thr}>Amount (AED)</th><th ${th}>Slip #</th>
  </tr></thead>
  <tbody>${depRows || `<tr><td colspan="6" style="padding:10px;color:#6b7280;border:1px solid ${border};">No deposits for this period</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="4" style="padding:7px 11px;font-weight:700;background:${cyanLt};color:${dk};border:1px solid ${border};">Total Deposited</td>
    <td style="padding:7px 11px;font-weight:800;background:${cyanLt};color:${dk};border:1px solid ${border};text-align:right;">AED ${totalDeposits.toFixed(2)}</td>
    <td style="background:${cyanLt};border:1px solid ${border};"></td>
  </tr></tfoot>
</table>

<!-- ── Expenses ───────────────────────────────────────── -->
<h3 style="color:${cyanDk};margin:28px 0 8px;font-size:13px;">Expenses (${expenses.length})</h3>
<table>
  <thead><tr>
    <th ${th}>Expense ID</th><th ${th}>Date</th><th ${th}>Description</th>
    <th ${thr}>Amount (AED)</th><th ${th}>Receipt #</th>
  </tr></thead>
  <tbody>${expRows || `<tr><td colspan="5" style="padding:10px;color:#6b7280;border:1px solid ${border};">No expenses for this period</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="3" style="padding:7px 11px;font-weight:700;background:${cyanLt};color:${dk};border:1px solid ${border};">Total Expenses</td>
    <td style="padding:7px 11px;font-weight:800;background:${cyanLt};color:${dk};border:1px solid ${border};text-align:right;">AED ${totalExpenses.toFixed(2)}</td>
    <td style="background:${cyanLt};border:1px solid ${border};"></td>
  </tr></tfoot>
</table>

<p style="margin-top:28px;font-size:10px;color:#9ca3af;border-top:1px solid ${border};padding-top:10px;">
  AKM Music Centre LLC — Generated by AKM-POS on ${formatDate(today,'DD MMM YYYY')} at ${formatTime(today)}
</p>
</body></html>`;

    downloadBlob(html, 'application/vnd.ms-excel', `AKM_Report_${label}.xls`);
    showToast(`Report: ${paidCount} invoices · ${deposits.length} deposits · ${expenses.length} expenses`, 'success');
  } catch (err) {
    console.error('❌ Export error:', err);
    if (err.code === 'failed-precondition') showToast('Index building, try again shortly.', 'warning');
    else showToast('Failed to export data', 'error');
  }
}

// ─── DB Export (SheetJS XLSX) ────────────────────────────────
// Exports ALL data (5-year lookback) to a 3-sheet Excel file.
// Use this to get a clean copy for bulk editing or duplicate cleanup.

window.exportDatabase = async function() {
  if (!requirePin('export full database')) return;
  showToast('Fetching all records…', 'info');
  try {
    const [{ invoices, deposits, expenses }] = await Promise.all([
      getAllDocsForExport(),
      ensureXLSX(),
    ]);
    const XLSX = window.XLSX;

    const wb = XLSX.utils.book_new();

    // ── Invoices sheet ──
    const invRows = [
      ['DocID','Invoice #','Date','Time','Customer','Payment Method',
       'Subtotal','VAT','Grand Total','Cash','Card','Tabby','Cheque','Status','Deleted'],
      ...invoices.map(inv => [
        inv.id,
        inv.invoiceNumber || '',
        inv.date || '',
        (inv.time || '').slice(0, 5),
        inv.customer?.name || 'Walk-in',
        inv.payment?.method || 'Cash',
        +(inv.payment?.subtotal  || 0).toFixed(2),
        +(inv.payment?.vat       || 0).toFixed(2),
        +(inv.payment?.grandTotal|| 0).toFixed(2),
        +(inv.impacts?.cash   || 0).toFixed(2),
        +(inv.impacts?.card   || 0).toFixed(2),
        +(inv.impacts?.tabby  || 0).toFixed(2),
        +(inv.impacts?.cheque || 0).toFixed(2),
        inv.status || 'Paid',
        inv.deleted ? 'YES' : '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invRows), 'Invoices');

    // ── Deposits sheet ──
    const depRows = [
      ['DocID','Deposit ID','Date','Time','Depositor','Bank','Amount','Slip #','Deleted'],
      ...deposits.map(dep => [
        dep.id,
        dep.depositId || '',
        dep.date || '',
        (dep.time || '').slice(0, 5),
        dep.depositor || '',
        dep.bank || '',
        +(dep.amount || 0).toFixed(2),
        dep.slipNumber || '',
        dep.deleted ? 'YES' : '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(depRows), 'Deposits');

    // ── Expenses sheet ──
    const expRows = [
      ['DocID','Expense ID','Date','Time','Description','Amount','Receipt #','Deleted'],
      ...expenses.map(exp => [
        exp.id,
        exp.expenseId || '',
        exp.date || '',
        (exp.time || '').slice(0, 5),
        exp.description || '',
        +(exp.amount || 0).toFixed(2),
        exp.receiptNumber || '',
        exp.deleted ? 'YES' : '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expenses');

    const today = new Date();
    XLSX.writeFile(wb, `AKM_Database_${formatDate(today, 'YYYY-MM-DD_HH-mm')}.xlsx`);
    showToast(`Exported: ${invoices.length} inv · ${deposits.length} dep · ${expenses.length} exp`, 'success');
  } catch (err) {
    console.error('❌ DB export error:', err);
    showToast(err.message?.includes('XLSX') ? err.message : 'Export failed — check your connection and try again', 'error');
  }
};

// ─── DB Import (SheetJS XLSX) ────────────────────────────────
// PIN-protected. Reads the 3-sheet Excel produced by DB Export,
// deletes all existing records, then writes back the rows that remain.
// Use this after removing duplicate rows in Excel.

window.importDatabase = function() {
  document.getElementById('dbImportFile')?.click();
};

function _parseImportDate(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [h = 0, mi = 0, s = 0] = String(timeStr || '00:00').split(':').map(Number);
  const dt = new Date(y, m - 1, d, h, mi, s);
  return isNaN(dt.getTime()) ? null : dt;
}

window.importFileSelected = async function(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  if (!requirePin('import and REPLACE the database')) return;

  showToast('Reading file…', 'info');
  let wb;
  try {
    const [, data] = await Promise.all([ensureXLSX(), file.arrayBuffer()]);
    wb = window.XLSX.read(data, { type: 'array' });
  } catch (err) {
    showToast(err.message?.includes('XLSX') ? err.message : 'Cannot read file — must be a valid .xlsx exported from DB Export', 'error');
    return;
  }

  const parseSheet = name => XLSX.utils.sheet_to_json(wb.Sheets[name] || {});
  const invoiceRows = parseSheet('Invoices');
  const depositRows = parseSheet('Deposits');
  const expenseRows = parseSheet('Expenses');

  if (!invoiceRows.length && !depositRows.length && !expenseRows.length) {
    showToast('File appears empty or sheets not found (need: Invoices, Deposits, Expenses)', 'error');
    return;
  }

  if (!confirm(
    `⚠️ REPLACE ENTIRE DATABASE?\n\n` +
    `This will permanently DELETE all current records and replace with:\n` +
    `  • ${invoiceRows.length} invoices\n` +
    `  • ${depositRows.length} deposits\n` +
    `  • ${expenseRows.length} expenses\n\n` +
    `This CANNOT be undone. Proceed?`
  )) return;

  showToast('Importing — please wait…', 'info');
  try {
    // Map each row to a { id, data } entry for bulkSetDocs
    const invEntries = invoiceRows
      .filter(r => r['DocID'])
      .map(r => {
        const dt = _parseImportDate(r['Date'], r['Time']);
        return {
          id: String(r['DocID']),
          data: {
            invoiceNumber: String(r['Invoice #'] || ''),
            date:          String(r['Date'] || ''),
            time:          String(r['Time'] || '00:00'),
            dateObj:       dt ? Timestamp.fromDate(dt) : serverTimestamp(),
            customer:      { name: String(r['Customer'] || 'Walk-in') },
            payment: {
              method:     String(r['Payment Method'] || 'Cash'),
              subtotal:   +Number(r['Subtotal'] || 0).toFixed(2),
              vat:        +Number(r['VAT'] || 0).toFixed(2),
              grandTotal: +Number(r['Grand Total'] || 0).toFixed(2),
            },
            impacts: {
              cash:   +Number(r['Cash']   || 0).toFixed(2),
              card:   +Number(r['Card']   || 0).toFixed(2),
              tabby:  +Number(r['Tabby']  || 0).toFixed(2),
              cheque: +Number(r['Cheque'] || 0).toFixed(2),
            },
            status:  String(r['Status'] || 'Paid'),
            deleted: r['Deleted'] === 'YES',
          },
        };
      });

    const depEntries = depositRows
      .filter(r => r['DocID'])
      .map(r => {
        const dt = _parseImportDate(r['Date'], r['Time']);
        return {
          id: String(r['DocID']),
          data: {
            depositId:   String(r['Deposit ID'] || ''),
            date:        String(r['Date'] || ''),
            time:        String(r['Time'] || '00:00'),
            dateObj:     dt ? Timestamp.fromDate(dt) : serverTimestamp(),
            depositor:   String(r['Depositor'] || ''),
            bank:        String(r['Bank'] || ''),
            amount:      +Number(r['Amount'] || 0).toFixed(2),
            slipNumber:  String(r['Slip #'] || ''),
            deleted:     r['Deleted'] === 'YES',
          },
        };
      });

    const expEntries = expenseRows
      .filter(r => r['DocID'])
      .map(r => {
        const dt = _parseImportDate(r['Date'], r['Time']);
        return {
          id: String(r['DocID']),
          data: {
            expenseId:     String(r['Expense ID'] || ''),
            date:          String(r['Date'] || ''),
            time:          String(r['Time'] || '00:00'),
            dateObj:       dt ? Timestamp.fromDate(dt) : serverTimestamp(),
            description:   String(r['Description'] || ''),
            amount:        +Number(r['Amount'] || 0).toFixed(2),
            receiptNumber: String(r['Receipt #'] || ''),
            deleted:       r['Deleted'] === 'YES',
          },
        };
      });

    // Delete all then write back
    await Promise.all([
      bulkDeleteCollection('invoices'),
      bulkDeleteCollection('deposits'),
      bulkDeleteCollection('expenses'),
    ]);
    await Promise.all([
      bulkSetDocs('invoices', invEntries),
      bulkSetDocs('deposits', depEntries),
      bulkSetDocs('expenses', expEntries),
    ]);

    invalidateCache();
    await Promise.all([loadDashboardStats(), loadActivityFeed()]);
    showToast(`Imported: ${invEntries.length} inv · ${depEntries.length} dep · ${expEntries.length} exp`, 'success');
  } catch (err) {
    console.error('❌ DB import error:', err);
    showToast('Import failed — database may be in a partial state. Re-import or restore from backup.', 'error');
  }
};

window.createBackup = async function() {
  if (!requirePin('create a backup')) return;
  try {
    showToast('Creating backup (1 year)…', 'info');
    const today = new Date();
    // Fetch a full year of all three types in parallel
    const activity = await getRecentActivity(365);
    const invoices = activity.filter(a => a.type === 'invoice');
    const deposits = activity.filter(a => a.type === 'deposit');
    const expenses = activity.filter(a => a.type === 'expense');

    const backup = {
      backupDate:    today.toISOString(),
      backupVersion: '5.0',
      system:        'AKM-POS',
      data: { invoices, deposits, expenses },
      stats: {
        totalInvoices: invoices.length,
        totalDeposits: deposits.length,
        totalExpenses: expenses.length
      }
    };

    downloadBlob(
      JSON.stringify(backup, null, 2),
      'application/json',
      `AKM_Backup_${formatDate(today, 'YYYY-MM-DD_HH-mm')}.json`
    );
    showToast(`Backup: ${invoices.length} invoices, ${deposits.length} deposits, ${expenses.length} expenses`, 'success');
  } catch (err) {
    console.error('❌ Backup error:', err);
    showToast('Failed to create backup', 'error');
  }
};

// ─── Helpers ─────────────────────────────────────────────────────

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function updateEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── Auth ──────────────────────────────────────────────────────

onAuthStateChanged(auth, (user) => {
  if (user && user.email === ALLOWED_EMAIL) {
    currentUser = user;
    initDashboard();
  } else {
    window.location.href = 'index.html';
  }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'index.html';
});

document.addEventListener('click', (e) => {
  if (!e.target.classList.contains('modal-overlay')) return;
  closeTaxReportModal();
  window.closeExportModal();
  window.closeDbModal();
});
