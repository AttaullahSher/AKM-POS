// Firebase configuration - CONFIGURED ✅ [Updated: 2025-12-04 - CORRECT PROJECT]
const firebaseConfig = {
  apiKey: "AIzaSyBaaHya8oqfJEOycvAsKU_Ise3s2VAgqgw",
  authDomain: "akm-pos-480210.firebaseapp.com",
  projectId: "akm-pos-480210",
  storageBucket: "akm-pos-480210.firebasestorage.app",
  messagingSenderId: "694436741738",
  appId: "1:694436741738:web:8852f92a451f13fbc00013"
};

// Google Sheets configuration - CONFIGURED ✅
const SPREADSHEET_ID = "1QS7iSSq1sd948l2qQ-nI_qYuOWNsXs6UFkFAOd72QKM";
const ALLOWED_EMAIL = "sales@akm-music.com";

// API Server URL - Auto-detect environment
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = IS_LOCAL 
  ? 'http://localhost:3000' 
  : 'https://us-central1-akm-pos-480210.cloudfunctions.net';

const WRITE_ENDPOINT = `${API_BASE_URL}/writeToSheet`;
const READ_ENDPOINT = `${API_BASE_URL}/readSheet`;

// Import Firebase modules (will be loaded from CDN in production)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  hd: 'akm-music.com' // Restrict to your domain
});

// Global state
let currentUser = null;
let currentPaymentMethod = null; // No default payment method
let invoiceCounter = 15001; // Starting invoice number (YYYY-Sequence format)
let recentInvoicesDays = 7;

// ===== Initialize App =====
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 AKM-POS initializing...');
  // Set up auth state listener
  onAuthStateChanged(auth, (user) => {
    console.log('🔐 Auth state changed:', user ? user.email : 'No user');
    
    if (user && user.email === ALLOWED_EMAIL) {
      console.log('✅ User authenticated:', user.email);
      currentUser = user;
      showMainApp();
      initializePOS();
    } else if (user) {
      console.warn('⚠️ Unauthorized email:', user.email);
      showToast('Unauthorized email. Only sales@akm-music.com can access.', 'error');
      signOut(auth);
      showLoginScreen();
    } else {
      console.log('ℹ️ No user signed in');
      showLoginScreen();
    }
  });
  // Set up sign-in button
  document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
  
  // Set up logout button
  document.getElementById('logoutBtn').addEventListener('click', logout);
  
  // Set today's date
  document.getElementById('invDate').valueAsDate = new Date();
  
  // Add 3 initial rows
  for (let i = 0; i < 3; i++) {
    addItemRow();
  }
  
  // Set up input listeners for calculations
  document.addEventListener('input', (e) => {
    if (e.target.matches('.item-qty, .item-price')) {
      calculateTotals();
    }  
  });

  // Set up real-time validation
  setupRealtimeValidation();
});

// ===== Authentication =====
async function signInWithGoogle() {
  try {
    console.log('🔑 Opening Google sign-in popup...');
    const result = await signInWithPopup(auth, provider);
    console.log('✅ User signed in:', result.user.email);
    showToast('Signed in successfully!', 'success');
    // onAuthStateChanged will fire automatically
  } catch (error) {
    console.error('❌ Sign-in error:', error);
    showToast('Sign-in failed: ' + error.message, 'error');
  }
}

async function logout() {
  try {
    await signOut(auth);
    showLoginScreen();
    showToast('Logged out successfully', 'success');
  } catch (error) {
    console.error('Logout error:', error);
    showToast('Logout failed', 'error');
  }
}

// ===== UI State Management =====
function showLoginScreen() {
  console.log('📱 Showing login screen');
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
  console.log('📱 Showing main app');
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
}

// ===== Initialize Main App =====
async function initializePOS() {
  console.log('🎬 Initializing main app...');
  
  // Load data sequentially to avoid rate limiting
  await loadNextInvoiceNumber();
  await loadDashboardData(); // Uses batch reading (1 API call for 3 ranges)
  await loadRecentInvoices();
  
  setupRealtimeValidation(); // Setup input validation
  document.getElementById('custName').focus();
}

// ===== Google Sheets Functions (Using API Key - Sheet is Public) =====

// Request queue to prevent rate limiting
let requestQueue = [];
let isProcessingQueue = false;
const REQUEST_DELAY = 200; // 200ms delay between requests

async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (requestQueue.length > 0) {
    const { resolve, reject, fn } = requestQueue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
    
    // Add delay between requests to avoid rate limiting
    if (requestQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
    }
  }
  
  isProcessingQueue = false;
}

function queueRequest(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, fn });
    processRequestQueue();
  });
}

