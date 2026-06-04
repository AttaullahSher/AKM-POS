// dashboard.js - AKM-POS Dashboard Management
// Handles dashboard analytics, reports, and invoice management
// v2.1 - Centralized Configuration

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  db,
  getTodayInvoices,
  getTodayDeposits,
  getTodayExpenses,
  getRecentInvoices,
  markInvoiceAsRefunded,
  formatDate,
  formatTime
} from './firestore-utils.js';
import { collection, query, where, orderBy, getDocs, Timestamp } from './firebase-config.js';
import { FIREBASE_CONFIG, APP_CONFIG, debugLog } from './config.js';

const ALLOWED_EMAIL = APP_CONFIG.ALLOWED_EMAIL;
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let currentUser = null;
let currentFilter = 'all';
let allInvoices = [];
let currentTaxReportData = null;

// UAE Financial Quarters
const TAX_QUARTERS = {
  Q1: { name: 'Q1: Aug-Nov', months: [8, 9, 10, 11] },
  Q2: { name: 'Q2: Dec-Feb', months: [12, 1, 2] },
  Q3: { name: 'Q3: Mar-May', months: [3, 4, 5] },
  Q4: { name: 'Q4: Jun-Jul', months: [6, 7] }
};

// ============================================
// INITIALIZATION
// ============================================

async function initDashboard() {
  console.log('🚀 Initializing dashboard...');
  
  try {
    await loadDashboardStats();
    await loadRecentInvoicesTable();
    
    // Auto-refresh every 30 seconds
    setInterval(async () => {
      await loadDashboardStats();
      if (currentFilter === 'today' || currentFilter === 'all') {
        await loadRecentInvoicesTable();
      }
    }, 30000);
    
    console.log('✅ Dashboard initialized');
    showToast('Dashboard loaded successfully', 'success');
    
  } catch (error) {
    console.error('❌ Dashboard initialization error:', error);
    showToast('Error loading dashboard', 'error');
  } finally {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('dashboardApp').style.display = 'block';
  }
}

// ============================================
// DASHBOARD STATS
// ============================================

async function loadDashboardStats() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    
    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(today),
      getTodayDeposits(today),
      getTodayExpenses(today)
    ]);
    
    // Calculate stats
    let totalSales = 0, totalVAT = 0;
    let cash = 0, card = 0, tabby = 0, cheque = 0;
    let invoiceCount = 0;
    
    invoices.forEach(inv => {
      if (inv.status === 'Paid') {
        totalSales += inv.payment?.grandTotal || 0;
        totalVAT += inv.payment?.vat || 0;
        cash += inv.impacts?.cash || 0;
        card += inv.impacts?.card || 0;
        tabby += inv.impacts?.tabby || 0;
        cheque += inv.impacts?.cheque || 0;
        invoiceCount++;
      }
    });
    
    const totalDeposits = deposits.reduce((sum, d) => sum + (d.amount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const cashInHand = cash - totalDeposits - totalExpenses;
    
    // Update UI
    updateElement('todayTotalSales', totalSales.toFixed(2));
    updateElement('todayInvoiceCount', `${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''}`);
    updateElement('cashInHand', cashInHand.toFixed(2));
    updateElement('todayVAT', totalVAT.toFixed(2));
    updateElement('cashSales', cash.toFixed(2));
    updateElement('cardSales', card.toFixed(2));
    updateElement('tabbySales', tabby.toFixed(2));
    updateElement('chequeSales', cheque.toFixed(2));
    
    // Load repair stats
    await loadRepairStats();
    
  } catch (error) {
    console.error('❌ Error loading stats:', error);
  }
}

async function loadRepairStats() {
  try {
    const repairsRef = collection(db, 'repairs');
    const q = query(repairsRef, where('status', '==', 'InProcess'), orderBy('dateObj', 'desc'));
    const snapshot = await getDocs(q);
    
    updateElement('pendingRepairs', snapshot.size.toString());
  } catch (error) {
    console.error('Error loading repair stats:', error);
    updateElement('pendingRepairs', '0');
  }
}

