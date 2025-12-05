const firebaseConfig = {
  apiKey: "AIzaSyBaaHya8oqfJEOycvAsKU_Ise3s2VAgqgw",
  authDomain: "akm-pos-480210.firebaseapp.com",
  projectId: "akm-pos-480210",
  storageBucket: "akm-pos-480210.firebasestorage.app",
  messagingSenderId: "694436741738",
  appId: "1:694436741738:web:8852f92a451f13fbc00013"
};

const SPREADSHEET_ID = "1QS7iSSq1sd948l2qQ-nI_qYuOWNsXs6UFkFAOd72QKM";
const ALLOWED_EMAIL = "sales@akm-music.com";

const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = IS_LOCAL ? 'http://localhost:3000' : 'https://akm-pos-api.onrender.com';
const WRITE_ENDPOINT = `${API_BASE_URL}/writeToSheet`;
const READ_ENDPOINT = `${API_BASE_URL}/readSheet`;

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: 'akm-music.com' });

let currentUser = null;
let currentPaymentMethod = null;
let invoiceCounter = 15001;
let recentInvoicesDays = 7;
let isReprintMode = false;
let reprintInvoiceId = null;
let requestQueue = [];
let isProcessingQueue = false;
const REQUEST_DELAY = 200;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 AKM-POS initializing...');
  
  onAuthStateChanged(auth, (user) => {
    console.log('🔐 Auth state changed:', user ? user.email : 'No user');
    
    if (user && user.email === ALLOWED_EMAIL) {
      console.log('✅ User authenticated:', user.email);
      currentUser = user;
      showMainApp();
      initializePOS();
    } else if (user) {
      showToast('Unauthorized email. Only sales@akm-music.com can access.', 'error');
      signOut(auth);
      showLoginScreen();
    } else {
      console.log('ℹ️ No user signed in');
      showLoginScreen();
    }
  });

  document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('invDate').valueAsDate = new Date();
  
  for (let i = 0; i < 3; i++) addItemRow();
  
  document.addEventListener('input', (e) => {
    if (e.target.matches('.item-qty, .item-price')) calculateTotals();
  });

  setupRealtimeValidation();
  
  const btnVat = document.getElementById('btnVatReport');
  if (btnVat) btnVat.addEventListener('click', () => printVatReport('day'));
});

async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
    showToast('Signed in successfully!', 'success');
  } catch (error) {
    showToast('Sign-in failed: ' + error.message, 'error');
  }
}

async function logout() {
  try {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loadingScreen').style.display = 'flex';
    await signOut(auth);
    currentUser = null;
    isReprintMode = false;
    reprintInvoiceId = null;
    requestQueue = [];
    showLoginScreen();
    showToast('Logged out successfully', 'success');
  } catch (error) {
    window.location.href = window.location.origin;
  }
}

function showLoginScreen() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
}

async function initializePOS() {
  await loadNextInvoiceNumber();
  await loadDashboardData();
  await loadRecentInvoices();
  setupRealtimeValidation();
  document.getElementById('custName').focus();
}

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

async function readSheetBatch(ranges) {
  try {
    const response = await fetch(READ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranges })
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Failed to read data');
    
    const result = {};
    data.valueRanges.forEach((valueRange, index) => {
      result[ranges[index]] = valueRange.values || [];
    });
    return result;
  } catch (error) {
    showToast('Error reading data. Make sure proxy server is running.', 'error');
    return null;
  }
}

async function readSheet(range) {
  return queueRequest(async () => {
    try {
      const response = await fetch(READ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range })
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to read data');
      return data.values || [];
    } catch (error) {
      showToast('Error reading data. Make sure proxy server is running.', 'error');
      return null;
    }
  });
}

async function appendToSheet(range, values) {
  try {
    const response = await fetch(WRITE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'append', sheetName: range, values })
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result.success) throw new Error(result.message || 'Failed to append data');
    return true;
  } catch (error) {
    showToast('Error saving data. Make sure proxy server is running.', 'error');
    return false;
  }
}

