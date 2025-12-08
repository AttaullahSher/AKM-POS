// AKM-POS v79 - Repair Management System Integration - Fixed function exports
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
const API_BASE_URL = 'https://akm-pos-api.onrender.com';
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

// PRINT FIX: Convert inputs to text spans before printing (fixes grey text + description wrapping)
let originalInputStates = [];

function preparePrintLayout() {
  console.log('📝 Preparing print layout - converting inputs to text spans');
  originalInputStates = [];
  
  const invoiceContainer = document.querySelector('.invoice-container');
  if (!invoiceContainer) return;
  
  const inputs = invoiceContainer.querySelectorAll('input, select, .amount-display');
  
  inputs.forEach(input => {
    const state = {
      element: input,
      display: input.style.display,
      parent: input.parentNode
    };
    originalInputStates.push(state);
    
    const textSpan = document.createElement('span');
    textSpan.className = 'print-text-replacement';
    
    let value = '';
    if (input.classList.contains('amount-display')) {
      value = input.textContent || input.innerText;
    } else if (input.tagName === 'SELECT') {
      value = input.options[input.selectedIndex]?.text || '';
    } else if (input.type === 'date') {
      value = input.value;
    } else {
      value = input.value;
    }
    
    textSpan.textContent = value;
    
    if (input.classList.contains('item-desc')) {
      textSpan.style.display = '-webkit-box';
      textSpan.style.webkitLineClamp = '2';
      textSpan.style.webkitBoxOrient = 'vertical';
      textSpan.style.overflow = 'hidden';
      textSpan.style.textOverflow = 'ellipsis';
      textSpan.style.wordWrap = 'break-word';
      textSpan.style.overflowWrap = 'break-word';
      textSpan.style.lineHeight = '1.3';
      textSpan.style.maxHeight = '2.6em';
    }
      // Add class instead of inline style (CSS !important overrides inline styles)
    input.classList.add('print-hidden-input');
    input.parentNode.insertBefore(textSpan, input);
    state.textSpan = textSpan;
  });
}

function restorePrintLayout() {
  console.log('🔄 Restoring original layout after print');
    originalInputStates.forEach(state => {
    if (state.textSpan && state.textSpan.parentNode) {
      state.textSpan.parentNode.removeChild(state.textSpan);
    }
    // Remove the print-hidden class to restore visibility
    state.element.classList.remove('print-hidden-input');
    state.element.style.display = state.display;
  });
  
  originalInputStates = [];
}