// Batch read multiple ranges in a single API call
async function readSheetBatch(ranges) {
  try {
    // Use API Server for read operations
    const response = await fetch(READ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ranges: ranges
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to read data');
    }
    
    console.log(`✅ Batch read ${ranges.length} ranges`);
    
    // Return object with range names as keys
    const result = {};
    data.valueRanges.forEach((valueRange, index) => {
      result[ranges[index]] = valueRange.values || [];
    });
    
    return result;
  } catch (error) {
    console.error('Error batch reading sheets:', error);
    showToast('Error reading data from sheet. Make sure proxy server is running.', 'error');
    return null;
  }
}

async function readSheet(range) {
  return queueRequest(async () => {
    try {
      // Use API Server for read operations
      const response = await fetch(READ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          range: range
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to read data');
      }
      
      console.log(`✅ Read ${(data.values || []).length} rows from ${range}`);
      return data.values || [];
    } catch (error) {
      console.error('Error reading sheet:', error);
      showToast('Error reading data from sheet. Make sure proxy server is running.', 'error');
      return null;
    }
  });
}

async function appendToSheet(range, values) {
  try {
    // Use API Server for write operations
    const response = await fetch(WRITE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'append',
        sheetName: range,
        values: values
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || 'Failed to append data');
    }
    
    console.log('✅ Data appended successfully');
    return true;
  } catch (error) {
    console.error('Error appending to sheet:', error);
    showToast('Error saving data to sheet. Make sure proxy server is running.', 'error');
    return false;
  }
}

async function updateSheet(range, values) {
  try {    // Extract sheet name and cell range from the full range
    const [sheetName, cellRange] = range.includes('!') ? range.split('!') : [range, ''];
    
    // Use API Server for write operations
    const response = await fetch(WRITE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'update',
        sheetName: sheetName.replace(/'/g, ''), // Remove quotes from sheet name
        range: cellRange,
        values: values
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || 'Failed to update data');
    }
    
    console.log('✅ Data updated successfully');
    return true;
  } catch (error) {
    console.error('Error updating sheet:', error);
    showToast('Error updating sheet. Make sure proxy server is running.', 'error');
    return false;
  }
}

// ===== Invoice Number Management =====
async function loadNextInvoiceNumber() {
  const data = await readSheet("'AKM-POS'!A:A");
  const currentYear = new Date().getFullYear();
  
  if (!data || data.length <= 1) {
    invoiceCounter = 15001;
  } else {
    const lastInvoice = data[data.length - 1][0];
    // Extract year and sequence from format: YYYY-XXXXX
    const match = lastInvoice.match(/(\d{4})-(\d+)/);
    if (match) {
      const lastYear = parseInt(match[1]);
      const lastSequence = parseInt(match[2]);
      
      // If same year, increment sequence; if new year, reset to 15001
      if (lastYear === currentYear) {
        invoiceCounter = lastSequence + 1;
      } else {
        invoiceCounter = 15001;
      }
    } else {
      invoiceCounter = 15001;
    }
  }
  
  document.getElementById('invNum').textContent = `${currentYear}-${String(invoiceCounter).padStart(5, '0')}`;
}

// ===== Dashboard Data =====
async function loadDashboardData() {
  const today = formatDate(new Date(), 'YYYY-MM-DD');
  
  // Batch read all required ranges in a single API call
  const batchData = await readSheetBatch([
    "'AKM-POS'!A:S",
    "Deposits!A:G",
    "Expenses!A:I"
  ]);
  
  if (!batchData) {
    updateDashboard({ cash: 0, card: 0, tabby: 0, cheque: 0, cashInHand: 0 });
    return;
  }
  
  const data = batchData["'AKM-POS'!A:S"] || [];
  const deposits = batchData["Deposits!A:G"] || [];
  const expenses = batchData["Expenses!A:I"] || [];
  
  if (data.length <= 1) {
    updateDashboard({ cash: 0, card: 0, tabby: 0, cheque: 0, cashInHand: 0 });
    return;
  }
  
  let cashSales = 0;
  let cardSales = 0;
  let tabbySales = 0;
  let chequeSales = 0;
  let totalCashIn = 0;
  let totalCashOut = 0;
  
  // Calculate from invoices
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[1]; // Date column
    const paymentMethod = row[6]; // PaymentMethod column
    const grandTotal = parseFloat(row[9]) || 0; // GrandTotal column
    const status = row[14]; // Status column
    const cashImpact = parseFloat(row[15]) || 0; // CashImpact column
    
    if (date === today && status !== 'Refunded') {
      if (paymentMethod === 'Cash') cashSales += grandTotal;
      else if (paymentMethod === 'Card') cardSales += grandTotal;
      else if (paymentMethod === 'Tabby') tabbySales += grandTotal;
      else if (paymentMethod === 'Cheque') chequeSales += grandTotal;
    }
    
    // Cash in hand calculation (all time)
    if (status !== 'Refunded') {
      totalCashIn += cashImpact;
    }
  }
  
  // Get deposits
  if (deposits.length > 1) {
    for (let i = 1; i < deposits.length; i++) {
      const cashImpact = parseFloat(deposits[i][6]) || 0;
      totalCashOut += Math.abs(cashImpact);
    }
  }
  
  // Get expenses
  if (expenses.length > 1) {
    for (let i = 1; i < expenses.length; i++) {
      const cashImpact = parseFloat(expenses[i][8]) || 0;
      totalCashOut += Math.abs(cashImpact);
    }
  }
  
  const cashInHand = totalCashIn - totalCashOut;
  
  updateDashboard({
    cash: cashSales,
    card: cardSales,
    tabby: tabbySales,
    cheque: chequeSales,
    cashInHand: cashInHand
  });
}

