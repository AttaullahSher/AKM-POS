// dashboard.js — AKM-POS Dashboard v4.0
// Redesign: AKM MUSIC branding, fixed full-history exports, styled Excel export

import { auth, onAuthStateChanged, signOut } from './firebase-config.js';
import {
  db,
  getTodayInvoices,
  getTodayDeposits,
  getTodayExpenses,
  loadRecentDeposits,
  loadRecentExpenses,
  getRecentInvoices,
  markInvoiceAsRefunded,
  formatDate,
  formatTime
} from './firestore-utils.js';
import { collection, query, where, orderBy, getDocs, Timestamp } from './firebase-config.js';
import { APP_CONFIG, debugLog } from './config.js';
import { showToast } from './utils.js';
import { initSyncStatus, notePendingWrite } from './sync-status.js';

const ALLOWED_EMAIL = APP_CONFIG.ALLOWED_EMAIL;

let currentUser        = null;
let currentFilter      = 'all';
let allInvoices        = [];
let currentTaxReport   = null;

const TAX_QUARTERS = {
  Q1: { name: 'Q1: Aug–Nov', months: [8, 9, 10, 11] },
  Q2: { name: 'Q2: Dec–Feb', months: [12, 1, 2] },
  Q3: { name: 'Q3: Mar–May', months: [3, 4, 5] },
  Q4: { name: 'Q4: Jun–Jul', months: [6, 7] }
};

// ─── Initialization ─────────────────────────────────────────────

async function initDashboard() {
  debugLog('🚀 Initializing AKM Dashboard v4.0');
  try {
    initSyncStatus();
    await loadDashboardStats();
    await loadRecentInvoicesTable();
    setInterval(() => loadDashboardStats(), 60000);
    showToast('Dashboard loaded', 'success');
  } catch (err) {
    console.error('❌ Dashboard init error:', err);
    showToast('Error loading dashboard', 'error');
  } finally {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('dashboardApp').style.display  = 'block';
  }
}

// ─── Stats ──────────────────────────────────────────────────────

async function loadDashboardStats() {
  try {
    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(),
      getTodayDeposits(),
      getTodayExpenses()
    ]);

    let totalSales = 0, totalVAT = 0, invoiceCount = 0;
    let cash = 0, card = 0, tabby = 0, cheque = 0;

    invoices.forEach(inv => {
      if (inv.status === 'Paid') {
        totalSales += inv.payment?.grandTotal || 0;
        totalVAT   += inv.payment?.vat        || 0;
        cash       += inv.impacts?.cash       || 0;
        card       += inv.impacts?.card       || 0;
        tabby      += inv.impacts?.tabby      || 0;
        cheque     += inv.impacts?.cheque     || 0;
        invoiceCount++;
      }
    });

    const totalDeposits = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const cashInHand    = cash - totalDeposits - totalExpenses;

    updateEl('todayTotalSales',   totalSales.toFixed(2));
    updateEl('todayInvoiceCount', `${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''}`);
    updateEl('cashInHand',        cashInHand.toFixed(2));
    updateEl('todayVAT',          totalVAT.toFixed(2));
    updateEl('cashSales',         cash.toFixed(2));
    updateEl('cardSales',         card.toFixed(2));
    updateEl('tabbySales',        tabby.toFixed(2));
    updateEl('chequeSales',       cheque.toFixed(2));
  } catch (err) {
    console.error('❌ Stats error:', err);
  }
}

// ─── Invoices Table ──────────────────────────────────────────────