window.addEventListener('beforeprint', preparePrintLayout);
window.addEventListener('afterprint', restorePrintLayout);

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
  setupKeyboardNavigation();
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
    // Disable print button until payment method is selected
  const printBtn = document.getElementById('printBtn');
  if (printBtn) {
    printBtn.disabled = true;
    printBtn.style.opacity = '0.5';
    printBtn.style.cursor = 'not-allowed';
    printBtn.style.pointerEvents = 'none';
    printBtn.title = 'Please select a payment method first';
    console.log('🔒 Print button disabled on init');
  }
  
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
    
    if (!response.ok) {
      console.error('❌ API Error:', response.status, response.statusText);
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {
      console.error('❌ Read failed:', data.error);
      throw new Error(data.error || 'Failed to read data');
    }
    
    const result = {};
    data.valueRanges.forEach((valueRange, index) => {
      result[ranges[index]] = valueRange.values || [];
    });
    return result;
  } catch (error) {
    console.error('❌ Network error reading sheet batch:', error.message);
    showToast('Error reading data. Check network connection.', 'error');
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
      
      if (!response.ok) {
        console.error('❌ API Error:', response.status, response.statusText);
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data.success) {
        console.error('❌ Read failed:', data.error);
        throw new Error(data.error || 'Failed to read data');
      }
      return data.values || [];
    } catch (error) {
      console.error('❌ Network error reading sheet:', error.message);
      showToast('Error reading data. Check network connection.', 'error');
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
    
    if (!response.ok) {
      console.error('❌ API Error:', response.status, response.statusText);
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json();
    if (!result.success) {
      console.error('❌ Append failed:', result.message);
      throw new Error(result.message || 'Failed to append data');
    }
    return true;
  } catch (error) {
    console.error('❌ Network error appending to sheet:', error.message);
    showToast('Error saving data. Check network connection.', 'error');
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
    
    if (!response.ok) {
      console.error('❌ API Error:', response.status, response.statusText);
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json();
    if (!result.success) {
      console.error('❌ Update failed:', result.message);
      throw new Error(result.message || 'Failed to update data');
    }
    return true;  } catch (error) {
    console.error('❌ Network error updating sheet:', error.message);
    showToast('Error updating sheet. Check network connection.', 'error');
    return false;
  }
}

// Export functions for repair-management.js
window.readSheet = readSheet;
window.appendToSheet = appendToSheet;
window.updateSheet = updateSheet;

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
    }  }
  
  document.getElementById('invNum').textContent = `${currentYear}-${String(invoiceCounter).padStart(5, '0')}`;
  
  const printBtn = document.getElementById('printBtn');
  if (printBtn && !isReprintMode) {
    printBtn.disabled = false;
    printBtn.textContent = '🖨️ Print Invoice';
  }
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
    <td><input type="text" class="item-model" placeholder="Model" spellcheck="false"></td>
    <td><input type="text" class="item-desc" placeholder="Description" spellcheck="true"></td>
    <td><input type="number" class="item-qty" min="1" value="1"></td>
    <td><input type="number" class="item-price" min="0" step="0.01" placeholder="0.00"></td>
    <td><span class="amount-display">0.00</span></td>
  `;
  tbody.appendChild(tr);
  
  // Initialize spell-check for the description input
  const descInput = tr.querySelector('.item-desc');
  if (descInput) {
    initSpellCheck(descInput);
  }
};

function calculateTotals() {
  let subtotal = 0;
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const qtyInput = tr.querySelector('.item-qty');
    const priceInput = tr.querySelector('.item-price');
    const amountDisplay = tr.querySelector('.amount-display');
    
    if (qtyInput && priceInput && amountDisplay) {
      const qty = parseFloat(qtyInput.value) || 0;
      const price = parseFloat(priceInput.value) || 0;
      const amount = qty * price;
      amountDisplay.textContent = amount.toFixed(2);
      subtotal += amount;
    }
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
  
  // Enable print button when payment method is selected
  const printBtn = document.getElementById('printBtn');
  if (printBtn) {
    printBtn.disabled = false;
    printBtn.style.opacity = '1';
    printBtn.style.cursor = 'pointer';
    printBtn.style.pointerEvents = 'auto';
    printBtn.title = 'Print Invoice';
    console.log('✅ Print button enabled - Payment method:', method);
  }
};

window.saveAndPrint = async function() {
  console.log('📄 Save and Print clicked');
  
  const btn = document.getElementById('printBtn');
  
  // Ensure button is always enabled at the start (defensive programming)
  if (btn.disabled && btn.textContent === '🖨️ Print Invoice') {
    console.log('⚠️ Button was disabled, re-enabling for validation check');
    btn.disabled = false;
  }
  
  if (btn.disabled) {
    console.log('⚠️ Button already processing');
    return;
  }
  
  if (!currentPaymentMethod) {
    console.log('❌ Validation failed: No payment method selected');
    showToast('Please select a payment method', 'error');
    btn.disabled = false; // Ensure button remains enabled
    return;
  }
  
  const items = collectItems();
  console.log('📦 Items collected:', items.length);
  
  if (items.length === 0) {
    console.log('❌ Validation failed: No items in invoice');
    showToast('Please add at least one item', 'error');
    btn.disabled = false; // Ensure button remains enabled
    return;
  }
  
  const validation = validateInvoiceForm();
  if (!validation.isValid) {
    console.log('❌ Validation failed:', validation.errors);
    btn.disabled = false; // Ensure button remains enabled
    return;
  }
  
  const custName = document.getElementById('custName').value.trim() || 'Walk-in Customer';
  const custPhone = document.getElementById('custPhone').value.trim();
  const custTRN = document.getElementById('custTRN').value.trim();
  const invDate = document.getElementById('invDate').value;
  const invNum = document.getElementById('invNum').textContent;
  
  let subtotal = 0;
  items.forEach(i => { subtotal += i.qty * i.price; });
  const vat = subtotal * 0.05;
  const grandTotal = subtotal + vat;
  btn.disabled = true;
    if (isReprintMode && reprintInvoiceId === invNum) {
    console.log('🔁 Reprint mode: Printing existing invoice');
    btn.textContent = '🖨️ Printing...';
    
    const data = await readSheet("'AKM-POS'!A:S");
    if (data) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === invNum) {
          const rowIndex = i + 1;
          const oldPaymentMethod = data[i][6];
          const oldCustName = data[i][3] || '';
          const oldCustPhone = data[i][4] || '';
          const oldCustTRN = data[i][5] || '';
          
          let hasChanges = false;
          
          if (oldCustName !== custName) {
            console.log(`👤 Customer name changed: ${oldCustName} → ${custName}`);
            await updateSheet(`'AKM-POS'!D${rowIndex}`, [[custName]]);
            hasChanges = true;
          }
          
          if (oldCustPhone !== custPhone) {
            console.log(`📱 Phone changed: ${oldCustPhone} → ${custPhone}`);
            await updateSheet(`'AKM-POS'!E${rowIndex}`, [[custPhone]]);
            hasChanges = true;
          }
          
          if (oldCustTRN !== custTRN) {
            console.log(`🆔 TRN changed: ${oldCustTRN} → ${custTRN}`);
            await updateSheet(`'AKM-POS'!F${rowIndex}`, [[custTRN]]);
            hasChanges = true;
          }
          
          if (oldPaymentMethod !== currentPaymentMethod) {
            console.log(`💳 Payment method changed: ${oldPaymentMethod} → ${currentPaymentMethod}`);
            
            const grandTotal = parseFloat(data[i][9]) || 0;
            let cashImpact = 0, cardImpact = 0, tabbyImpact = 0, chequeImpact = 0;
            
            if (currentPaymentMethod === 'Cash') cashImpact = grandTotal;
            else if (currentPaymentMethod === 'Card') cardImpact = grandTotal;
            else if (currentPaymentMethod === 'Tabby') tabbyImpact = grandTotal;
            else if (currentPaymentMethod === 'Cheque') chequeImpact = grandTotal;
            
            await updateSheet(`'AKM-POS'!G${rowIndex}`, [[currentPaymentMethod]]);
            await updateSheet(`'AKM-POS'!P${rowIndex}:S${rowIndex}`, [[
              cashImpact.toFixed(2),
              cardImpact.toFixed(2),
              tabbyImpact.toFixed(2),
              chequeImpact.toFixed(2)
            ]]);
            hasChanges = true;
          }
          
          if (hasChanges) {
            showToast('Invoice updated successfully', 'success');
          }
          break;
        }
      }
    }
    
    lockInvoiceFields();
    printInvoice(invNum);
    setTimeout(() => {
      isReprintMode = false;
      reprintInvoiceId = null;
      clearForm();
      loadNextInvoiceNumber();
      loadDashboardData();
      loadRecentInvoices();
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
    lockInvoiceFields();
    printInvoice(invNum);
    
    setTimeout(() => {
      clearForm();
      loadNextInvoiceNumber();
      loadDashboardData();
      loadRecentInvoices();
      btn.disabled = false;
      btn.textContent = '🖨️ Print Invoice';
    }, 600);
  } else {
    console.log('❌ Failed to save invoice to sheet');
    showToast('Failed to save invoice', 'error');
    btn.disabled = false;
    btn.textContent = '🖨️ Print Invoice';
  }
};

function lockInvoiceFields() {
  console.log('🔒 Locking invoice fields after print');
  document.getElementById('custName').disabled = true;
  document.getElementById('custPhone').disabled = true;
  document.getElementById('custTRN').disabled = true;
  document.getElementById('invDate').disabled = true;
  
  document.querySelectorAll('#itemsBody input').forEach(input => {
    input.disabled = true;
  });
  
  const printBtn = document.getElementById('printBtn');
  printBtn.textContent = '🖨️ Print Again';
  printBtn.disabled = false;
}

function unlockInvoiceFields() {
  document.getElementById('custName').disabled = false;
  document.getElementById('custPhone').disabled = false;
  document.getElementById('custTRN').disabled = false;
  document.getElementById('invDate').disabled = false;
  
  document.querySelectorAll('#itemsBody input').forEach(input => {
    input.disabled = false;
  });
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const modelInput = tr.querySelector('.item-model');
    const descInput = tr.querySelector('.item-desc');
    const qtyInput = tr.querySelector('.item-qty');
    const priceInput = tr.querySelector('.item-price');
    
    if (modelInput && descInput && qtyInput && priceInput) {
      const model = modelInput.value.trim();
      const desc = descInput.value.trim();
      const qty = parseFloat(qtyInput.value) || 0;
      const price = parseFloat(priceInput.value) || 0;
      
      if ((model || desc) && qty > 0 && price > 0) {
        items.push({ model, desc, qty, price });
      }
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
  // Convert 5-column rows to 2-row layout for print ONLY
  const tbody = document.getElementById('itemsBody');
  const thead = document.querySelector('.items-table thead tr');
  const originalRows = [];
  const originalHeader = thead.cloneNode(true);
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  // Convert header from 5 columns to 4 columns (remove Description column)
  thead.innerHTML = `
    <th style="width: 25%">Model</th>
    <th style="width: 15%">Qty</th>
    <th style="width: 30%">Rate</th>
    <th style="width: 30%">Amount</th>
  `;
  
  // Helper function to remove .00 from numbers
  const formatNumber = (value) => {
    const num = parseFloat(value);
    return isNaN(num) ? value : (num % 1 === 0 ? num.toString() : num.toFixed(2).replace(/\.?0+$/, ''));
  };
  
  rows.forEach(tr => {
    const model = tr.querySelector('.item-model')?.value.trim() || '';
    const desc = tr.querySelector('.item-desc')?.value.trim() || '';
    const qty = tr.querySelector('.item-qty')?.value || '';
    const price = tr.querySelector('.item-price')?.value || '';
    const amount = tr.querySelector('.amount-display')?.textContent.trim() || '';    // Store original row for restoration
    originalRows.push(tr.cloneNode(true));
    
    // NEW LOGIC: Amount-based filtering with smart validation
    const amountNum = parseFloat(amount);
    const qtyNum = parseFloat(qty);
    
    // Check if description is meaningful (not empty and not just placeholder text)
    const hasRealDescription = desc && desc.toLowerCase() !== 'reference';
    
    // HIDE ROW IF:
    // 1. Amount is 0 or empty (MAIN CONDITION)
    // 2. OR: Has description but qty is 0 or empty (can't have item without quantity)
    if (!amount || amountNum === 0 || isNaN(amountNum) ||
        (hasRealDescription && (!qty || qtyNum === 0 || isNaN(qtyNum)))) {
      tr.classList.add('empty-row');
      tr.style.display = 'none';
      return;
    }
    
    // Format numbers - remove .00 from whole numbers
    const qtyFormatted = formatNumber(qty);
    const priceFormatted = formatNumber(price);
    const amountFormatted = formatNumber(amount);
    
    // Convert to Row 1: Model | Qty | Rate | Amount
    tr.className = 'item-row';
    tr.innerHTML = `
      <td><input type="text" class="item-model" value="${model}" disabled></td>
      <td><input type="number" class="item-qty" value="${qtyFormatted}" disabled></td>
      <td><input type="number" class="item-price" value="${priceFormatted}" disabled></td>
      <td><span class="amount-display">${amountFormatted}</span></td>
    `;
    
    // Insert Row 2: Description (merged cell)
    const tr2 = document.createElement('tr');
    tr2.className = 'item-desc-row';
    tr2.innerHTML = `
      <td colspan="4"><input type="text" class="item-desc" value="${desc}" disabled></td>
    `;    tr.parentNode.insertBefore(tr2, tr.nextSibling);
  });
  
  // Format totals - remove .00 from whole numbers
  const subTotal = document.getElementById('subTotal');
  const grandTotal = document.getElementById('grandTotal');
  const vatAmount = document.getElementById('vatAmount');
  
  const originalSubTotal = subTotal?.textContent || '';
  const originalGrandTotal = grandTotal?.textContent || '';
  const originalVatAmount = vatAmount?.textContent || '';
  
  if (subTotal) subTotal.textContent = formatNumber(originalSubTotal);
  if (grandTotal) grandTotal.textContent = formatNumber(originalGrandTotal);
  if (vatAmount) vatAmount.textContent = formatNumber(originalVatAmount);
  
  window.print();
  console.log('✅ Print dialog opened for invoice:', invNum);
  
  // Restore original totals after print
  setTimeout(() => {
    if (subTotal) subTotal.textContent = originalSubTotal;
    if (grandTotal) grandTotal.textContent = originalGrandTotal;
    if (vatAmount) vatAmount.textContent = originalVatAmount;
  }, 100);
    // Restore original 5-column rows and header after print
  setTimeout(() => {
    document.title = originalTitle;
    thead.innerHTML = '';
    originalHeader.childNodes.forEach(node => {
      thead.appendChild(node.cloneNode(true));
    });
    tbody.innerHTML = '';
    originalRows.forEach(row => {
      tbody.appendChild(row);
    });
  }, 500);
}

window.reprintInvoice = async function(invId) {
  console.log('🔄 Loading invoice for reprint:', invId);
  showToast('Loading invoice...', 'success');
  const data = await readSheet("'AKM-POS'!A:S");
  if (!data) {
    console.error('❌ Failed to load sheet data for reprint');
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
      } catch (e) {
        console.error('❌ Failed to parse items JSON:', e);
      }
      
      const tbody = document.getElementById('itemsBody');
      tbody.innerHTML = '';      if (itemsJSON.length > 0) {
        itemsJSON.forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><input type="text" class="item-model" value="${item.model || ''}" disabled></td>
            <td><input type="text" class="item-desc" value="${item.desc || ''}" disabled></td>
            <td><input type="number" class="item-qty" value="${item.qty || 1}" disabled></td>
            <td><input type="number" class="item-price" value="${item.price || 0}" disabled></td>
            <td><span class="amount-display">${((item.qty || 0) * (item.price || 0)).toFixed(2)}</span></td>
          `;
          tbody.appendChild(tr);
        });
      } else {
        for (let j = 0; j < 3; j++) addItemRow();
      }
        // Set payment method and mark as active
      currentPaymentMethod = row[6] || null;
      console.log('💳 Payment method loaded:', currentPaymentMethod);
      document.querySelectorAll('.payment-btn').forEach(btn => {
        const isActive = btn.dataset.method === currentPaymentMethod;
        btn.classList.toggle('active', isActive);
        if (isActive) {
          console.log('✅ Payment button activated:', btn.dataset.method);
        }
      });
      
      calculateTotals();
      isReprintMode = true;
      reprintInvoiceId = invId;
      
      // Customer details editable, date and items locked
      document.getElementById('custName').disabled = false;
      document.getElementById('custPhone').disabled = false;
      document.getElementById('custTRN').disabled = false;
      document.getElementById('invDate').disabled = true;      // Ensure print button is enabled and ready
      const printBtn = document.getElementById('printBtn');
      printBtn.disabled = false;
      printBtn.style.opacity = '1';
      printBtn.style.cursor = 'pointer';
      printBtn.style.pointerEvents = 'auto';
      printBtn.title = '';
      printBtn.textContent = '🖨️ Reprint Invoice';
      console.log('🖨️ Print button enabled for reprint');
      
      // Hide Reset button in reprint mode (items are locked)
      const clearBtn = document.querySelector('.btn-clear');
      if (clearBtn) {
        clearBtn.style.display = 'none';
        console.log('🗑️ Reset button hidden (reprint mode)');
      }
      
      console.log('✅ Invoice loaded for reprint. Customer details and payment method can be changed.');
      showToast('Invoice loaded. Update customer details/payment method if needed, then reprint.', 'success');
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
  unlockInvoiceFields();
  
  document.getElementById('custName').value = '';
  document.getElementById('custPhone').value = '';
  document.getElementById('custTRN').value = '';
  document.getElementById('invDate').valueAsDate = new Date();
    const tbody = document.getElementById('itemsBody');
  tbody.innerHTML = '';
  for (let i = 0; i < 3; i++) addItemRow();
  currentPaymentMethod = null;
  isReprintMode = false;
  reprintInvoiceId = null;
  
  document.querySelectorAll('.payment-btn').forEach(btn => btn.classList.remove('active'));
  calculateTotals();
    const printBtn = document.getElementById('printBtn');
  printBtn.disabled = true;
  printBtn.style.opacity = '0.5';
  printBtn.style.cursor = 'not-allowed';
  printBtn.style.pointerEvents = 'none';
  printBtn.title = 'Please select a payment method first';
  printBtn.textContent = '🖨️ Print Invoice';
  
  // Show Reset button again
  const clearBtn = document.querySelector('.btn-clear');
  if (clearBtn) clearBtn.style.display = '';
  
  document.getElementById('custName').focus();
};