function updateDashboard(data) {
  document.getElementById('cashSales').textContent = data.cash.toFixed(2);
  document.getElementById('cardSales').textContent = data.card.toFixed(2);
  document.getElementById('tabbySales').textContent = data.tabby.toFixed(2);
  document.getElementById('chequeSales').textContent = data.cheque.toFixed(2);
  document.getElementById('cashInHand').textContent = data.cashInHand.toFixed(2);
}

// ===== Recent Invoices =====
async function loadRecentInvoices() {
  const container = document.getElementById('recentInvoices');
  container.innerHTML = '<div class="loading-text">Loading...</div>';
  
  const data = await readSheet("'AKM-POS'!A:S");
  
  if (!data || data.length <= 1) {
    container.innerHTML = '<div class="loading-text">No invoices yet</div>';
    return;
  }
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - recentInvoicesDays);
  
  const invoices = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const invDate = new Date(row[1]);
    if (invDate >= cutoffDate) {
      invoices.push({
        id: row[0],
        date: row[1],
        customer: row[3] || 'Walk-in Customer',
        phone: row[4],
        payment: row[6],
        grandTotal: parseFloat(row[9]) || 0,
        status: row[14] || 'Paid'
      });
    }
    if (invoices.length >= 50) break;
  }
  
  if (invoices.length === 0) {
    container.innerHTML = '<div class="loading-text">No recent invoices</div>';
    return;
  }
  
  let html = '';
  invoices.forEach(inv => {
    const statusClass = inv.status === 'Refunded' ? 'status-refunded' : 'status-paid';
    html += `
      <div class="invoice-item">
        <div class="invoice-item-header">
          <span class="invoice-item-number">${inv.id}</span>
          <span class="invoice-item-status ${statusClass}">${inv.status}</span>
        </div>
        <div class="invoice-item-amount">AED ${inv.grandTotal.toFixed(2)}</div>
        <div class="invoice-item-details">
          ${formatDate(new Date(inv.date), 'DD MMM YYYY')} | ${inv.payment}<br>
          ${inv.customer}
        </div>
        <div class="invoice-item-actions">
          <button class="btn-reprint" onclick="reprintInvoice('${inv.id}')">Reprint</button>
          ${inv.status !== 'Refunded' ? `<button class="btn-refund" onclick="refundInvoice('${inv.id}')">Refund</button>` : ''}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

window.loadMoreInvoices = async function() {
  recentInvoicesDays += 7;
  await loadRecentInvoices();
};

// ===== Invoice Items Management =====
window.addItemRow = function() {
  const tbody = document.getElementById('itemsBody');
  const rowCount = tbody.querySelectorAll('tr').length;
  
  if (rowCount >= 10) {
    showToast('Maximum 10 items allowed', 'error');
    return;
  }
  
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="item-model" placeholder="Model"></td>
    <td><input type="text" class="item-desc" placeholder="Description"></td>
    <td><input type="number" class="item-qty" min="1" value="1"></td>
    <td><input type="number" class="item-price" min="0" step="0.01" placeholder="0.00"></td>
    <td><span class="amount-display">0.00</span></td>
    <td><button class="btn-remove-item" onclick="removeItemRow(this)">×</button></td>
  `;
  tbody.appendChild(tr);
};

window.removeItemRow = function(btn) {
  const tbody = document.getElementById('itemsBody');
  const tr = btn.closest('tr');
  
  if (tbody.querySelectorAll('tr').length === 1) {
    // Clear the last row instead of removing
    tr.querySelectorAll('input').forEach(input => {
      if (input.classList.contains('item-qty')) {
        input.value = 1;
      } else {
        input.value = '';
      }
    });
    tr.querySelector('.amount-display').textContent = '0.00';
  } else {
    tr.remove();
  }
  
  calculateTotals();
};

// ===== Calculate Totals =====
function calculateTotals() {
  let subtotal = 0;
  
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
    const price = parseFloat(tr.querySelector('.item-price').value) || 0;
    const amount = qty * price;
    
    tr.querySelector('.amount-display').textContent = amount.toFixed(2);
    subtotal += amount;
  });
  
  const vat = subtotal * 0.05;
  const grandTotal = subtotal + vat;
  
  document.getElementById('subTotal').textContent = subtotal.toFixed(2);
  document.getElementById('vatAmount').textContent = vat.toFixed(2);
  document.getElementById('grandTotal').textContent = grandTotal.toFixed(2);
}