async function updateSheet(range, values) {
  try {
    const [sheetName, cellRange] = range.includes('!') ? range.split('!') : [range, ''];
    const response = await fetch(WRITE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        sheetName: sheetName.replace(/'/g, ''),
        range: cellRange,
        values
      })
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result.success) throw new Error(result.message || 'Failed to update data');
    return true;
  } catch (error) {
    showToast('Error updating sheet. Make sure proxy server is running.', 'error');
    return false;
  }
}

async function loadNextInvoiceNumber() {
  const data = await readSheet("'AKM-POS'!A:A");
  const currentYear = new Date().getFullYear();
  
  if (!data || data.length <= 1) {
    invoiceCounter = 15001;
  } else {
    const lastInvoice = data[data.length - 1][0];
    const match = lastInvoice.match(/(\d{4})-(\d+)/);
    if (match) {
      const lastYear = parseInt(match[1]);
      const lastSequence = parseInt(match[2]);
      invoiceCounter = (lastYear === currentYear) ? lastSequence + 1 : 15001;
    } else {
      invoiceCounter = 15001;
    }
  }
  
  document.getElementById('invNum').textContent = `${currentYear}-${String(invoiceCounter).padStart(5, '0')}`;
}

async function loadDashboardData() {
  const today = formatDate(new Date(), 'YYYY-MM-DD');
  const batchData = await readSheetBatch(["'AKM-POS'!A:S", "Deposits!A:G", "Expenses!A:I"]);
  
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
  
  let cashSales = 0, cardSales = 0, tabbySales = 0, chequeSales = 0;
  let totalCashIn = 0, totalCashOut = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[1];
    const paymentMethod = row[6];
    const grandTotal = parseFloat(row[9]) || 0;
    const status = row[14];
    const cashImpact = parseFloat(row[15]) || 0;
    
    if (date === today && status !== 'Refunded') {
      if (paymentMethod === 'Cash') cashSales += grandTotal;
      else if (paymentMethod === 'Card') cardSales += grandTotal;
      else if (paymentMethod === 'Tabby') tabbySales += grandTotal;
      else if (paymentMethod === 'Cheque') chequeSales += grandTotal;
    }
    
    if (status !== 'Refunded') totalCashIn += cashImpact;
  }
  
  if (deposits.length > 1) {
    for (let i = 1; i < deposits.length; i++) {
      totalCashOut += Math.abs(parseFloat(deposits[i][6]) || 0);
    }
  }
  
  if (expenses.length > 1) {
    for (let i = 1; i < expenses.length; i++) {
      totalCashOut += Math.abs(parseFloat(expenses[i][8]) || 0);
    }
  }
  
  updateDashboard({
    cash: cashSales,
    card: cardSales,
    tabby: tabbySales,
    cheque: chequeSales,
    cashInHand: totalCashIn - totalCashOut
  });
}

function updateDashboard(data) {
  document.getElementById('cashSales').textContent = data.cash.toFixed(2);
  document.getElementById('cardSales').textContent = data.card.toFixed(2);
  document.getElementById('tabbySales').textContent = data.tabby.toFixed(2);
  document.getElementById('chequeSales').textContent = data.cheque.toFixed(2);
  document.getElementById('cashInHand').textContent = data.cashInHand.toFixed(2);
}

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
          ${formatDate(new Date(inv.date), 'DD MMM YYYY')} | ${inv.payment}<br>${inv.customer}
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