window.openDepositModal = function() {
  document.getElementById('depositModal').classList.add('show');
  document.getElementById('depositName').focus();
};

window.closeDepositModal = function() {
  document.getElementById('depositModal').classList.remove('show');
  document.getElementById('depositName').value = '';
  document.getElementById('depositAmount').value = '';
  document.getElementById('depositBank').value = '';
  document.getElementById('depositRef').value = '';
};

async function getNextDepositID() {
  try {
    const data = await readSheet("Deposits!A:A");
    const today = new Date();
    const yearMonth = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    if (!data || data.length <= 1) {
      return `${yearMonth}-01`;
    }
    
    const lastDepositID = data[data.length - 1][0];
    const match = lastDepositID.match(/(\d{4})-(\d+)/);
    
    if (match) {
      const lastYearMonth = match[1];
      const lastSequence = parseInt(match[2]);
      
      if (lastYearMonth === yearMonth) {
        const nextSequence = String(lastSequence + 1).padStart(2, '0');
        return `${yearMonth}-${nextSequence}`;
      }
    }
    
    return `${yearMonth}-01`;
  } catch (error) {
    console.error('❌ Error generating deposit ID:', error);
    const today = new Date();
    const yearMonth = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}`;
    return `${yearMonth}-01`;
  }
}

window.submitDeposit = async function() {
  const depositorName = document.getElementById('depositName').value.trim();
  const amount = parseFloat(document.getElementById('depositAmount').value);
  const bankName = document.getElementById('depositBank').value.trim();
  const slipNumber = document.getElementById('depositRef').value.trim();
  
  if (!depositorName) {
    showToast('Please enter depositor name', 'error');
    document.getElementById('depositName').focus();
    return;
  }
  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    document.getElementById('depositAmount').focus();
    return;
  }
  if (!bankName) {
    showToast('Please enter bank name', 'error');
    document.getElementById('depositBank').focus();
    return;
  }
  if (!slipNumber) {
    showToast('Please enter slip number', 'error');
    document.getElementById('depositRef').focus();
    return;
  }
  
  const today = new Date();
  const depositID = await getNextDepositID();
  
  // Deposits sheet columns: DepositID, Date, TimeStamp, Amount, Bank, ReferenceNumber, CashImpact, Notes
  const depositRow = [
    depositID,                                          // DepositID (Column A)
    formatDate(today, 'YYYY-MM-DD'),                   // Date (Column B)
    formatDate(today, 'YYYY-MM-DD HH:mm:ss'),          // TimeStamp (Column C)
    amount.toFixed(2),                                  // Amount (Column D)
    bankName,                                           // Bank (Column E)
    slipNumber,                                         // ReferenceNumber (Column F)
    (-amount).toFixed(2),                               // CashImpact (Column G) - negative
    depositorName                                       // Notes (Column H)
  ];
  
  console.log('💾 Saving deposit:', depositRow);
  
  const success = await appendToSheet('Deposits!A:H', [depositRow]);
  if (success) {
    showToast('✅ Deposit recorded successfully', 'success');
    closeDepositModal();
    await loadDashboardData();
  } else {
    showToast('❌ Failed to save deposit. Please try again.', 'error');
  }
};

let currentExpenseMethod = null;

window.openExpenseModal = function() {
  document.getElementById('expenseModal').classList.add('show');
  document.getElementById('expenseCategory').focus();
  
  // Setup payment method button listeners
  const expenseMethodButtons = document.querySelectorAll('.expense-method-btn');
  expenseMethodButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      expenseMethodButtons.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentExpenseMethod = this.dataset.method;
      console.log('💳 Expense method selected:', currentExpenseMethod);
    });
  });
};

window.closeExpenseModal = function() {
  document.getElementById('expenseModal').classList.remove('show');
  document.getElementById('expenseCategory').value = '';
  document.getElementById('expenseDesc').value = '';
  document.getElementById('expenseAmount').value = '';
  document.getElementById('expenseReceipt').value = '';
  
  // Clear payment method selection
  const expenseMethodButtons = document.querySelectorAll('.expense-method-btn');
  expenseMethodButtons.forEach(btn => btn.classList.remove('active'));
  currentExpenseMethod = null;
};

async function getNextExpenseID() {
  try {
    const data = await readSheet("Expenses!A:A");
    const today = new Date();
    const yearMonth = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    if (!data || data.length <= 1) {
      return `${yearMonth}-01`;
    }
    
    const lastExpenseID = data[data.length - 1][0];
    const match = lastExpenseID.match(/(\d{4})-(\d+)/);
    
    if (match) {
      const lastYearMonth = match[1];
      const lastSequence = parseInt(match[2]);
      
      if (lastYearMonth === yearMonth) {
        const nextSequence = String(lastSequence + 1).padStart(2, '0');
        return `${yearMonth}-${nextSequence}`;
      }
    }
    
    return `${yearMonth}-01`;
  } catch (error) {
    console.error('❌ Error generating expense ID:', error);
    const today = new Date();
    const yearMonth = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}`;
    return `${yearMonth}-01`;
  }
}