// ===== Payment Method Selection =====
window.selectPayment = function(btn, method) {
  document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPaymentMethod = method;
};

// ===== Save and Print Invoice =====
window.saveAndPrint = async function() {
  // Check if payment method is selected
  if (!currentPaymentMethod) {
    showToast('Please select a payment method', 'error');
    return;
  }
  
  const items = collectItems();
  
  const validation = validateInvoiceForm();
  if (!validation.isValid) {
    return;
  }
  
  const custName = document.getElementById('custName').value.trim() || 'Walk-in Customer';
  const custPhone = document.getElementById('custPhone').value.trim();
  const custTRN = document.getElementById('custTRN').value.trim();
  const invDate = document.getElementById('invDate').value;
  
  // Calculate totals
  let subtotal = 0;
  items.forEach(item => {
    subtotal += item.qty * item.price;
  });
  const vat = subtotal * 0.05;
  const grandTotal = subtotal + vat;
  
  // Generate invoice number
  const invNum = document.getElementById('invNum').textContent;
  const today = new Date();
  const timestamp = formatDate(today, 'YYYY-MM-DD HH:mm:ss');
  
  // Prepare invoice data
  const itemsJSON = JSON.stringify(items.map(item => ({
    model: item.model,
    desc: item.desc,
    qty: item.qty,
    price: item.price,
    amount: item.qty * item.price
  })));
  
  // Calculate cash impact
  let cashImpact = 0;
  let cardImpact = 0;
  let tabbyImpact = 0;
  let chequeImpact = 0;
  
  if (currentPaymentMethod === 'Cash') cashImpact = grandTotal;
  else if (currentPaymentMethod === 'Card') cardImpact = grandTotal;
  else if (currentPaymentMethod === 'Tabby') tabbyImpact = grandTotal;
  else if (currentPaymentMethod === 'Cheque') chequeImpact = grandTotal;
  
  const invoiceRow = [
    invNum,
    invDate,
    timestamp,
    custName,
    custPhone,
    custTRN,
    currentPaymentMethod,
    subtotal.toFixed(2),
    vat.toFixed(2),
    grandTotal.toFixed(2),
    itemsJSON,
    today.getDate(),
    today.getMonth() + 1,
    today.getFullYear(),
    'Paid',
    cashImpact.toFixed(2),
    cardImpact.toFixed(2),
    tabbyImpact.toFixed(2),
    chequeImpact.toFixed(2),
    ''
  ];
    // Save to sheet
  const btn = document.getElementById('printBtn');
  btn.disabled = true;
  btn.textContent = '💾 Saving...';
  
  const success = await appendToSheet("'AKM-POS'!A:T", [invoiceRow]);
  
  if (success) {
    // Also save to InvoiceItems sheet
    const itemRows = items.map((item, index) => [
      `ITM-${invNum.split('-')[1]}-${String(index + 1).padStart(3, '0')}`,
      invNum,
      item.model,
      item.desc,
      item.qty,
      item.price,
      (item.qty * item.price).toFixed(2),
      invDate
    ]);
    await appendToSheet('InvoiceItems!A:H', itemRows);
    
    showToast('Invoice saved successfully!', 'success');
    
    // Print invoice
    printInvoice(invNum);
    
    // Reset form and reload data
    setTimeout(() => {
      clearForm();
      loadNextInvoiceNumber();
      loadDashboardData();
      loadRecentInvoices();
    }, 1000);
  } else {
    showToast('Failed to save invoice', 'error');
  }
  
  btn.disabled = false;
  btn.textContent = '🖨️ Print Invoice';
};