async function loadRecentInvoicesTable() {
  const tbody = document.getElementById('invoicesTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Loading…</td></tr>';
  try {
    allInvoices = await getRecentInvoices(100);
    if (!allInvoices.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No invoices found</td></tr>';
      return;
    }
    filterInvoices(currentFilter);
  } catch (err) {
    console.error('❌ Invoice table error:', err);
    tbody.innerHTML = '<tr><td colspan="7" class="table-error">Error loading invoices</td></tr>';
  }
}

window.filterInvoices = function(filter) {
  currentFilter = filter;
  document.querySelectorAll('.btn-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  let filtered = [...allInvoices];
  const now = new Date();
  if (filter === 'today') {
    const today = formatDate(now, 'YYYY-MM-DD');
    filtered = filtered.filter(inv => inv.date === today);
  } else if (filter === 'week') {
    const cut = new Date(now - 7 * 86400000);
    filtered = filtered.filter(inv => new Date(inv.date) >= cut);
  } else if (filter === 'month') {
    const cut = new Date(now - 30 * 86400000);
    filtered = filtered.filter(inv => new Date(inv.date) >= cut);
  }
  displayInvoices(filtered);
};

function displayInvoices(invoices) {
  const tbody = document.getElementById('invoicesTableBody');
  if (!invoices.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No invoices for this period</td></tr>';
    return;
  }
  tbody.innerHTML = invoices.map(inv => `
    <tr class="${inv.status === 'Refunded' ? 'row-refunded' : ''}">
      <td><strong>${inv.invoiceNumber}</strong></td>
      <td>${formatDate(new Date(inv.date), 'DD MMM YYYY')}</td>
      <td>${inv.customer || 'Walk-in'}</td>
      <td><strong>AED ${(inv.grandTotal || 0).toFixed(2)}</strong></td>
      <td><span class="payment-badge ${(inv.payment || 'cash').toLowerCase()}">${inv.payment || 'Cash'}</span></td>
      <td><span class="status-badge ${(inv.status || 'paid').toLowerCase()}">${inv.status || 'Paid'}</span></td>
      <td>
        <div class="table-action-buttons">
          <button onclick="reprintInvoice('${inv.id}')" class="btn-table-action btn-view">View</button>
          ${inv.status !== 'Refunded' ? `
            <button onclick="refundInvoice('${inv.id}','${inv.invoiceNumber}')" class="btn-table-action btn-refund">Refund</button>
          ` : '<span class="refunded-label">Refunded</span>'}
        </div>
      </td>
    </tr>`).join('');
}

window.reprintInvoice = function(id) { window.location.href = `index.html?reprint=${id}`; };

window.refundInvoice = async function(id, num) {
  if (!confirm(`Refund invoice ${num}?`)) return;
  try {
    await markInvoiceAsRefunded(id);
    notePendingWrite();
    showToast('Invoice refunded', 'success');
    await loadDashboardStats();
    await loadRecentInvoicesTable();
  } catch (err) {
    console.error('❌ Refund error:', err);
    showToast('Failed to refund invoice', 'error');
  }
};

window.loadMoreInvoices = async function() {
  showToast('Loading more invoices…', 'info');
  allInvoices = await getRecentInvoices(200);
  filterInvoices(currentFilter);
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
  const yr = new Date().getFullYear();
  let startDate, endDate;
  if (quarter === 'Q2') {
    startDate = new Date(yr - 1, 11, 1);
    endDate   = new Date(yr, 2, 0);
  } else {
    startDate = new Date(yr, Math.min(...qi.months) - 1, 1);
    endDate   = new Date(yr, Math.max(...qi.months), 0);
  }
  await generateTaxReport(startDate, endDate, qi.name);
};

window.generateCustomDateReport = async function() {
  const from = document.getElementById('taxReportFromDate').valueAsDate;
  const to   = document.getElementById('taxReportToDate').valueAsDate;
  if (!from || !to)  { showToast('Please select both dates', 'error');            return; }
  if (from > to)     { showToast('From date must be before to date', 'error');    return; }
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
      if (inv.status === 'Paid') {
        totalSales   += grandTotal;
        totalVAT     += vat;
        cashSales    += inv.impacts?.cash   || 0;
        cardSales    += inv.impacts?.card   || 0;
        tabbySales   += inv.impacts?.tabby  || 0;
        chequeSales  += inv.impacts?.cheque || 0;
        paidInvoices++;
      } else if (inv.status === 'Refunded') {
        refundedInvoices++;
      }
      return {
        invoiceNumber: inv.invoiceNumber,
        date: inv.date,
        customer: inv.customer?.name || 'Walk-in',
        subtotal, vat, grandTotal,
        payment: inv.payment?.method || 'Cash',
        status: inv.status
      };
    });

    currentTaxReport = {
      periodName, startDate: formatDate(startDate,'YYYY-MM-DD'), endDate: formatDate(endDate,'YYYY-MM-DD'),
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
  // Set endDate to local 23:59:59 so invoices stored at UTC midnight on the last day are included
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

  const cyan    = '#0ea5e9';
  const cyanDk  = '#0369a1';
  const cyanLt  = '#e0f2fe';
  const white   = '#ffffff';
  const darkTxt = '#0c4a6e';
  const midTxt  = '#374151';
  const ltGray  = '#f9fafb';
  const border  = '#e2e8f0';

  const thStyle = `style="background:${cyan};color:${white};font-weight:700;padding:8px 12px;border:1px solid ${cyanDk};font-size:13px;text-align:left;"`;
  const tdStyle = (bg = white) => `style="padding:7px 12px;border:1px solid ${border};font-size:12px;background:${bg};color:${midTxt};"`;
  const tdRight = (bg = white) => `style="padding:7px 12px;border:1px solid ${border};font-size:12px;background:${bg};color:${midTxt};text-align:right;"`;
  const sumLbl  = `style="padding:8px 12px;border:1px solid ${border};font-weight:600;background:${cyanLt};color:${darkTxt};font-size:13px;"`;
  const sumVal  = `style="padding:8px 12px;border:1px solid ${border};font-weight:700;background:${white};color:${darkTxt};font-size:13px;text-align:right;"`;

  const rows = d.invoices.map((inv, i) => {
    const bg = i % 2 === 0 ? white : ltGray;
    const statusColor = inv.status === 'Refunded' ? '#fef2f2' : bg;
    return `<tr>
      <td ${tdStyle(statusColor)}>${inv.invoiceNumber}</td>
      <td ${tdStyle(statusColor)}>${inv.date}</td>
      <td ${tdStyle(statusColor)}>${inv.customer}</td>
      <td ${tdRight(statusColor)}>AED ${inv.subtotal.toFixed(2)}</td>
      <td ${tdRight(statusColor)}>AED ${inv.vat.toFixed(2)}</td>
      <td ${tdRight(statusColor)}><b>AED ${inv.grandTotal.toFixed(2)}</b></td>
      <td ${tdStyle(statusColor)}>${inv.payment}</td>
      <td ${tdStyle(inv.status === 'Refunded' ? '#fef2f2' : statusColor)}>${inv.status}</td>
    </tr>`;
  }).join('');

  const html = `
<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>
  body { font-family: Calibri, Arial, sans-serif; }
  table { border-collapse: collapse; width: 100%; }
</style>
</head>
<body>
<table style="width:100%;margin-bottom:24px;">
  <tr>
    <td style="padding:16px 0;font-size:22px;font-weight:800;color:${cyan};letter-spacing:1px;">🎵 AKM MUSIC</td>
    <td style="text-align:right;padding:16px 0;font-size:12px;color:#6b7280;">AKM Music Centre LLC<br>VAT Registration: UAE</td>
  </tr>
</table>
<table style="width:100%;margin-bottom:20px;border-top:3px solid ${cyan};">
  <tr>
    <td style="padding:10px 0;font-size:18px;font-weight:700;color:${cyanDk};">VAT / Tax Report</td>
    <td style="text-align:right;padding:10px 0;color:#374151;font-size:13px;">Period: <b>${d.periodName}</b></td>
  </tr>
  <tr>
    <td style="padding:0;font-size:12px;color:#6b7280;">From: ${d.startDate} &nbsp;&nbsp; To: ${d.endDate}</td>
    <td style="text-align:right;padding:0;font-size:12px;color:#6b7280;">Exported: ${formatDate(new Date(),'DD MMM YYYY')}</td>
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
  <thead>
    <tr>
      <th ${thStyle}>Invoice #</th>
      <th ${thStyle}>Date</th>
      <th ${thStyle}>Customer</th>
      <th ${thStyle} style="text-align:right;">Subtotal</th>
      <th ${thStyle} style="text-align:right;">VAT</th>
      <th ${thStyle} style="text-align:right;">Total</th>
      <th ${thStyle}>Payment</th>
      <th ${thStyle}>Status</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="3" style="padding:8px 12px;font-weight:700;background:${cyanLt};color:${darkTxt};border:1px solid ${border};">Totals</td>
      <td ${tdRight(cyanLt)} style="font-weight:700;color:${darkTxt};">AED ${(d.totalSales - d.totalVAT).toFixed(2)}</td>
      <td ${tdRight(cyanLt)} style="font-weight:700;color:${darkTxt};">AED ${d.totalVAT.toFixed(2)}</td>
      <td ${tdRight(cyanLt)} style="font-weight:700;color:${darkTxt};">AED ${d.totalSales.toFixed(2)}</td>
      <td colspan="2" style="padding:8px 12px;background:${cyanLt};border:1px solid ${border};"></td>
    </tr>
  </tfoot>
</table>
<p style="margin-top:24px;font-size:11px;color:#9ca3af;border-top:1px solid ${border};padding-top:12px;">
  AKM Music Centre LLC — Generated by AKM-POS v4.0 on ${formatDate(new Date(),'DD MMM YYYY')} at ${formatTime(new Date())}
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
    <meta charset="UTF-8">
    <title>VAT Report — ${d.periodName}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:'Montserrat',Arial,sans-serif; color:#1e293b; font-size:12px; }
      .head { text-align:center; border-bottom:3px solid #0ea5e9; padding-bottom:14px; margin-bottom:18px; }
      .head h1 { font-size:22px; color:#0369a1; letter-spacing:1px; }
      .head .co { font-size:13px; font-weight:600; margin-top:4px; }
      .head .trn { font-size:11px; color:#64748b; margin-top:2px; }
      .head .period { font-size:13px; font-weight:700; margin-top:8px; }
      .head .dates { font-size:11px; color:#64748b; }
      .summary { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
      .sum { flex:1 1 22%; border:1px solid #e2e8f0; border-left:4px solid #0ea5e9; border-radius:6px; padding:10px 12px; background:#f8fafc; }
      .sum .l { font-size:10px; text-transform:uppercase; color:#64748b; font-weight:600; }
      .sum .v { font-size:16px; font-weight:800; color:#0c4a6e; margin-top:3px; }
      .pay { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; margin-bottom:16px; }
      .pay b { color:#0369a1; }
      h2 { font-size:13px; color:#0369a1; margin:12px 0 6px; }
      table { width:100%; border-collapse:collapse; }
      th { background:#0ea5e9; color:#fff; font-size:11px; padding:7px 8px; text-align:left; }
      th.r { text-align:right; }
      td { padding:6px 8px; border-bottom:1px solid #e5e7eb; font-size:11px; }
      td.r { text-align:right; }
      tr.ref td { color:#dc2626; text-decoration:line-through; }
      .foot { margin-top:20px; border-top:1px solid #e5e7eb; padding-top:10px; font-size:10px; color:#94a3b8; text-align:center; }
      .no-print { text-align:center; margin-top:18px; }
      .no-print button { padding:9px 18px; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; }
      @media print { .no-print { display:none; } }
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
      <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th class="r">Subtotal</th><th class="r">VAT</th><th class="r">Total</th><th>Payment</th><th>Status</th></tr></thead>
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

// PIN gate for sensitive data actions (export / backup)
function requirePin(action = 'continue') {
  const pin = window.prompt(`🔒 Enter PIN to ${action}:`);
  if (pin === null) return false;                          // cancelled
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

window.doExport = async function(mode) {
  if (!requirePin('export data')) return;
  let startDate, endDate, label;
  if (mode === 'month') {
    const val = document.getElementById('exportMonth')?.value;   // "YYYY-MM"
    if (!val) { showToast('Pick a month first.', 'error'); return; }
    const [y, m] = val.split('-').map(Number);
    startDate = new Date(y, m - 1, 1);
    endDate   = new Date(y, m, 0);             // last day of that month
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
    showToast(`Exporting (${label})…`, 'info');
    const today = new Date();
    const [invRaw, deposits, expenses] = await Promise.all([
      queryByDateRange('invoices', startDate, endDate),
      queryByDateRange('deposits', startDate, endDate),
      queryByDateRange('expenses', startDate, endDate)
    ]);
    const invoices = invRaw.map(inv => ({
      invoiceNumber: inv.invoiceNumber,
      date:          inv.date,
      customer:      inv.customer?.name || 'Walk-in',
      grandTotal:    inv.payment?.grandTotal || 0,
      payment:       inv.payment?.method || 'Cash',
      status:        inv.status || 'Paid'
    }));

    const cyan = '#0ea5e9', cyanDk = '#0369a1', white = '#ffffff',
          ltGray = '#f9fafb', border = '#e2e8f0', mid = '#374151';
    const thStyle = `style="background:${cyan};color:${white};font-weight:700;padding:8px 12px;border:1px solid ${cyanDk};font-size:12px;"`;
    const td  = (bg = white) => `style="padding:6px 12px;border:1px solid ${border};font-size:12px;background:${bg};color:${mid};"`;
    const tdr = (bg = white) => `style="padding:6px 12px;border:1px solid ${border};font-size:12px;background:${bg};color:${mid};text-align:right;"`;

    const invRows = invoices.map((inv, i) => {
      const bg = i % 2 === 0 ? white : ltGray;
      return `<tr>
        <td ${td(bg)}>${inv.invoiceNumber}</td><td ${td(bg)}>${inv.date}</td>
        <td ${td(bg)}>${inv.customer}</td><td ${tdr(bg)}>${inv.grandTotal.toFixed(2)}</td>
        <td ${td(bg)}>${inv.payment}</td><td ${td(bg)}>${inv.status}</td>
      </tr>`;
    }).join('');

    const depRows = deposits.map((d, i) => {
      const bg = i % 2 === 0 ? white : ltGray;
      return `<tr>
        <td ${td(bg)}>${d.depositId || ''}</td><td ${td(bg)}>${d.date || ''}</td>
        <td ${td(bg)}>${d.depositor || ''}</td><td ${tdr(bg)}>${(d.amount || 0).toFixed(2)}</td>
        <td ${td(bg)}>${d.bank || ''}</td><td ${td(bg)}>${d.slipNumber || ''}</td>
      </tr>`;
    }).join('');

    const expRows = expenses.map((e, i) => {
      const bg = i % 2 === 0 ? white : ltGray;
      return `<tr>
        <td ${td(bg)}>${e.expenseId || ''}</td><td ${td(bg)}>${e.date || ''}</td>
        <td ${td(bg)}>${e.description || ''}</td><td ${tdr(bg)}>${(e.amount || 0).toFixed(2)}</td>
        <td ${td(bg)}>${e.receiptNumber || ''}</td>
      </tr>`;
    }).join('');

    const html = `
<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8"></head>
<body>
<table style="width:100%;margin-bottom:20px;">
  <tr>
    <td style="font-size:22px;font-weight:800;color:${cyan};padding:12px 0;">AKM MUSIC — Data Export</td>
    <td style="text-align:right;font-size:12px;color:#6b7280;padding:12px 0;">Period: <b>${label}</b><br>Exported: ${formatDate(today,'DD MMM YYYY')} ${formatTime(today)}</td>
  </tr>
</table>

<h3 style="color:${cyanDk};margin:20px 0 8px;">Invoices (${invoices.length})</h3>
<table>
  <thead><tr>
    <th ${thStyle}>Invoice #</th><th ${thStyle}>Date</th><th ${thStyle}>Customer</th>
    <th ${thStyle}>Total (AED)</th><th ${thStyle}>Payment</th><th ${thStyle}>Status</th>
  </tr></thead>
  <tbody>${invRows || `<tr><td colspan="6" style="padding:10px;color:#6b7280;">No invoices</td></tr>`}</tbody>
</table>

<h3 style="color:${cyanDk};margin:28px 0 8px;">Bank Deposits (${deposits.length})</h3>
<table>
  <thead><tr>
    <th ${thStyle}>ID</th><th ${thStyle}>Date</th><th ${thStyle}>Depositor</th>
    <th ${thStyle}>Amount (AED)</th><th ${thStyle}>Bank</th><th ${thStyle}>Slip #</th>
  </tr></thead>
  <tbody>${depRows || `<tr><td colspan="6" style="padding:10px;color:#6b7280;">No deposits</td></tr>`}</tbody>
</table>

<h3 style="color:${cyanDk};margin:28px 0 8px;">Expenses (${expenses.length})</h3>
<table>
  <thead><tr>
    <th ${thStyle}>ID</th><th ${thStyle}>Date</th>
    <th ${thStyle}>Description</th><th ${thStyle}>Amount (AED)</th><th ${thStyle}>Receipt #</th>
  </tr></thead>
  <tbody>${expRows || `<tr><td colspan="5" style="padding:10px;color:#6b7280;">No expenses</td></tr>`}</tbody>
</table>

<p style="margin-top:24px;font-size:11px;color:#9ca3af;border-top:1px solid ${border};padding-top:12px;">
  AKM Music Centre LLC — AKM-POS
</p>
</body></html>`;

    downloadBlob(html, 'application/vnd.ms-excel', `AKM_Export_${label}.xls`);
    showToast(`Exported (${label}): ${invoices.length} invoices, ${deposits.length} deposits, ${expenses.length} expenses`, 'success');
  } catch (err) {
    console.error('❌ Export error:', err);
    if (err.code === 'failed-precondition') showToast('Index building, try again shortly.', 'warning');
    else showToast('Failed to export data', 'error');
  }
}

window.createBackup = async function() {
  if (!requirePin('create a backup')) return;
  try {
    showToast('Creating backup…', 'info');
    const today = new Date();
    const [invoices, deposits, expenses] = await Promise.all([
      getRecentInvoices(365),
      loadRecentDeposits(365),
      loadRecentExpenses(365)
    ]);

    const backup = {
      backupDate:    today.toISOString(),
      backupVersion: '4.0',
      system:        'AKM-POS',
      data: { invoices, deposits, expenses },
      stats: {
        totalInvoices: invoices.length,
        totalDeposits: deposits.length,
        totalExpenses: expenses.length
      }
    };

    downloadBlob(JSON.stringify(backup, null, 2), 'application/json', `AKM_Backup_${formatDate(today,'YYYY-MM-DD_HH-mm')}.json`);
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
  if (e.target.classList.contains('modal-overlay')) closeTaxReportModal();
});