window.submitExpense = async function() {
  const category = document.getElementById('expenseCategory').value;
  const description = document.getElementById('expenseDesc').value.trim();
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  const receipt = document.getElementById('expenseReceipt').value.trim();
  
  // Validation
  if (!category) {
    showToast('Please select a category', 'error');
    document.getElementById('expenseCategory').focus();
    return;
  }
  if (!description) {
    showToast('Please enter a description', 'error');
    document.getElementById('expenseDesc').focus();
    return;
  }
  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    document.getElementById('expenseAmount').focus();
    return;
  }
  if (!currentExpenseMethod) {
    showToast('Please select a payment method', 'error');
    return;
  }
  if (!receipt) {
    showToast('Please enter a receipt number', 'error');
    document.getElementById('expenseReceipt').focus();
    return;
  }
  
  const today = new Date();
  const expenseID = await getNextExpenseID();
  
  // Expenses sheet columns: ExpenseID, Date, TimeStamp, Description, Amount, Method, ReceiptNumber, Category, CashImpact, Notes
  const expenseRow = [
    expenseID,                                          // ExpenseID (Column A)
    formatDate(today, 'YYYY-MM-DD'),                   // Date (Column B)
    formatDate(today, 'YYYY-MM-DD HH:mm:ss'),          // TimeStamp (Column C)
    description,                                        // Description (Column D)
    amount.toFixed(2),                                  // Amount (Column E)
    currentExpenseMethod,                               // Method (Column F)
    receipt,                                            // ReceiptNumber (Column G)
    category,                                           // Category (Column H)
    (-amount).toFixed(2),                               // CashImpact (Column I) - negative
    ''                                                  // Notes (Column J) - empty, filled manually in sheet
  ];
  
  console.log('💾 Saving expense:', expenseRow);
  
  const success = await appendToSheet('Expenses!A:J', [expenseRow]);
  if (success) {
    showToast('✅ Expense recorded successfully', 'success');
    closeExpenseModal();
    await loadDashboardData();
  } else {
    showToast('❌ Failed to save expense. Please try again.', 'error');
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
  
  // Format date as "06-Dec-2025"
  const reportDate = formatDate(new Date(), 'DD-MMM-YYYY');
  
  const reportHTML = `
    <div style="text-align:center;font-weight:bold;font-size:14px;margin:4mm 0;">Daily Report - ${reportDate}</div>
    <div style="border-bottom:2px solid #000;margin:3mm 0;"></div>
    <div style="display:flex;justify-content:space-between;margin:2mm 3mm;font-weight:bold;"><span>Total Sales:</span><span>AED ${totalSales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:2mm 3mm;font-weight:bold;"><span>Cash:</span><span>AED ${cashSales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:2mm 3mm;font-weight:bold;"><span>Card:</span><span>AED ${cardSales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:2mm 3mm;font-weight:bold;"><span>Tabby:</span><span>AED ${tabbySales.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:2mm 3mm;font-weight:bold;"><span>Cheque:</span><span>AED ${chequeSales.toFixed(2)}</span></div>
    <div style="border-bottom:2px solid #000;margin:3mm 0;"></div>
    <div style="display:flex;justify-content:space-between;margin:2mm 3mm;font-weight:bold;"><span>Cash in Hand:</span><span>AED ${cashInHand.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;margin:2mm 3mm;font-weight:bold;"><span>Refunds:</span><span>${refunds}</span></div>
  `;
  
  const container = document.getElementById('dailyReportContainer');
  container.innerHTML = reportHTML;
  document.body.classList.add('printing-daily-report');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-daily-report'), 500);
};