function collectItems() {
  const items = [];
  
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const model = tr.querySelector('.item-model').value.trim();
    const desc = tr.querySelector('.item-desc').value.trim();
    const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
    const price = parseFloat(tr.querySelector('.item-price').value) || 0;
    
    if ((model || desc) && qty > 0 && price > 0) {
      items.push({ model, desc, qty, price });
    }
  });
  
  return items;
}

// ===== Print Invoice =====
function printInvoice(invNum) {
  // Generate barcode
  try {
    JsBarcode("#barcode", invNum.replace(/[^0-9]/g, ''), {
      format: "CODE128",
      width: 2,
      height: 40,
      displayValue: false
    });
    document.getElementById('barcodeText').textContent = invNum;
  } catch (e) {
    console.error('Barcode generation failed:', e);
  }
  
  const originalTitle = document.title;
  document.title = invNum;
  
  // Hide empty rows
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const model = tr.querySelector('.item-model').value.trim();
    const desc = tr.querySelector('.item-desc').value.trim();
    if (!model && !desc) {
      tr.style.display = 'none';
    }
  });
  
  window.print();
  
  setTimeout(() => {
    document.title = originalTitle;
    document.querySelectorAll('#itemsBody tr').forEach(tr => {
      tr.style.display = '';
    });
  }, 500);
}