window.addItemRow = function() {
  const tbody = document.getElementById('itemsBody');
  if (tbody.querySelectorAll('tr').length >= 10) {
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
  `;
  tbody.appendChild(tr);
};

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

window.selectPayment = function(btn, method) {
  document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPaymentMethod = method;
};

window.saveAndPrint = async function() {
  console.log('📄 Save and Print clicked');
  
  if (!currentPaymentMethod) {
    showToast('Please select a payment method', 'error');
    return;
  }
  
  const items = collectItems();
  console.log('📦 Items collected:', items.length);
  
  if (items.length === 0) {
    showToast('Please add at least one item', 'error');
    return;
  }
  
  const validation = validateInvoiceForm();
  if (!validation.isValid) return;
  
  const custName = document.getElementById('custName').value.trim() || 'Walk-in Customer';
  const custPhone = document.getElementById('custPhone').value.trim();
  const custTRN = document.getElementById('custTRN').value.trim();
  const invDate = document.getElementById('invDate').value;
  const invNum = document.getElementById('invNum').textContent;
  
  let subtotal = 0;
  items.forEach(i => { subtotal += i.qty * i.price; });
  const vat = subtotal * 0.05;
  const grandTotal = subtotal + vat;
  
  const btn = document.getElementById('printBtn');
  btn.disabled = true;
  
  if (isReprintMode && reprintInvoiceId === invNum) {
    btn.textContent = '🖨️ Printing...';
    printInvoice(invNum);
    setTimeout(() => {
      isReprintMode = false;
      reprintInvoiceId = null;
      clearForm();
      loadNextInvoiceNumber();
      btn.disabled = false;
      btn.textContent = '🖨️ Print Invoice';
    }, 600);
    return;
  }
  
  btn.textContent = '💾 Saving...';
  
  const today = new Date();
  const timestamp = formatDate(today, 'YYYY-MM-DD HH:mm:ss');
  const itemsJSON = JSON.stringify(items.map(item => ({
    model: item.model,
    desc: item.desc,
    qty: item.qty,
    price: item.price,
    amount: item.qty * item.price
  })));
  
  let cashImpact = 0, cardImpact = 0, tabbyImpact = 0, chequeImpact = 0;
  if (currentPaymentMethod === 'Cash') cashImpact = grandTotal;
  else if (currentPaymentMethod === 'Card') cardImpact = grandTotal;
  else if (currentPaymentMethod === 'Tabby') tabbyImpact = grandTotal;
  else if (currentPaymentMethod === 'Cheque') chequeImpact = grandTotal;

  const invoiceRow = [
    invNum, invDate, timestamp, custName, custPhone, custTRN, currentPaymentMethod,
    subtotal.toFixed(2), vat.toFixed(2), grandTotal.toFixed(2), itemsJSON,
    today.getDate(), today.getMonth() + 1, today.getFullYear(), 'Paid',
    cashImpact.toFixed(2), cardImpact.toFixed(2), tabbyImpact.toFixed(2), chequeImpact.toFixed(2), ''
  ];
    const success = await appendToSheet("'AKM-POS'!A:T", [invoiceRow]);
  
  if (success) {
    console.log('✅ Invoice saved successfully:', invNum);
    const itemRows = items.map((item, index) => [
      `ITM-${invNum.split('-')[1]}-${String(index + 1).padStart(3, '0')}`,
      invNum, item.model, item.desc, item.qty, item.price, (item.qty * item.price).toFixed(2), invDate
    ]);
    await appendToSheet('InvoiceItems!A:H', itemRows);
    
    showToast('Invoice saved successfully!', 'success');
    printInvoice(invNum);
    
    setTimeout(() => {
      clearForm();
      loadNextInvoiceNumber();
      loadDashboardData();
      loadRecentInvoices();
    }, 600);
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

function printInvoice(invNum) {
  try {
    JsBarcode("#barcode", invNum.replace(/[^0-9]/g, ''), {
      format: "CODE128",
      width: 2,
      height: 40,
      displayValue: false
    });
    document.getElementById('barcodeText').textContent = invNum;
  } catch (e) {}
  
  const originalTitle = document.title;
  document.title = invNum;
  
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const model = tr.querySelector('.item-model').value.trim();
    const desc = tr.querySelector('.item-desc').value.trim();
    if (!model && !desc) {
      tr.classList.add('empty-row');
    } else {
      tr.classList.remove('empty-row');
    }
  });
    window.print();
  console.log('✅ Print dialog opened for invoice:', invNum);
  
  setTimeout(() => {
    document.title = originalTitle;
    document.querySelectorAll('#itemsBody tr.empty-row').forEach(tr => {
      tr.classList.remove('empty-row');
    });
  }, 500);
}

window.reprintInvoice = async function(invId) {
  showToast('Loading invoice...', 'success');
  const data = await readSheet("'AKM-POS'!A:S");
  if (!data) {
    showToast('Failed to load invoice', 'error');
    return;
  }
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === invId) {
      const row = data[i];
      document.getElementById('invNum').textContent = row[0];
      document.getElementById('invDate').value = row[1];
      document.getElementById('custName').value = row[3] || '';
      document.getElementById('custPhone').value = row[4] || '';
      document.getElementById('custTRN').value = row[5] || '';
      
      let itemsJSON = [];
      try {
        itemsJSON = JSON.parse(row[10] || '[]');
      } catch (e) {}
      
      const tbody = document.getElementById('itemsBody');
      tbody.innerHTML = '';
      
      if (itemsJSON.length > 0) {
        itemsJSON.forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><input type="text" class="item-model" value="${item.model || ''}"></td>
            <td><input type="text" class="item-desc" value="${item.desc || ''}"></td>
            <td><input type="number" class="item-qty" value="${item.qty || 1}"></td>
            <td><input type="number" class="item-price" value="${item.price || 0}"></td>
            <td><span class="amount-display">${((item.qty || 0) * (item.price || 0)).toFixed(2)}</span></td>
          `;
          tbody.appendChild(tr);
        });
      } else {
        for (let j = 0; j < 3; j++) addItemRow();
      }
      
      currentPaymentMethod = row[6];
      document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === currentPaymentMethod);
      });
      
      calculateTotals();
      isReprintMode = true;
      reprintInvoiceId = invId;
      
      const printBtn = document.getElementById('printBtn');
      printBtn.disabled = false;
      printBtn.textContent = '🖨️ Reprint Invoice';
      
      showToast('Invoice loaded for reprint. Click "Reprint Invoice" to print.', 'success');
      document.querySelector('.main-content').scrollTop = 0;
      break;
    }
  }
};