function formatDate(date, format) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Replace in specific order to avoid conflicts (MMM before MM, mm before ss)
  return format
    .replace('YYYY', year)
    .replace('MMM', monthNames[date.getMonth()])
    .replace('MM', month)
    .replace('DD', day)
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

// Export showToast for repair-management.js
window.showToast = showToast;

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

function setupKeyboardNavigation() {
  const printBtn = document.getElementById('printBtn');
  
  document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    
    // Handle payment button navigation (Left/Right arrows)
    if (activeElement.classList.contains('payment-btn')) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const paymentButtons = Array.from(document.querySelectorAll('.payment-btn'));
        const currentIndex = paymentButtons.indexOf(activeElement);
        
        if (e.key === 'ArrowRight') {
          const nextIndex = (currentIndex + 1) % paymentButtons.length;
          paymentButtons[nextIndex].focus();
        } else if (e.key === 'ArrowLeft') {
          const prevIndex = (currentIndex - 1 + paymentButtons.length) % paymentButtons.length;
          paymentButtons[prevIndex].focus();
        }
        return;
      }
      
      // Enter on payment button: select it and move to print
      if (e.key === 'Enter') {
        e.preventDefault();
        activeElement.click(); // Select the payment method
        printBtn.focus();
        return;
      }
    }
    
    if (e.key === 'Enter') {
      // Enter on print button: trigger save and print
      if (activeElement.id === 'printBtn') {
        e.preventDefault();
        saveAndPrint();
        return;
      }
      
      // Navigation within items table
      if (activeElement.closest('#itemsBody')) {
        e.preventDefault();
        const currentRow = activeElement.closest('tr');
        const allRows = Array.from(document.querySelectorAll('#itemsBody tr'));
        const currentRowIndex = allRows.indexOf(currentRow);
        
        // Last field in last row: move to first payment button
        if (activeElement.classList.contains('item-price')) {
          if (currentRowIndex < allRows.length - 1) {
            const nextRow = allRows[currentRowIndex + 1];
            const firstInput = nextRow.querySelector('.item-model');
            if (firstInput) firstInput.focus();
          } else {
            // Move to first payment button instead of print
            const firstPaymentBtn = document.querySelector('.payment-btn');
            if (firstPaymentBtn) firstPaymentBtn.focus();
          }
        } else {
          // Move to next field in current row
          const inputs = Array.from(currentRow.querySelectorAll('input'));
          const currentIndex = inputs.indexOf(activeElement);
          if (currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus();
          }
        }
      }
    }
  });
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeDepositModal();
    closeExpenseModal();
  }
});