// ===== Reprint Invoice =====
window.reprintInvoice = async function(invId) {
  const data = await readSheet("'AKM-POS'!A:S");
  
  if (!data) return;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === invId) {
      const row = data[i];
      
      document.getElementById('invNum').textContent = row[0];
      document.getElementById('invDate').value = row[1];
      document.getElementById('custName').value = row[3] || '';
      document.getElementById('custPhone').value = row[4] || '';
      document.getElementById('custTRN').value = row[5] || '';
      
      // Parse items
      const itemsJSON = JSON.parse(row[10] || '[]');
      const tbody = document.getElementById('itemsBody');
      tbody.innerHTML = '';
      
      itemsJSON.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" class="item-model" value="${item.model}" readonly></td>
          <td><input type="text" class="item-desc" value="${item.desc}" readonly></td>
          <td><input type="number" class="item-qty" value="${item.qty}" readonly></td>
          <td><input type="number" class="item-price" value="${item.price}" readonly></td>
          <td><span class="amount-display">${item.amount.toFixed(2)}</span></td>
          <td><button class="btn-remove-item" disabled style="opacity:0.5;">×</button></td>
        `;
        tbody.appendChild(tr);
      });
      
      // Set payment method
      currentPaymentMethod = row[6];
      document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === currentPaymentMethod);
        btn.disabled = true;
      });
      
      calculateTotals();
      showToast('Invoice loaded for reprint', 'success');
      
      // Print after a short delay
      setTimeout(() => printInvoice(invId), 500);
      
      break;
    }
  }
};

// ===== Refund Invoice =====
window.refundInvoice = async function(invId) {
  if (!confirm(`Are you sure you want to refund invoice ${invId}?`)) {
    return;
  }
  
  const data = await readSheet("'AKM-POS'!A:S");
  
  if (!data) return;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === invId) {
      const rowIndex = i + 1; // 1-based index for Sheets
        // Update status to Refunded
      await updateSheet(`'AKM-POS'!O${rowIndex}`, [['Refunded']]);
      
      // Update cash impact to negative
      const grandTotal = parseFloat(data[i][9]) || 0;
      const paymentMethod = data[i][6];
      
      if (paymentMethod === 'Cash') {
        await updateSheet(`'AKM-POS'!P${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      } else if (paymentMethod === 'Card') {
        await updateSheet(`'AKM-POS'!Q${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      } else if (paymentMethod === 'Tabby') {
        await updateSheet(`'AKM-POS'!R${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      } else if (paymentMethod === 'Cheque') {
        await updateSheet(`'AKM-POS'!S${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      }
      
      showToast('Invoice refunded successfully', 'success');
      await loadDashboardData();
      await loadRecentInvoices();
      
      break;
    }
  }
};

// ===== Clear Form =====
window.clearForm = function() {
  document.getElementById('custName').value = '';
  document.getElementById('custPhone').value = '';
  document.getElementById('custTRN').value = '';
  document.getElementById('invDate').valueAsDate = new Date();
  
  const tbody = document.getElementById('itemsBody');
  tbody.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    addItemRow();
  }
  
  currentPaymentMethod = 'Cash';
  document.querySelectorAll('.payment-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.method === 'Cash');
    btn.disabled = false;
  });
  
  calculateTotals();
  document.getElementById('custName').focus();
};

// ===== Modals =====
window.openDepositModal = function() {
  document.getElementById('depositModal').classList.add('show');
  document.getElementById('depositAmount').focus();
};

window.closeDepositModal = function() {
  document.getElementById('depositModal').classList.remove('show');
  document.getElementById('depositAmount').value = '';
  document.getElementById('depositRef').value = '';
};

window.submitDeposit = async function() {
  const amount = parseFloat(document.getElementById('depositAmount').value);
  const reference = document.getElementById('depositRef').value.trim();
  
  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }
  
  if (!reference) {
    showToast('Please enter a reference number', 'error');
    return;
  }
  
  const today = new Date();
  const depositRow = [
    `DEP-${formatDate(today, 'YYYYMMDD')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
    formatDate(today, 'YYYY-MM-DD'),
    formatDate(today, 'YYYY-MM-DD HH:mm:ss'),
    amount.toFixed(2),
    'FAB',
    reference,
    (-amount).toFixed(2),
    ''
  ];
  
  const success = await appendToSheet('Deposits!A:H', [depositRow]);
  
  if (success) {
    showToast('Deposit recorded successfully', 'success');
    closeDepositModal();
    await loadDashboardData();
  }
};

window.openExpenseModal = function() {
  document.getElementById('expenseModal').classList.add('show');
  document.getElementById('expenseDesc').focus();
};

window.closeExpenseModal = function() {
  document.getElementById('expenseModal').classList.remove('show');
  document.getElementById('expenseDesc').value = '';
  document.getElementById('expenseAmount').value = '';
  document.getElementById('expenseReceipt').value = '';
};

window.submitExpense = async function() {
  const description = document.getElementById('expenseDesc').value.trim();
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  const receipt = document.getElementById('expenseReceipt').value.trim();
  
  if (!description) {
    showToast('Please enter a description', 'error');
    return;
  }
  
  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }
  
  const today = new Date();
  const expenseRow = [
    `EXP-${formatDate(today, 'YYYYMMDD')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
    formatDate(today, 'YYYY-MM-DD'),
    formatDate(today, 'YYYY-MM-DD HH:mm:ss'),
    description,
    amount.toFixed(2),
    'Cash',
    receipt,
    '',
    (-amount).toFixed(2),
    ''
  ];
  
  const success = await appendToSheet('Expenses!A:J', [expenseRow]);
  
  if (success) {
    showToast('Expense recorded successfully', 'success');
    closeExpenseModal();
    await loadDashboardData();
  }
};

// ===== Daily Report =====
window.printDailyReport = async function() {
  const today = formatDate(new Date(), 'YYYY-MM-DD');
  const data = await readSheet("'AKM-POS'!A:S");
  
  if (!data || data.length <= 1) {
    showToast('No data for today', 'error');
    return;
  }
  
  let cashSales = 0;
  let cardSales = 0;
  let tabbySales = 0;
  let chequeSales = 0;
  let refunds = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[1];
    const paymentMethod = row[6];
    const grandTotal = parseFloat(row[9]) || 0;
    const status = row[14];
    
    if (date === today) {
      if (status === 'Refunded') {
        refunds++;
      } else {
        if (paymentMethod === 'Cash') cashSales += grandTotal;
        else if (paymentMethod === 'Card') cardSales += grandTotal;
        else if (paymentMethod === 'Tabby') tabbySales += grandTotal;
        else if (paymentMethod === 'Cheque') chequeSales += grandTotal;
      }
    }
  }
  
  const totalSales = cashSales + cardSales + tabbySales + chequeSales;
  const cashInHand = parseFloat(document.getElementById('cashInHand').textContent);
  
  const reportHTML = `
    <div style="text-align: center; font-weight: bold; font-size: 16px; margin-bottom: 10px;">
      Daily Report - ${formatDate(new Date(), 'DD MMM YYYY')}
    </div>
    <div style="border-bottom: 2px dashed #000; margin: 10px 0;"></div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>Total Sales:</span>
      <span style="font-weight: bold;">AED ${totalSales.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>Cash:</span>
      <span>AED ${cashSales.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>Card:</span>
      <span>AED ${cardSales.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>Tabby:</span>
      <span>AED ${tabbySales.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>Cheque:</span>
      <span>AED ${chequeSales.toFixed(2)}</span>
    </div>
    <div style="border-bottom: 2px dashed #000; margin: 10px 0;"></div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>Cash in Hand:</span>
      <span style="font-weight: bold;">AED ${cashInHand.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>Refunds:</span>
      <span>${refunds}</span>
    </div>
  `;
  
  const container = document.getElementById('dailyReportContainer');
  container.innerHTML = reportHTML;
  
  document.body.classList.add('printing-daily-report');
  window.print();
  
  setTimeout(() => {
    document.body.classList.remove('printing-daily-report');
  }, 500);
};

// ===== Utility Functions =====
function formatDate(date, format) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('MMM', monthNames[date.getMonth()])
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ===== Input Validation Functions =====

// Validate phone number (UAE format: 05x-xxx-xxxx or +971-5x-xxx-xxxx)
function validatePhone(phone) {
  if (!phone) return { valid: true, message: '' }; // Optional field
  
  const cleaned = phone.replace(/[\s\-()]/g, '');
  const uaePattern = /^(05[0-9]{8}|(\+?971)?5[0-9]{8})$/;
  
  if (uaePattern.test(cleaned)) {
    return { valid: true, message: '✓ Valid UAE mobile number' };
  }
  return { valid: false, message: '✗ Invalid format. Use: 05x-xxx-xxxx' };
}

// Validate TRN (UAE Tax Registration Number: 15 digits)
function validateTRN(trn) {
  if (!trn) return { valid: true, message: '' }; // Optional field
  
  const cleaned = trn.replace(/[\s\-]/g, '');
  const trnPattern = /^[0-9]{15}$/;
  
  if (trnPattern.test(cleaned)) {
    return { valid: true, message: '✓ Valid TRN format' };
  }
  return { valid: false, message: '✗ TRN must be 15 digits' };
}

// Validate customer name
function validateCustomerName(name) {
  if (!name || name.trim() === '' || name.trim() === 'Walk-in Customer') {
    return { valid: true, message: '' }; // Optional, will default to Walk-in
  }
  
  if (name.trim().length < 2) {
    return { valid: false, message: '✗ Name too short (min 2 characters)' };
  }
  
  if (name.trim().length > 100) {
    return { valid: false, message: '✗ Name too long (max 100 characters)' };
  }
  
  return { valid: true, message: '✓ Valid customer name' };
}

// Validate date (must not be future date)
function validateInvoiceDate(dateString) {
  if (!dateString) {
    return { valid: false, message: '✗ Date is required' };
  }
  
  const selectedDate = new Date(dateString);
  const today = new Date();
  today.setHours(23, 59, 59, 999); // End of today
  
  if (selectedDate > today) {
    return { valid: false, message: '✗ Cannot use future date' };
  }
  
  // Check if date is too old (more than 1 year)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  if (selectedDate < oneYearAgo) {
    return { valid: false, message: '⚠ Warning: Date is more than 1 year old' };
  }
  
  return { valid: true, message: '✓ Valid date' };
}

// Validate item row
function validateItemRow(model, desc, qty, price) {
  const errors = [];
  
  if (!model && !desc) {
    return { valid: false, message: 'Model or Description required' };
  }
  
  if (model && model.length > 50) {
    errors.push('Model too long');
  }
  
  if (desc && desc.length > 200) {
    errors.push('Description too long');
  }
  
  if (!qty || qty <= 0) {
    errors.push('Invalid quantity');
  }
  
  if (qty > 9999) {
    errors.push('Quantity too large');
  }
  
  if (!price || price <= 0) {
    errors.push('Invalid price');
  }
  
  if (price > 999999) {
    errors.push('Price too large');
  }
  
  if (errors.length > 0) {
    return { valid: false, message: errors.join(', ') };
  }
  
  return { valid: true, message: '' };
}

// Apply validation styling to input
function applyValidation(input, validation) {
  const field = input.closest('.meta-field');
  
  // Remove existing validation classes
  input.classList.remove('valid', 'invalid');
  
  // Remove existing validation message
  const existingMessage = field?.querySelector('.validation-message');
  if (existingMessage) {
    existingMessage.remove();
  }
  
  // Apply new validation
  if (validation.message) {
    if (validation.valid) {
      input.classList.add('valid');
    } else {
      input.classList.add('invalid');
    }
    
    // Add validation message
    if (field) {
      const messageDiv = document.createElement('div');
      messageDiv.className = `validation-message ${validation.valid ? 'success' : 'error'}`;
      messageDiv.textContent = validation.message;
      field.appendChild(messageDiv);
    }
  }
}

// Real-time validation setup
function setupRealtimeValidation() {
  // Customer name validation
  const custNameInput = document.getElementById('custName');
  if (custNameInput) {
    custNameInput.addEventListener('blur', (e) => {
      const validation = validateCustomerName(e.target.value);
      applyValidation(e.target, validation);
    });
    
    custNameInput.addEventListener('input', (e) => {
      if (e.target.classList.contains('invalid')) {
        const validation = validateCustomerName(e.target.value);
        applyValidation(e.target, validation);
      }
    });
  }
  
  // Phone validation
  const custPhoneInput = document.getElementById('custPhone');
  if (custPhoneInput) {
    custPhoneInput.addEventListener('blur', (e) => {
      const validation = validatePhone(e.target.value);
      applyValidation(e.target, validation);
    });
    
    custPhoneInput.addEventListener('input', (e) => {
      if (e.target.classList.contains('invalid')) {
        const validation = validatePhone(e.target.value);
        applyValidation(e.target, validation);
      }
    });
  }
  
  // TRN validation
  const custTRNInput = document.getElementById('custTRN');
  if (custTRNInput) {
    custTRNInput.addEventListener('blur', (e) => {
      const validation = validateTRN(e.target.value);
      applyValidation(e.target, validation);
    });
    
    custTRNInput.addEventListener('input', (e) => {
      if (e.target.classList.contains('invalid')) {
        const validation = validateTRN(e.target.value);
        applyValidation(e.target, validation);
      }
    });
  }
  
  // Date validation
  const invDateInput = document.getElementById('invDate');
  if (invDateInput) {
    invDateInput.addEventListener('change', (e) => {
      const validation = validateInvoiceDate(e.target.value);
      applyValidation(e.target, validation);
    });
  }
  
  // Item validation (qty and price)
  document.addEventListener('blur', (e) => {
    if (e.target.matches('.item-qty')) {
      const qty = parseFloat(e.target.value) || 0;
      if (qty <= 0) {
        e.target.classList.add('invalid');
        showToast('Quantity must be greater than 0', 'error');
      } else if (qty > 9999) {
        e.target.classList.add('invalid');
        showToast('Quantity too large (max 9999)', 'error');
      } else {
        e.target.classList.remove('invalid');
        e.target.classList.add('valid');
      }
    }
    
    if (e.target.matches('.item-price')) {
      const price = parseFloat(e.target.value) || 0;
      if (price <= 0) {
        e.target.classList.add('invalid');
        showToast('Price must be greater than 0', 'error');
      } else if (price > 999999) {
        e.target.classList.add('invalid');
        showToast('Price too large (max 999,999)', 'error');
      } else {
        e.target.classList.remove('invalid');
        e.target.classList.add('valid');
      }
    }
  }, true);
}

// Validate entire form before submission
function validateInvoiceForm() {
  let isValid = true;
  const errors = [];
  
  // Validate customer info
  const custName = document.getElementById('custName').value;
  const custPhone = document.getElementById('custPhone').value;
  const custTRN = document.getElementById('custTRN').value;
  const invDate = document.getElementById('invDate').value;
  
  const nameValidation = validateCustomerName(custName);
  if (!nameValidation.valid) {
    isValid = false;
    errors.push('Customer name: ' + nameValidation.message);
    document.getElementById('custName').classList.add('invalid');
  }
  
  const phoneValidation = validatePhone(custPhone);
  if (!phoneValidation.valid) {
    isValid = false;
    errors.push('Phone: ' + phoneValidation.message);
    document.getElementById('custPhone').classList.add('invalid');
  }
  
  const trnValidation = validateTRN(custTRN);
  if (!trnValidation.valid) {
    isValid = false;
    errors.push('TRN: ' + trnValidation.message);
    document.getElementById('custTRN').classList.add('invalid');
  }
  
  const dateValidation = validateInvoiceDate(invDate);
  if (!dateValidation.valid) {
    isValid = false;
    errors.push('Date: ' + dateValidation.message);
    document.getElementById('invDate').classList.add('invalid');
  }
  
  // Validate items
  const items = collectItems();
  if (items.length === 0) {
    isValid = false;
    errors.push('At least one item is required');
  }
  
  // Validate each item
  items.forEach((item, index) => {
    const itemValidation = validateItemRow(item.model, item.desc, item.qty, item.price);
    if (!itemValidation.valid) {
      isValid = false;
      errors.push(`Item ${index + 1}: ${itemValidation.message}`);
    }
  });
  
  // Validate totals
  const grandTotal = parseFloat(document.getElementById('grandTotal').textContent);
  if (grandTotal <= 0) {
    isValid = false;
    errors.push('Grand total must be greater than 0');
  }
  
  if (grandTotal > 9999999) {
    isValid = false;
    errors.push('Grand total too large');
  }
  
  if (!isValid) {
    showToast(errors[0], 'error'); // Show first error
    console.error('❌ Validation errors:', errors);
  }
  
  return { isValid, errors };
}

// Close modals when clicking outside
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeDepositModal();
    closeExpenseModal();
  }
});

console.log('✅ AKM-POS app.js loaded successfully');
