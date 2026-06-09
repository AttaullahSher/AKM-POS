// dashboard.js - AKM-POS Dashboard Management v3.0
// Handles dashboard analytics, reports, and invoice management

import { auth, onAuthStateChanged, signOut } from './firebase-config.js?v=3.2';
import {
  db,
  getTodayInvoices,
  getTodayDeposits,
  getTodayExpenses,
  getRecentInvoices,
  markInvoiceAsRefunded,
  formatDate,
  formatTime
} from './firestore-utils.js?v=3.2';
import { collection, query, where, orderBy, getDocs, Timestamp } from './firebase-config.js?v=3.2';
import { APP_CONFIG, debugLog } from './config.js?v=3.2';
import { showToast } from './utils.js?v=3.2';

const ALLOWED_EMAIL = APP_CONFIG.ALLOWED_EMAIL;

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
    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(),
      getTodayDeposits(),
      getTodayExpenses()
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
      <td><span class="payment-badge ${inv.payment.toLowerCase()}">${inv.payment}</span></td>
      <td><span class="status-badge ${inv.status.toLowerCase()}">${inv.status}</span></td>
      <td>
        <div class="table-action-buttons">
          <button onclick="reprintInvoice('${inv.id}')" class="btn-table-action btn-view" title="View & Reprint">
            View
          </button>
          ${inv.status !== 'Refunded' ? `
            <button onclick="refundInvoice('${inv.id}', '${inv.invoiceNumber}')" class="btn-table-action btn-refund" title="Refund Invoice">
              Refund
            </button>
          ` : '<span class="refunded-label">Refunded</span>'}
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
  try {
    showToast('Generating daily report...', 'info');

    const today = new Date();

    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(),
      getTodayDeposits(),
      getTodayExpenses()
    ]);
    
    // Calculate totals
    let totalSales = 0, totalVAT = 0;
    let cash = 0, card = 0, tabby = 0, cheque = 0;
    let paidInvoices = 0;
    
    invoices.forEach(inv => {
      if (inv.status === 'Paid') {
        totalSales += inv.payment?.grandTotal || 0;
        totalVAT += inv.payment?.vat || 0;
        cash += inv.impacts?.cash || 0;
        card += inv.impacts?.card || 0;
        tabby += inv.impacts?.tabby || 0;
        cheque += inv.impacts?.cheque || 0;
        paidInvoices++;
      }
    });
    
    const totalDeposits = deposits.reduce((sum, d) => sum + (d.amount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const cashInHand = cash - totalDeposits - totalExpenses;
    
    // Create print window
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Daily Report - ${formatDate(today, 'DD MMM YYYY')}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Montserrat', Arial, sans-serif; 
            padding: 40px; 
            background: white;
            color: #333;
          }
          .report-header { 
            text-align: center; 
            border-bottom: 3px solid #A8C5E6; 
            padding-bottom: 20px; 
            margin-bottom: 30px; 
          }
          .report-header h1 { 
            font-size: 28px; 
            color: #4B5563; 
            margin-bottom: 8px; 
          }
          .report-header .date { 
            font-size: 16px; 
            color: #6B7280; 
            font-weight: 600; 
          }
          .section { 
            margin-bottom: 30px; 
          }
          .section-title { 
            font-size: 18px; 
            font-weight: 700; 
            color: #374151; 
            margin-bottom: 15px; 
            padding-bottom: 8px; 
            border-bottom: 2px solid #E5E7EB; 
          }
          .summary-grid { 
            display: grid; 
            grid-template-columns: repeat(2, 1fr); 
            gap: 15px; 
            margin-bottom: 20px; 
          }
          .summary-item { 
            padding: 15px; 
            background: #F9FAFB; 
            border-radius: 8px; 
            border-left: 4px solid #A8C5E6; 
          }
          .summary-label { 
            font-size: 12px; 
            color: #6B7280; 
            font-weight: 600; 
            text-transform: uppercase; 
            margin-bottom: 5px; 
          }
          .summary-value { 
            font-size: 24px; 
            font-weight: 700; 
            color: #1F2937; 
          }
          .summary-value.highlight { 
            color: #B8E6B8; 
            font-size: 28px; 
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-top: 10px; 
          }
          th, td { 
            padding: 10px; 
            text-align: left; 
            border-bottom: 1px solid #E5E7EB; 
          }
          th { 
            background: #F3F4F6; 
            font-weight: 700; 
            font-size: 13px; 
            color: #374151; 
          }
          td { 
            font-size: 12px; 
            color: #4B5563; 
          }
          .total-row { 
            font-weight: 700; 
            background: #F9FAFB; 
            font-size: 14px; 
          }
          .report-footer { 
            margin-top: 40px; 
            padding-top: 20px; 
            border-top: 2px solid #E5E7EB; 
            text-align: center; 
            font-size: 11px; 
            color: #9CA3AF; 
          }
          @media print {
            body { padding: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="report-header">
          <h1>AKM Music Centre LLC</h1>
          <div class="date">Daily Report - ${formatDate(today, 'DD MMM YYYY')}</div>
        </div>
        
        <div class="section">
          <div class="section-title">📊 Sales Summary</div>
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-label">Total Sales (incl. VAT)</div>
              <div class="summary-value highlight">AED ${totalSales.toFixed(2)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Total VAT (5%)</div>
              <div class="summary-value">AED ${totalVAT.toFixed(2)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Net Sales (excl. VAT)</div>
              <div class="summary-value">AED ${(totalSales - totalVAT).toFixed(2)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Total Invoices</div>
              <div class="summary-value">${paidInvoices}</div>
            </div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">💳 Payment Breakdown</div>
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-label">💵 Cash</div>
              <div class="summary-value">AED ${cash.toFixed(2)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">💳 Card</div>
              <div class="summary-value">AED ${card.toFixed(2)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">📱 Tabby</div>
              <div class="summary-value">AED ${tabby.toFixed(2)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">📝 Cheque</div>
              <div class="summary-value">AED ${cheque.toFixed(2)}</div>
            </div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">💰 Cash Flow</div>
          <table>
            <tr>
              <td>Cash Sales</td>
              <td style="text-align: right; font-weight: 700;">AED ${cash.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Bank Deposits</td>
              <td style="text-align: right; color: #F5B8B8;">- AED ${totalDeposits.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Expenses</td>
              <td style="text-align: right; color: #F5B8B8;">- AED ${totalExpenses.toFixed(2)}</td>
            </tr>
            <tr class="total-row">
              <td>Cash in Hand</td>
              <td style="text-align: right; color: #B8E6B8;">AED ${cashInHand.toFixed(2)}</td>
            </tr>
          </table>
        </div>
        
        ${deposits.length > 0 ? `
        <div class="section">
          <div class="section-title">🏦 Bank Deposits</div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${deposits.map(d => `
                <tr>
                  <td>${formatDate(new Date(d.date), 'DD MMM YYYY')}</td>
                  <td>AED ${d.amount.toFixed(2)}</td>
                  <td>${d.notes || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
        
        ${expenses.length > 0 ? `
        <div class="section">
          <div class="section-title">💸 Expenses</div>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${expenses.map(e => `
                <tr>
                  <td>${e.category || 'General'}</td>
                  <td>${e.description || '-'}</td>
                  <td>AED ${e.amount.toFixed(2)}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td colspan="2">Total Expenses</td>
                <td>AED ${totalExpenses.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ` : ''}
        
        <div class="report-footer">
          <p>Generated on ${formatDate(new Date(), 'DD MMM YYYY')} at ${formatTime(new Date())}</p>
          <p>AKM Music Centre LLC - Point of Sale System</p>
        </div>
        
        <div class="no-print" style="margin-top: 30px; text-align: center;">
          <button onclick="window.print()" style="padding: 12px 24px; background: #A8C5E6; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer;">
            🖨️ Print Report
          </button>
          <button onclick="window.close()" style="padding: 12px 24px; background: #E5E7EB; color: #374151; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; margin-left: 10px;">
            ✖️ Close
          </button>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    showToast('Daily report generated successfully', 'success');
    
  } catch (error) {
    console.error('❌ Error generating daily report:', error);
    showToast('Failed to generate daily report', 'error');
  }
};

window.exportAllData = async function() {
  try {
    showToast('Exporting all data...', 'info');

    const today = new Date();

    // Export last 365 days of invoices + today's deposits and expenses
    const [invoices, deposits, expenses] = await Promise.all([
      getRecentInvoices(365),
      getTodayDeposits(),
      getTodayExpenses()
    ]);
    
    // Create comprehensive CSV export
    let csv = 'AKM Music Centre LLC - Data Export\n';
    csv += `Export Date:,${formatDate(today, 'DD MMM YYYY HH:mm:ss')}\n\n`;
    
    // Invoices
    csv += 'INVOICES\n';
    csv += 'Invoice Number,Date,Customer,Subtotal,VAT,Grand Total,Payment Method,Status,Cash Impact,Card Impact,Tabby Impact,Cheque Impact\n';
    invoices.forEach(inv => {
      csv += `${inv.invoiceNumber},${inv.date},${inv.customer || 'Walk-in'},${inv.payment?.subtotal || 0},${inv.payment?.vat || 0},${inv.payment?.grandTotal || 0},${inv.payment?.method || 'Cash'},${inv.status},${inv.impacts?.cash || 0},${inv.impacts?.card || 0},${inv.impacts?.tabby || 0},${inv.impacts?.cheque || 0}\n`;
    });
    csv += '\n';
    
    // Deposits
    csv += 'BANK DEPOSITS\n';
    csv += 'Date,Amount,Notes\n';
    deposits.forEach(d => {
      csv += `${d.date},${d.amount},"${d.notes || ''}"\n`;
    });
    csv += '\n';
    
    // Expenses
    csv += 'EXPENSES\n';
    csv += 'Date,Category,Description,Amount\n';
    expenses.forEach(e => {
      csv += `${e.date},${e.category || 'General'},"${e.description || ''}",${e.amount}\n`;
    });
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `AKM_Export_${formatDate(today, 'YYYY-MM-DD')}.csv`;
    link.click();
    
    showToast('Data exported successfully', 'success');
    
  } catch (error) {
    console.error('❌ Error exporting data:', error);
    showToast('Failed to export data', 'error');
  }
};

window.createBackup = async function() {
  try {
    showToast('Creating backup...', 'info');
    
    const today = new Date();

    // Get all data for backup
    const [invoices, deposits, expenses] = await Promise.all([
      getRecentInvoices(365),
      getTodayDeposits(),
      getTodayExpenses()
    ]);
    
    const backupData = {
      backupDate: today.toISOString(),
      backupVersion: '1.0',
      system: 'AKM-POS',
      data: {
        invoices: invoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          customer: inv.customer,
          items: inv.items,
          payment: inv.payment,
          status: inv.status,
          impacts: inv.impacts,
          createdAt: inv.createdAt
        })),
        deposits: deposits,
        expenses: expenses
      },
      stats: {
        totalInvoices: invoices.length,
        totalDeposits: deposits.length,
        totalExpenses: expenses.length
      }
    };
    
    // Create JSON backup file
    const jsonBlob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(jsonBlob);
    link.download = `AKM_Backup_${formatDate(today, 'YYYY-MM-DD_HH-mm')}.json`;
    link.click();
    
    showToast(`Backup created: ${invoices.length} invoices, ${deposits.length} deposits, ${expenses.length} expenses`, 'success');
    
  } catch (error) {
    console.error('❌ Error creating backup:', error);
    showToast('Failed to create backup', 'error');
  }
};

// ============================================
// UTILITIES
// ============================================

function updateElement(id, value) {
  const el = document.getElementById(id);  if (el) el.textContent = value;
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