// ===== SMART SPELL-CHECKING SYSTEM =====

// Custom dictionary for musical instruments, business terms, and brand names
const customDictionary = {
  // Musical instruments
  instruments: ['guitar', 'piano', 'violin', 'saxophone', 'drums', 'keyboard', 'synthesizer', 
                'amplifier', 'mixer', 'microphone', 'mic', 'speaker', 'bass', 'acoustic', 
                'electric', 'classical', 'flute', 'clarinet', 'trumpet', 'trombone', 'cello', 
                'viola', 'harp', 'ukulele', 'mandolin', 'banjo', 'accordion', 'harmonica'],
  
  // Accessories and equipment
  accessories: ['cable', 'stand', 'bench', 'case', 'bag', 'strap', 'pick', 'picks', 'strings', 
                'capo', 'tuner', 'metronome', 'pedal', 'footswitch', 'adapter', 'connector', 
                'jack', 'xlr', 'trs', 'rca', 'midi', 'usb', 'aux', 'bluetooth', 'wireless'],
  
  // Business and rental terms
  business: ['rental', 'delivery', 'installation', 'service', 'tuning', 'repair', 'maintenance',
             'pickup', 'dropoff', 'studio', 'event', 'concert', 'performance', 'rehearsal',
             'lesson', 'workshop', 'recording', 'warranty', 'guarantee', 'refund', 'exchange'],
  
  // Brand names (will be auto-capitalized)
  brands: ['yamaha', 'cort', 'ibanez', 'roland', 'jbl', 'prosound', 'fender', 'gibson', 
           'steinway', 'kawai', 'casio', 'korg', 'boss', 'shure', 'sennheiser', 'behringer',
           'mackie', 'focusrite', 'presonus', 'mxr', 'dunlop', 'ernie', 'ball', 'daddario',
           'elixir', 'martin', 'takamine', 'taylor', 'ovation', 'epiphone']
};