window.refundInvoice = async function(invId) {
  if (!confirm(`Are you sure you want to refund invoice ${invId}?`)) return;
  
  const data = await readSheet("'AKM-POS'!A:S");
  if (!data) return;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === invId) {
      const rowIndex = i + 1;
      await updateSheet(`'AKM-POS'!O${rowIndex}`, [['Refunded']]);
      
      const grandTotal = parseFloat(data[i][9]) || 0;
      const paymentMethod = data[i][6];
      
      if (paymentMethod === 'Cash') await updateSheet(`'AKM-POS'!P${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      else if (paymentMethod === 'Card') await updateSheet(`'AKM-POS'!Q${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      else if (paymentMethod === 'Tabby') await updateSheet(`'AKM-POS'!R${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      else if (paymentMethod === 'Cheque') await updateSheet(`'AKM-POS'!S${rowIndex}`, [[(-grandTotal).toFixed(2)]]);
      
      showToast('Invoice refunded successfully', 'success');
      await loadDashboardData();
      await loadRecentInvoices();
      break;
    }
  }
};

window.clearForm = function() {
  document.getElementById('custName').value = '';
  document.getElementById('custPhone').value = '';
  document.getElementById('custTRN').value = '';
  document.getElementById('invDate').valueAsDate = new Date();
  
  const tbody = document.getElementById('itemsBody');
  tbody.innerHTML = '';
  for (let i = 0; i < 3; i++) addItemRow();
  
  currentPaymentMethod = null;
  document.querySelectorAll('.payment-btn').forEach(btn => btn.classList.remove('active'));
  calculateTotals();
  document.getElementById('custName').focus();
};

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

window.printDailyReport = async function() {
  const today = formatDate(new Date(), 'YYYY-MM-DD');
  const data = await readSheet("'AKM-POS'!A:S");
  
  if (!data || data.length <= 1) {
    showToast('No data for today', 'error');
    return;
  }
  
  let cashSales = 0, cardSales = 0, tabbySales = 0, chequeSales = 0, refunds = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[1] === today) {
      if (row[14] === 'Refunded') {
        refunds++;
      } else {
        const grandTotal = parseFloat(row[9]) || 0;
        const paymentMethod = row[6];
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
    <div style="text-align:center;font-weight:bold;font-size:16px;margin-bottom:10px;">Daily Report - ${formatDate(new Date(), 'DD MMM YYYY')}</div>
    <div style="border-bottom:2px dashed #000;margin:10px 0;"></div>
    <div style="display:flex;justify-content:space-between;margin:5px 0;"><span>Total Sales:</span><span style="font-weight:bold;">AED ${totalSales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:5px 0;"><span>Cash:</span><span>AED ${cashSales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:5px 0;"><span>Card:</span><span>AED ${cardSales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:5px 0;"><span>Tabby:</span><span>AED ${tabbySales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:5px 0;"><span>Cheque:</span><span>AED ${chequeSales.toFixed(2)}</span></div>
    <div style="border-bottom:2px dashed #000;margin:10px 0;"></div>
    <div style="display:flex;justify-content:space-between;margin:5px 0;"><span>Cash in Hand:</span><span style="font-weight:bold;">AED ${cashInHand.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:5px 0;"><span>Refunds:</span><span>${refunds}</span></div>
  `;
  
  const container = document.getElementById('dailyReportContainer');
  container.innerHTML = reportHTML;
  document.body.classList.add('printing-daily-report');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-daily-report'), 500);
};

window.printVatReport = async function(period = 'day') {
  const today = new Date();
  const dayKey = formatDate(today, 'YYYY-MM-DD');
  const monthKey = formatDate(today, 'YYYY-MM');

  const data = await readSheet("'AKM-POS'!A:S");
  if (!data || data.length <= 1) {
    showToast('No data available', 'error');
    return;
  }

  let base = 0, vat = 0, total = 0, invoicesCount = 0;
  let byMethod = {
    Cash: { base: 0, vat: 0, total: 0 },
    Card: { base: 0, vat: 0, total: 0 },
    Tabby: { base: 0, vat: 0, total: 0 },
    Cheque: { base: 0, vat: 0, total: 0 }
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = row[1];
    if (row[14] === 'Refunded') continue;
    
    const isMatch = period === 'day' ? date === dayKey : (date || '').startsWith(monthKey);
    if (!isMatch) continue;

    const subTotal = parseFloat(row[7]) || 0;
    const vatAmt = parseFloat(row[8]) || 0;
    const grand = parseFloat(row[9]) || 0;
    const payment = row[6];

    base += subTotal;
    vat += vatAmt;
    total += grand;
    invoicesCount++;

    if (byMethod[payment]) {
      byMethod[payment].base += subTotal;
      byMethod[payment].vat += vatAmt;
      byMethod[payment].total += grand;
    }
  }

  if (invoicesCount === 0) {
    showToast(period === 'day' ? 'No invoices today' : 'No invoices this month', 'error');
    return;
  }

  const title = period === 'day' ? `VAT Report - ${formatDate(today, 'DD MMM YYYY')}` : `VAT Report - ${formatDate(today, 'MMM YYYY')}`;
  const reportHTML = `
    <div style="text-align:center;font-weight:bold;font-size:16px;margin-bottom:8px;">${title}</div>
    <div style="display:flex;justify-content:space-between;margin:4px 0;"><span>Invoices:</span><span>${invoicesCount}</span></div>
    <div style="border-bottom:2px dashed #000;margin:8px 0;"></div>
    <div style="display:flex;justify-content:space-between;margin:4px 0;"><span>Taxable Amount:</span><span>AED ${base.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:4px 0;"><span>VAT 5%:</span><span style="font-weight:bold;">AED ${vat.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:4px 0;"><span>Total:</span><span>AED ${total.toFixed(2)}</span></div>
    <div style="border-bottom:2px dashed #000;margin:8px 0;"></div>
    <div style="font-weight:bold;margin:4px 0;">By Payment Method</div>
    ${['Cash','Card','Tabby','Cheque'].map(m => {
      const s = byMethod[m];
      return `<div style="display:flex;justify-content:space-between;margin:2px 0;font-size:11px;"><span>${m}:</span><span>Base ${s.base.toFixed(2)} | VAT ${s.vat.toFixed(2)} | Total ${s.total.toFixed(2)}</span></div>`;
    }).join('')}
  `;

  const container = document.getElementById('vatReportContainer');
  container.innerHTML = reportHTML;
  container.style.display = 'block';

  document.body.classList.add('printing-vat-report');
  window.print();

  setTimeout(() => {
    document.body.classList.remove('printing-vat-report');
    container.style.display = 'none';
    container.innerHTML = '';
  }, 500);
};

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
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function validatePhone(phone) {
  if (!phone) return { valid: true, message: '' };
  const cleaned = phone.replace(/[\s\-()]/g, '');
  const uaePattern = /^(05[0-9]{8}|(\+?971)?5[0-9]{8})$/;
  return uaePattern.test(cleaned) ? { valid: true, message: '✓ Valid' } : { valid: false, message: '✗ Invalid format' };
}

function validateTRN(trn) {
  if (!trn) return { valid: true, message: '' };
  const cleaned = trn.replace(/[\s\-]/g, '');
  return /^[0-9]{15}$/.test(cleaned) ? { valid: true, message: '✓ Valid' } : { valid: false, message: '✗ Must be 15 digits' };
}

function validateCustomerName(name) {
  if (!name || name.trim() === '' || name.trim() === 'Walk-in Customer') return { valid: true, message: '' };
  if (name.trim().length < 2) return { valid: false, message: '✗ Too short' };
  if (name.trim().length > 100) return { valid: false, message: '✗ Too long' };
  return { valid: true, message: '✓ Valid' };
}

function validateInvoiceDate(dateString) {
  if (!dateString) return { valid: false, message: '✗ Date required' };
  const selectedDate = new Date(dateString);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (selectedDate > today) return { valid: false, message: '✗ Cannot use future date' };
  return { valid: true, message: '✓ Valid' };
}

function validateInvoiceForm() {
  const errors = [];
  const custName = document.getElementById('custName').value;
  const custPhone = document.getElementById('custPhone').value;
  const custTRN = document.getElementById('custTRN').value;
  const invDate = document.getElementById('invDate').value;
  
  const nameVal = validateCustomerName(custName);
  if (!nameVal.valid) errors.push('Name: ' + nameVal.message);
  
  const phoneVal = validatePhone(custPhone);
  if (!phoneVal.valid) errors.push('Phone: ' + phoneVal.message);
  
  const trnVal = validateTRN(custTRN);
  if (!trnVal.valid) errors.push('TRN: ' + trnVal.message);
  
  const dateVal = validateInvoiceDate(invDate);
  if (!dateVal.valid) errors.push('Date: ' + dateVal.message);
  
  const items = collectItems();
  if (items.length === 0) errors.push('At least one item required');
  
  const grandTotal = parseFloat(document.getElementById('grandTotal').textContent);
  if (grandTotal <= 0) errors.push('Grand total must be > 0');
  
  if (errors.length > 0) {
    showToast(errors[0], 'error');
    return { isValid: false, errors };
  }
  
  return { isValid: true, errors: [] };
}

function setupRealtimeValidation() {
  const fields = [
    { id: 'custName', validator: validateCustomerName },
    { id: 'custPhone', validator: validatePhone },
    { id: 'custTRN', validator: validateTRN },
    { id: 'invDate', validator: validateInvoiceDate }
  ];
  
  fields.forEach(({ id, validator }) => {
    const input = document.getElementById(id);
    if (!input) return;
    
    input.addEventListener('blur', (e) => {
      const validation = validator(e.target.value);
      if (validation.message) {
        e.target.classList.toggle('valid', validation.valid);
        e.target.classList.toggle('invalid', !validation.valid);
      }
    });
  });
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeDepositModal();
    closeExpenseModal();
  }
});