// ============================================
// INVOICES TABLE
// ============================================

async function loadRecentInvoicesTable() {
  try {
    const tbody = document.getElementById('invoicesTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Loading...</td></tr>';
    
    allInvoices = await getRecentInvoices(100);
    
    if (!allInvoices || allInvoices.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No invoices found</td></tr>';
      return;
    }
    
    filterInvoices(currentFilter);
    
  } catch (error) {
    console.error('❌ Error loading invoices:', error);
    const tbody = document.getElementById('invoicesTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="table-error">Error loading invoices</td></tr>';
  }
}

window.filterInvoices = function(filter) {
  currentFilter = filter;
  
  // Update filter buttons
  document.querySelectorAll('.btn-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  
  let filtered = [...allInvoices];
  const now = new Date();
  
  if (filter === 'today') {
    const today = formatDate(now, 'YYYY-MM-DD');
    filtered = filtered.filter(inv => inv.date === today);
  } else if (filter === 'week') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(inv => new Date(inv.date) >= weekAgo);
  } else if (filter === 'month') {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(inv => new Date(inv.date) >= monthAgo);
  }
  
  displayInvoices(filtered);
};

function displayInvoices(invoices) {
  const tbody = document.getElementById('invoicesTableBody');
  
  if (invoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No invoices for this period</td></tr>';
    return;
  }
  
  tbody.innerHTML = invoices.map(inv => `
    <tr class="${inv.status === 'Refunded' ? 'row-refunded' : ''}">
      <td><strong>${inv.invoiceNumber}</strong></td>
      <td>${formatDate(new Date(inv.date), 'DD MMM YYYY')}</td>
      <td>${inv.customer || 'Walk-in'}</td>
      <td><strong>AED ${inv.grandTotal.toFixed(2)}</strong></td>
      <td><span class="badge badge-${inv.payment.toLowerCase()}">${inv.payment}</span></td>
      <td><span class="status-badge status-${inv.status.toLowerCase()}">${inv.status}</span></td>
      <td>
        <div class="action-buttons">
          <button onclick="reprintInvoice('${inv.id}')" class="btn-action btn-reprint" title="Reprint">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 5.33333V2.66667C4 2.48986 4.07024 2.32029 4.19526 2.19526C4.32029 2.07024 4.48986 2 4.66667 2H11.3333C11.5101 2 11.6797 2.07024 11.8047 2.19526C11.9298 2.32029 12 2.48986 12 2.66667V5.33333M4 11.3333H3.33333C2.97971 11.3333 2.64057 11.1929 2.39052 10.9428C2.14048 10.6928 2 10.3536 2 10V7.33333C2 6.97971 2.14048 6.64057 2.39052 6.39052C2.64057 6.14048 2.97971 6 3.33333 6H12.6667C13.0203 6 13.3594 6.14048 13.6095 6.39052C13.8595 6.64057 14 6.97971 14 7.33333V10C14 10.3536 13.8595 10.6928 13.6095 10.9428C13.3594 11.1929 13.0203 11.3333 12.6667 11.3333H12M4.66667 9.33333H11.3333V13.3333C11.3333 13.5101 11.2631 13.6797 11.1381 13.8047C11.013 13.9298 10.8435 14 10.6667 14H5.33333C5.15652 14 4.98695 13.9298 4.86193 13.8047C4.7369 13.6797 4.66667 13.5101 4.66667 13.3333V9.33333Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          ${inv.status !== 'Refunded' ? `
            <button onclick="refundInvoice('${inv.id}', '${inv.invoiceNumber}')" class="btn-action btn-refund" title="Refund">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M10 6L6 10M6 6l4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

window.reprintInvoice = function(invoiceId) {
  // Open POS with reprint mode
  window.location.href = `index.html?reprint=${invoiceId}`;
};

window.refundInvoice = async function(invoiceId, invoiceNumber) {
  if (!confirm(`Are you sure you want to refund invoice ${invoiceNumber}?`)) {
    return;
  }
  
  try {
    await markInvoiceAsRefunded(invoiceId);
    showToast('Invoice refunded successfully', 'success');
    await loadDashboardStats();
    await loadRecentInvoicesTable();
  } catch (error) {
    console.error('❌ Error refunding invoice:', error);
    showToast('Failed to refund invoice', 'error');
  }
};

window.loadMoreInvoices = async function() {
  showToast('Loading more invoices...', 'info');
  const moreInvoices = await getRecentInvoices(200);
  allInvoices = moreInvoices;
  filterInvoices(currentFilter);
};

// ============================================
// TAX REPORTS
// ============================================

window.openTaxReportModal = function() {
  const modal = document.getElementById('taxReportModal');
  modal.classList.add('show');
  
  // Set default dates to current month
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  document.getElementById('taxReportFromDate').valueAsDate = firstDay;
  document.getElementById('taxReportToDate').valueAsDate = lastDay;
};

window.closeTaxReportModal = function() {
  document.getElementById('taxReportModal').classList.remove('show');
};

window.generateQuarterlyReport = async function(quarter) {
  const quarterInfo = TAX_QUARTERS[quarter];
  if (!quarterInfo) return;

  const currentYear = new Date().getFullYear();
  const months = quarterInfo.months;
  
  let startDate, endDate;
  
  if (quarter === 'Q2') {
    startDate = new Date(currentYear - 1, 11, 1);
    endDate = new Date(currentYear, 2, 0);
  } else {
    const firstMonth = Math.min(...months);
    const lastMonth = Math.max(...months);
    startDate = new Date(currentYear, firstMonth - 1, 1);
    endDate = new Date(currentYear, lastMonth, 0);
  }

  await generateTaxReport(startDate, endDate, quarterInfo.name);
};

window.generateCustomDateReport = async function() {
  const fromDate = document.getElementById('taxReportFromDate').valueAsDate;
  const toDate = document.getElementById('taxReportToDate').valueAsDate;
  
  if (!fromDate || !toDate) {
    showToast('Please select both dates', 'error');
    return;
  }

  if (fromDate > toDate) {
    showToast('From date must be before to date', 'error');
    return;
  }

  const periodName = `${formatDate(fromDate, 'DD MMM YYYY')} - ${formatDate(toDate, 'DD MMM YYYY')}`;
  await generateTaxReport(fromDate, toDate, periodName);
};

async function generateTaxReport(startDate, endDate, periodName) {
  try {
    showToast('Generating tax report...', 'info');
    
    const invoices = await queryInvoicesByDateRange(startDate, endDate);
    
    if (!invoices || invoices.length === 0) {
      showToast('No invoices found for this period', 'warning');
      document.getElementById('taxReportDisplay').style.display = 'none';
      return;
    }

    let totalSales = 0, totalVAT = 0;
    let cashSales = 0, cardSales = 0, tabbySales = 0, chequeSales = 0;
    let refundedInvoices = 0, paidInvoices = 0;

    const invoiceDetails = invoices.map(inv => {
      const subtotal = inv.payment?.subtotal || 0;
      const vat = inv.payment?.vat || 0;
      const grandTotal = inv.payment?.grandTotal || 0;

      if (inv.status === 'Paid') {
        totalSales += grandTotal;
        totalVAT += vat;
        paidInvoices++;
        cashSales += inv.impacts?.cash || 0;
        cardSales += inv.impacts?.card || 0;
        tabbySales += inv.impacts?.tabby || 0;
        chequeSales += inv.impacts?.cheque || 0;
      } else if (inv.status === 'Refunded') {
        refundedInvoices++;
      }

      return {
        invoiceNumber: inv.invoiceNumber,
        date: inv.date,
        customer: inv.customer?.name || 'Walk-in',
        subtotal,
        vat,
        grandTotal,
        payment: inv.payment?.method || 'Cash',
        status: inv.status
      };
    });

    currentTaxReportData = {
      periodName,
      startDate: formatDate(startDate, 'YYYY-MM-DD'),
      endDate: formatDate(endDate, 'YYYY-MM-DD'),
      totalSales,
      totalVAT,
      cashSales,
      cardSales,
      tabbySales,
      chequeSales,
      paidInvoices,
      refundedInvoices,
      invoices: invoiceDetails
    };

    displayTaxReport(currentTaxReportData);
    showToast('Tax report generated successfully', 'success');
    
  } catch (error) {
    console.error('❌ Error generating tax report:', error);
    showToast('Failed to generate tax report', 'error');
  }
}

async function queryInvoicesByDateRange(startDate, endDate) {
  const invoicesRef = collection(db, 'invoices');
  const startTimestamp = Timestamp.fromDate(startDate);
  const endTimestamp = Timestamp.fromDate(endDate);
  
  const q = query(
    invoicesRef,
    where('dateObj', '>=', startTimestamp),
    where('dateObj', '<=', endTimestamp),
    orderBy('dateObj', 'desc')
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function displayTaxReport(data) {
  const container = document.getElementById('taxReportContent');
  
  container.innerHTML = `
    <div class="tax-report">
      <h3>${data.periodName}</h3>
      <p class="report-period">${data.startDate} to ${data.endDate}</p>
      
      <div class="report-summary">
        <div class="summary-item">
          <div class="summary-label">Total Sales (incl. VAT)</div>
          <div class="summary-value">AED ${data.totalSales.toFixed(2)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total VAT (5%)</div>
          <div class="summary-value">AED ${data.totalVAT.toFixed(2)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Net Sales (excl. VAT)</div>
          <div class="summary-value">AED ${(data.totalSales - data.totalVAT).toFixed(2)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total Invoices</div>
          <div class="summary-value">${data.paidInvoices}</div>
        </div>
      </div>

      <div class="payment-breakdown">
        <div class="breakdown-item">💵 Cash: <strong>AED ${data.cashSales.toFixed(2)}</strong></div>
        <div class="breakdown-item">💳 Card: <strong>AED ${data.cardSales.toFixed(2)}</strong></div>
        <div class="breakdown-item">📱 Tabby: <strong>AED ${data.tabbySales.toFixed(2)}</strong></div>
        <div class="breakdown-item">📝 Cheque: <strong>AED ${data.chequeSales.toFixed(2)}</strong></div>
      </div>

      ${data.refundedInvoices > 0 ? `
        <div class="refund-notice">Refunded Invoices: ${data.refundedInvoices}</div>
      ` : ''}

      <h4>Invoice Details</h4>
      <table class="report-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Subtotal</th>
            <th>VAT</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.invoices.map(inv => `
            <tr class="${inv.status === 'Refunded' ? 'refunded-row' : ''}">
              <td>${inv.invoiceNumber}</td>
              <td>${inv.date}</td>
              <td>${inv.customer}</td>
              <td>AED ${inv.subtotal.toFixed(2)}</td>
              <td>AED ${inv.vat.toFixed(2)}</td>
              <td><strong>AED ${inv.grandTotal.toFixed(2)}</strong></td>
              <td>${inv.payment}</td>
              <td><span class="status-${inv.status.toLowerCase()}">${inv.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('taxReportDisplay').style.display = 'block';
}

window.exportTaxReportCSV = function() {
  if (!currentTaxReportData) {
    showToast('No report data to export', 'error');
    return;
  }

  const data = currentTaxReportData;
  let csv = 'AKM Music Centre LLC - VAT/Tax Report\n';
  csv += `Period:,${data.periodName}\n`;
  csv += `From:,${data.startDate}\n`;
  csv += `To:,${data.endDate}\n\n`;
  csv += `Summary\n`;
  csv += `Total Sales (incl. VAT),AED ${data.totalSales.toFixed(2)}\n`;
  csv += `Total VAT (5%),AED ${data.totalVAT.toFixed(2)}\n`;
  csv += `Net Sales (excl. VAT),AED ${(data.totalSales - data.totalVAT).toFixed(2)}\n`;
  csv += `Total Invoices,${data.paidInvoices}\n\n`;
  csv += `Payment Breakdown\n`;
  csv += `Cash,AED ${data.cashSales.toFixed(2)}\n`;
  csv += `Card,AED ${data.cardSales.toFixed(2)}\n`;
  csv += `Tabby,AED ${data.tabbySales.toFixed(2)}\n`;
  csv += `Cheque,AED ${data.chequeSales.toFixed(2)}\n\n`;
  csv += `Invoice Details\n`;
  csv += `Invoice Number,Date,Customer,Subtotal,VAT,Total,Payment Method,Status\n`;
  
  data.invoices.forEach(inv => {
    csv += `${inv.invoiceNumber},${inv.date},${inv.customer},${inv.subtotal.toFixed(2)},${inv.vat.toFixed(2)},${inv.grandTotal.toFixed(2)},${inv.payment},${inv.status}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `VAT_Report_${data.startDate}_to_${data.endDate}.csv`;
  link.click();
  
  showToast('CSV exported successfully', 'success');
};

window.exportTaxReportExcel = function() {
  if (!currentTaxReportData) {
    showToast('No report data to export', 'error');
    return;
  }

  const data = currentTaxReportData;
  let html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel">';
  html += '<head><meta charset="UTF-8"><style>table{border-collapse:collapse;}th,td{border:1px solid #000;padding:5px;}</style></head>';
  html += '<body>';
  html += '<h2>AKM Music Centre LLC - VAT/Tax Report</h2>';
  html += `<p><strong>Period:</strong> ${data.periodName}</p>`;
  html += `<p><strong>From:</strong> ${data.startDate} | <strong>To:</strong> ${data.endDate}</p><br>`;
  html += '<h3>Summary</h3><table>';
  html += `<tr><td>Total Sales (incl. VAT)</td><td>AED ${data.totalSales.toFixed(2)}</td></tr>`;
  html += `<tr><td>Total VAT (5%)</td><td>AED ${data.totalVAT.toFixed(2)}</td></tr>`;
  html += `<tr><td>Net Sales (excl. VAT)</td><td>AED ${(data.totalSales - data.totalVAT).toFixed(2)}</td></tr>`;
  html += `<tr><td>Total Invoices</td><td>${data.paidInvoices}</td></tr>`;
  html += '</table><br><h3>Invoice Details</h3><table>';
  html += '<tr><th>Invoice #</th><th>Date</th><th>Customer</th><th>Subtotal</th><th>VAT</th><th>Total</th><th>Payment</th><th>Status</th></tr>';
  
  data.invoices.forEach(inv => {
    html += `<tr><td>${inv.invoiceNumber}</td><td>${inv.date}</td><td>${inv.customer}</td><td>${inv.subtotal.toFixed(2)}</td><td>${inv.vat.toFixed(2)}</td><td>${inv.grandTotal.toFixed(2)}</td><td>${inv.payment}</td><td>${inv.status}</td></tr>`;
  });
  
  html += '</table></body></html>';

  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `VAT_Report_${data.startDate}_to_${data.endDate}.xls`;
  link.click();
  
  showToast('Excel file exported successfully', 'success');
};

window.printTaxReport = function() {
  if (!currentTaxReportData) {
    showToast('No report to print', 'error');
    return;
  }
  window.print();
};

// ============================================
// OTHER ACTIONS
// ============================================

window.printDailyReport = async function() {
  showToast('Daily report feature coming soon', 'info');
};

window.exportAllData = async function() {
  showToast('Export all data feature coming soon', 'info');
};

window.createBackup = async function() {
  showToast('Firestore backup feature coming soon', 'info');
};

// ============================================
// UTILITIES
// ============================================

function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.className = `toast show toast-${type}`;
  
  setTimeout(() => {
    toast.className = 'toast';
  }, 4000);
}

// ============================================
// AUTH
// ============================================

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

// Modal click outside to close
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeTaxReportModal();
  }
});