// Flatten all dictionary words for quick lookup
const allCustomWords = [
  ...customDictionary.instruments,
  ...customDictionary.accessories,
  ...customDictionary.business,
  ...customDictionary.brands
];

// Brand name capitalization map
const brandCapitalization = {
  'yamaha': 'Yamaha',
  'cort': 'Cort',
  'ibanez': 'Ibanez',
  'roland': 'Roland',
  'jbl': 'JBL',
  'prosound': 'Prosound',
  'fender': 'Fender',
  'gibson': 'Gibson',
  'steinway': 'Steinway',
  'kawai': 'Kawai',
  'casio': 'Casio',
  'korg': 'Korg',
  'boss': 'BOSS',
  'shure': 'Shure',
  'sennheiser': 'Sennheiser',
  'behringer': 'Behringer',
  'mackie': 'Mackie',
  'focusrite': 'Focusrite',
  'presonus': 'PreSonus',
  'mxr': 'MXR',
  'dunlop': 'Dunlop',
  'ernie': 'Ernie',
  'ball': 'Ball',
  'daddario': "D'Addario",
  'elixir': 'Elixir',
  'martin': 'Martin',
  'takamine': 'Takamine',
  'taylor': 'Taylor',
  'ovation': 'Ovation',
  'epiphone': 'Epiphone'
};

// Check if a word is a model number (mix of uppercase + digits)
function isModelNumber(word) {
  // Model patterns: ZS12, CW422, SS400, C7X, G5, ZA15
  return /^[A-Z0-9]+$/.test(word) && /[A-Z]/.test(word) && /[0-9]/.test(word);
}

// Auto-capitalize first letter of sentence
function capitalizeFirstLetter(text) {
  return text.replace(/(^\s*\w|[.!?]\s+\w)/g, letter => letter.toUpperCase());
}

// Auto-capitalize brand names
function capitalizeBrands(text) {
  let result = text;
  Object.keys(brandCapitalization).forEach(brand => {
    const regex = new RegExp(`\\b${brand}\\b`, 'gi');
    result = result.replace(regex, brandCapitalization[brand]);
  });
  return result;
}

// Auto-capitalize model numbers
function capitalizeModels(text) {
  return text.replace(/\b([a-z]+\d+|[a-z]\d+[a-z]?)\b/gi, match => match.toUpperCase());
}

// Apply all auto-capitalization rules
function autoCapitalize(text) {
  let result = capitalizeFirstLetter(text);
  result = capitalizeBrands(result);
  result = capitalizeModels(result);
  return result;
}

// Initialize spell-check for a description input
function initSpellCheck(input) {
  if (!input || input.classList.contains('spell-check-initialized')) return;
  
  input.classList.add('spell-check-initialized');
  input.setAttribute('spellcheck', 'true');
  
  // Auto-capitalization on blur
  input.addEventListener('blur', function() {
    if (this.value) {
      const originalValue = this.value;
      const capitalizedValue = autoCapitalize(this.value);
      if (originalValue !== capitalizedValue) {
        this.value = capitalizedValue;
      }
    }
  });
  
  // Auto-capitalize as user types (debounced)
  let capitalizationTimeout;
  input.addEventListener('input', function() {
    clearTimeout(capitalizationTimeout);
    capitalizationTimeout = setTimeout(() => {
      const cursorPos = this.selectionStart;
      const originalValue = this.value;
      const capitalizedValue = autoCapitalize(this.value);
      if (originalValue !== capitalizedValue) {
        this.value = capitalizedValue;
        this.setSelectionRange(cursorPos, cursorPos);
      }
    }, 500);
  });
}

// Initialize spell-check for all existing description inputs
function initAllSpellChecks() {
  document.querySelectorAll('.item-desc').forEach(input => {
    initSpellCheck(input);
  });
  
  // Ensure model inputs have spellcheck disabled
  document.querySelectorAll('.item-model').forEach(input => {
    input.setAttribute('spellcheck', 'false');
  });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
  // Wait a bit to ensure DOM is ready
  setTimeout(initAllSpellChecks, 500);
});

// Re-initialize when items are reprinted/loaded
const originalReprintInvoice = window.reprintInvoice;
if (originalReprintInvoice) {
  window.reprintInvoice = async function(invId) {
    await originalReprintInvoice(invId);
    setTimeout(initAllSpellChecks, 300);
  };
}

console.log('✅ Smart spell-checking system initialized');
console.log('📚 Custom dictionary loaded:', allCustomWords.length, 'words');
