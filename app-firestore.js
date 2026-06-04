// AKM-POS v2.1 - FIRESTORE MIGRATION
// Migrated from Google Sheets to Firebase Firestore
// Benefits: <200ms load times (vs 20-30s), native offline mode, real-time sync
// Centralized configuration for better maintainability

// Firebase imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Import Firestore utilities (handles all database operations)
import {
  db,
  getNextInvoiceNumber,
  getNextDepositId,
  getNextExpenseId,
  saveInvoice,
  saveDeposit,
  saveExpense,
  getTodayInvoices,
  getTodayDeposits,
  getTodayExpenses,
  loadRecentInvoices as getRecentInvoicesFromFirestore,
  markInvoiceAsRefunded,
  formatDate,
  formatTime
} from './firestore-utils.js';

// Import centralized configuration
import { FIREBASE_CONFIG, APP_CONFIG, debugLog } from './config.js';

const ALLOWED_EMAIL = APP_CONFIG.ALLOWED_EMAIL;
const CONFIG = APP_CONFIG.VALIDATION;
const BUSINESS_CONFIG = APP_CONFIG.BUSINESS;

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: 'akm-music.com' });

// Global state
let currentUser = null;
let currentPaymentMethod = null;
let invoiceCounter = 15001;
let recentInvoicesDays = 7;
let isReprintMode = false;
let reprintInvoiceId = null;
let originalInputStates = [];

// PRINT FIX: Convert inputs to text spans before printing (preserved from v127)
function preparePrintLayout() {
  debugLog('📝 Preparing print layout - converting inputs to text spans');
  originalInputStates = [];
  
  const invoiceContainer = document.querySelector('.invoice-container');
  if (!invoiceContainer) return;
  
  // Hide empty item rows before printing
  const itemsBody = document.getElementById('itemsBody');
  if (itemsBody) {
    for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
      const row = itemsBody.querySelector(`tr[data-row-index="${i}"]`);
      const modelInput = document.getElementById(`model${i}`);
      const descInput = document.getElementById(`description${i}`);
      
      // Hide row if both model and description are empty
      if (row && modelInput && descInput) {
        const isEmpty = !modelInput.value.trim() && !descInput.value.trim();
        if (isEmpty) {
          row.classList.add('print-hidden-row');
          row.style.display = 'none';
        }
      }
    }
  }
  
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
    
    // Preserve whitespace for description fields
    if (input.id?.includes('description')) {
      textSpan.style.whiteSpace = 'pre-wrap';
      textSpan.style.wordBreak = 'break-word';
    }
    
    textSpan.textContent = value || '\u00A0'; // Non-breaking space if empty
    textSpan.style.display = 'inline-block';
    textSpan.style.width = '100%';
    
    input.style.display = 'none';
    input.parentNode.insertBefore(textSpan, input);
  });
  
  debugLog('✅ Print layout prepared:', originalInputStates.length, 'inputs converted');
}

function restorePrintLayout() {
  debugLog('🔄 Restoring normal layout');
  
  const textSpans = document.querySelectorAll('.print-text-replacement');
  textSpans.forEach(span => span.remove());
  
  originalInputStates.forEach(state => {
    state.element.style.display = state.display;
  });
  
  // Restore hidden empty rows (show only first 3, keep rest hidden unless they were already visible)
  const itemsBody = document.getElementById('itemsBody');
  if (itemsBody) {
    for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
      const row = itemsBody.querySelector(`tr[data-row-index="${i}"]`);
      if (row && row.classList.contains('print-hidden-row')) {
        row.classList.remove('print-hidden-row');
        // Keep rows 1-3 visible, hide the rest if they were auto-hidden
        if (i > 3) {
          const modelInput = document.getElementById(`model${i}`);
          const isEmpty = !modelInput || !modelInput.value.trim();
          if (isEmpty) {
            row.style.display = 'none';
          }
        } else {
          row.style.display = '';
        }
      }
    }
  }
  
  originalInputStates = [];
  debugLog('✅ Layout restored');
}

// Register print event handlers
window.removeEventListener('beforeprint', preparePrintLayout);
window.removeEventListener('afterprint', restorePrintLayout);
window.addEventListener('beforeprint', preparePrintLayout);
window.addEventListener('afterprint', restorePrintLayout);

// Debug logging
function debugLog(...args) {
  console.log('%c[AKM-POS]', 'color: #4CAF50; font-weight: bold', ...args);
}

// Error handlers (preserved)
window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled promise rejection:', event.reason);
  if (event.reason?.message?.includes('Failed to fetch')) {
    showToast('⚠️ Network connection issue. Check your internet.', 'error');
  }
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  console.error('❌ Global error:', event.message, event.filename, event.lineno);
});

// ============================================
// AUTHENTICATION (UNCHANGED)
// ============================================

async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    const email = result.user.email;
    
    if (email !== ALLOWED_EMAIL) {
      await signOut(auth);
      showToast(`Access denied. Only ${ALLOWED_EMAIL} is allowed.`, 'error');
      return;
    }
    
    currentUser = result.user;
    showMainApp();
  } catch (error) {
    console.error('Login error:', error);
    showToast('Login failed. Please try again.', 'error');
  }
}

async function logout() {
  try {
    await signOut(auth);
    currentUser = null;
    showLoginScreen();
  } catch (error) {
    console.error('Logout error:', error);
    showToast('Logout failed.', 'error');
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
  initializePOS();
}

// ============================================
// INITIALIZATION (REFACTORED FOR FIRESTORE)
// ============================================

async function initializePOS() {
  debugLog('🚀 Initializing AKM-POS with Firestore...');
  
  const loadingScreen = document.getElementById('loadingScreen');
  // FIX: Align with index.html where the loading text element id is 'loadingText'
  const loadingTextEl = document.getElementById('loadingText');
  
  if (loadingScreen) {
    loadingScreen.style.display = 'flex';
  }
    try {
    // Step 0: Initialize items table
    initializeItemsTable();
    
    // Step 1: Load invoice number (FAST with Firestore!)
    updateLoadingProgress('Loading invoice number...');
    await loadNextInvoiceNumber();
    
    // Step 2: Load dashboard data
    updateLoadingProgress('Loading dashboard...');
    await loadDashboardData();
    
    // Step 3: Load recent invoices
    updateLoadingProgress('Loading recent invoices...');
    await loadRecentInvoices();
    
    // Step 4: Setup auto-refresh (now much faster!)
    setupAutoRefresh();
    
    debugLog('✅ POS initialized successfully');
    showToast('✅ POS ready! Firestore connected.', 'success');
    
  } catch (error) {
    console.error('❌ Initialization error:', error);
    showToast('⚠️ Initialization issue. You can still create invoices in offline mode.', 'warning');
  } finally {
    if (loadingScreen) {
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 300);
    }
  }
}

function updateLoadingProgress(message) {
  // FIX: Use the correct element id 'loadingText' from index.html
  const loadingText = document.getElementById('loadingText');
  if (loadingText) {
    loadingText.textContent = message;
  }
  debugLog('⏳', message);
}

// ============================================
// ITEMS TABLE INITIALIZATION
// ============================================

function initializeItemsTable() {
  const itemsBody = document.getElementById('itemsBody');
  if (!itemsBody) return;
  
  // Create 10 item rows (initially show only 3)
  for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
    const row = document.createElement('tr');
    row.setAttribute('data-row-index', i);
    row.innerHTML = `
      <td><input type="text" id="model${i}" class="item-input" placeholder="Model" autocomplete="off"></td>
      <td><input type="text" id="description${i}" class="item-input" placeholder="Description" autocomplete="off"></td>
      <td><input type="number" id="quantity${i}" class="item-input" min="1" value="1" autocomplete="off"></td>
      <td><input type="number" id="price${i}" class="item-input" min="0" step="0.01" placeholder="0.00" autocomplete="off"></td>
      <td class="amount-cell" id="amount${i}">0.00</td>
    `;
    
    // Hide rows after the 3rd one
    if (i > 3) {
      row.style.display = 'none';
    }
    
    itemsBody.appendChild(row);
    
    // Add event listeners for auto-calculation
    const qtyInput = row.querySelector(`#quantity${i}`);
    const priceInput = row.querySelector(`#price${i}`);
    const amountCell = row.querySelector(`#amount${i}`);
    
    const calculateAmount = () => {
      const qty = parseFloat(qtyInput.value) || 0;
      const price = parseFloat(priceInput.value) || 0;
      const amount = qty * price;
      amountCell.textContent = amount.toFixed(2);
      calculateTotals();
    };
    
    qtyInput.addEventListener('input', calculateAmount);
    priceInput.addEventListener('input', calculateAmount);
    
    // Tab navigation
    const modelInput = row.querySelector(`#model${i}`);
    const descInput = row.querySelector(`#description${i}`);
    
    priceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && i < CONFIG.MAX_ITEMS_PER_INVOICE) {
        e.preventDefault();
        const nextRow = document.querySelector(`tr[data-row-index="${i + 1}"]`);
        if (nextRow && nextRow.style.display === 'none') {
          nextRow.style.display = '';
        }
        document.getElementById(`model${i + 1}`)?.focus();
      }
    });
  }
  
  debugLog('✅ Items table initialized with', CONFIG.MAX_ITEMS_PER_INVOICE, 'rows (3 visible)');
}

function calculateTotals() {
  let subtotal = 0;
  
  for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
    const amountCell = document.getElementById(`amount${i}`);
    if (amountCell) {
      subtotal += parseFloat(amountCell.textContent) || 0;
    }
  }
  
  const vat = subtotal * CONFIG.VAT_RATE;
  const grandTotal = subtotal + vat;
  
  const subtotalEl = document.getElementById('subTotal');
  const vatEl = document.getElementById('vatAmount');
  const grandTotalEl = document.getElementById('grandTotal');
  
  if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2);
  if (vatEl) vatEl.textContent = vat.toFixed(2);
  if (grandTotalEl) grandTotalEl.textContent = grandTotal.toFixed(2);
}

// Add item row (show next hidden row)
function addItemRow() {
  const itemsBody = document.getElementById('itemsBody');
  if (!itemsBody) return;
  
  // Find the first hidden row
  for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
    const row = itemsBody.querySelector(`tr[data-row-index="${i}"]`);
    if (row && row.style.display === 'none') {
      row.style.display = '';
      // Focus on the model input of the newly shown row
      document.getElementById(`model${i}`)?.focus();
      debugLog(`✅ Added item row ${i}`);
      return;
    }
  }
  
  showToast('Maximum 10 items per invoice', 'warning');
}

// ============================================
// INVOICE NUMBER GENERATION (FIRESTORE)
// ============================================

async function loadNextInvoiceNumber() {
  const currentYear = new Date().getFullYear();
  
  try {
    // Get next invoice number from Firestore counter (atomic, fast!)
    const invoiceNumber = await getNextInvoiceNumber();
    
    // Parse it: "2025-15001" -> 15001
    const match = invoiceNumber.match(/(\d{4})-(\d+)/);
    if (match) {
      invoiceCounter = parseInt(match[2]);
    }
    
    document.getElementById('invNum').textContent = invoiceNumber;
    
    const printBtn = document.getElementById('printBtn');
    if (printBtn && !isReprintMode) {
      printBtn.disabled = false;
      printBtn.textContent = 'Print Invoice';
    }
    
    debugLog('✅ Invoice number ready:', invoiceNumber);
    
  } catch (error) {
    console.error('❌ Error loading invoice number:', error);
    invoiceCounter = 15001;
    document.getElementById('invNum').textContent = `${currentYear}-${String(invoiceCounter).padStart(5, '0')}`;
  }
}

// ============================================
// DASHBOARD (FIRESTORE - REAL-TIME AGGREGATION)
// ============================================

async function loadDashboardData() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    
    // Load today's data in parallel (3 queries, ~200ms total!)
    const [invoices, deposits, expenses] = await Promise.all([
      getTodayInvoices(today),
      getTodayDeposits(today),
      getTodayExpenses(today)
    ]);
    
    // Aggregate sales
    let cash = 0, card = 0, tabby = 0, cheque = 0;
    
    invoices.forEach(invoice => {
      if (invoice.status === 'Paid') {
        cash += invoice.impacts.cash || 0;
        card += invoice.impacts.card || 0;
        tabby += invoice.impacts.tabby || 0;
        cheque += invoice.impacts.cheque || 0;
      }
    });
    
    const totalSales = cash + card + tabby + cheque;
    
    // Sum deposits
    const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
    
    // Sum expenses
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    // Calculate cash in hand
    const cashInHand = cash - totalDeposits - totalExpenses;
    
    // Update quick info in sidebar
    updateElement('todaySalesQuick', totalSales.toFixed(2));
    updateElement('cashInHandQuick', cashInHand.toFixed(2));
    
    debugLog('✅ Dashboard loaded:', { totalSales, cashInHand });
    
  } catch (error) {
    console.error('❌ Error loading dashboard:', error);
    updateElement('todaySalesQuick', '0.00');
    updateElement('cashInHandQuick', '0.00');
  }
}

function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ============================================
// RECENT INVOICES (FIRESTORE - FAST QUERIES)
// ============================================

async function loadRecentInvoices() {
  try {
    const invoices = await getRecentInvoicesFromFirestore(CONFIG.RECENT_INVOICES_LOAD_LIMIT);
    
    const container = document.getElementById('recentInvoices');
    if (!container) {
      debugLog('⚠️ recentInvoices container not found');
      return;
    }
    
    if (invoices.length === 0) {
      container.innerHTML = '<div class="loading-text">No recent invoices</div>';
      return;
    }
    
    // Create invoice cards for sidebar
    container.innerHTML = invoices.map(invoice => `
      <div class="invoice-card ${invoice.status === 'Refunded' ? 'refunded' : ''}" onclick="reprintInvoice('${invoice.id}')">
        <div class="invoice-number">${invoice.invoiceNumber}</div>
        <div class="invoice-details">
          <span>${invoice.date}</span>
          <span>AED ${invoice.grandTotal.toFixed(2)}</span>
        </div>
        <div class="invoice-meta">
          <span>${invoice.customer || 'Walk-in'}</span>
          <span class="payment-badge">${invoice.payment}</span>
        </div>
        ${invoice.status === 'Refunded' ? '<div class="refunded-badge">REFUNDED</div>' : ''}
      </div>
    `).join('');
    
    debugLog('✅ Loaded', invoices.length, 'recent invoices');
    
  } catch (error) {
    console.error('❌ Error loading recent invoices:', error);
    const container = document.getElementById('recentInvoices');
    if (container) {
      container.innerHTML = '<div class="loading-text" style="color: #f44336;">Error loading invoices</div>';
    }
  }
}

// ============================================
// INVOICE CREATION (FIRESTORE - ATOMIC WRITES)
// ============================================

async function saveNewInvoice() {
  const invoiceData = collectInvoiceData();
  
  if (!invoiceData) {
    showToast('Please fill in all required fields', 'error');
    return;
  }
  
  try {
    // Disable print button during save
    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
      printBtn.disabled = true;
      printBtn.textContent = 'Saving...';
    }
    
    // Save to Firestore (works offline too!)
    const docRef = await saveInvoice(invoiceData);
    
    debugLog('✅ Invoice saved to Firestore:', docRef.id);
    showToast('✅ Invoice saved successfully', 'success');
    
    // Print invoice
    setTimeout(() => {
      window.print();
    }, 300);
    
    // Refresh dashboard & recent invoices
    setTimeout(async () => {
      await loadDashboardData();
      await loadRecentInvoices();
      await loadNextInvoiceNumber();
      resetInvoiceForm();
      
      if (printBtn) {
        printBtn.disabled = false;
        printBtn.textContent = 'Print Invoice';
      }
    }, CONFIG.PRINT_RESTORE_DELAY_MS);
    
  } catch (error) {
    console.error('❌ Error saving invoice:', error);
    showToast('⚠️ Error saving invoice. It may be saved offline and synced later.', 'warning');
    
    // Still allow printing in offline mode
    setTimeout(() => {
      window.print();
    }, 300);
    
    setTimeout(() => {
      resetInvoiceForm();
      const printBtn = document.getElementById('printBtn');
      if (printBtn) {
        printBtn.disabled = false;
        printBtn.textContent = 'Print Invoice';
      }
    }, CONFIG.PRINT_RESTORE_DELAY_MS);
  }
}

function collectInvoiceData() {
  // Get invoice number
  const invoiceNumber = document.getElementById('invNum').textContent.trim();
  
  // Get date
  const dateInput = document.getElementById('invDate').value;
  if (!dateInput) {
    showToast('Please select invoice date', 'error');
    return null;
  }
    const invDate = new Date(dateInput);
  const date = formatDate(invDate, 'YYYY-MM-DD');
  const time = formatTime(new Date());
  
  // Get customer info (match HTML IDs: custName, custPhone, custTRN)
  const customerName = document.getElementById('custName').value.trim() || 'Walk-in Customer';
  const customerPhone = document.getElementById('custPhone').value.trim();
  const customerTRN = document.getElementById('custTRN').value.trim();
  
  // Get payment method
  if (!currentPaymentMethod) {
    showToast('Please select payment method', 'error');
    return null;
  }
    // Get totals
  const subtotal = parseFloat(document.getElementById('subTotal').textContent) || 0;
  const vat = parseFloat(document.getElementById('vatAmount').textContent) || 0;
  const grandTotal = parseFloat(document.getElementById('grandTotal').textContent) || 0;
  
  if (grandTotal <= 0) {
    showToast('Invoice total must be greater than zero', 'error');
    return null;
  }
  
  // Collect items
  const items = [];
  for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
    const model = document.getElementById(`model${i}`).value.trim();
    const description = document.getElementById(`description${i}`).value.trim();
    const quantity = parseInt(document.getElementById(`quantity${i}`).value) || 0;
    const price = parseFloat(document.getElementById(`price${i}`).value) || 0;
    
    if (model && quantity > 0 && price > 0) {
      items.push({
        model,
        description: description || '',
        quantity,
        price,
        amount: quantity * price
      });
    }
  }
  
  if (items.length === 0) {
    showToast('Please add at least one item', 'error');
    return null;
  }
  
  // Calculate payment impacts
  const impacts = {
    cash: currentPaymentMethod === 'Cash' ? grandTotal : 0,
    card: currentPaymentMethod === 'Card' ? grandTotal : 0,
    tabby: currentPaymentMethod === 'Tabby' ? grandTotal : 0,
    cheque: currentPaymentMethod === 'Cheque' ? grandTotal : 0
  };
  
  return {
    invoiceNumber,
    date,
    time,
    customer: {
      name: customerName,
      phone: customerPhone,
      trn: customerTRN
    },
    payment: {
      method: currentPaymentMethod,
      subtotal,
      vat,
      grandTotal
    },
    items,
    status: 'Paid',
    impacts
  };
}

function resetInvoiceForm() {
  // Reset customer fields (use correct element IDs: custName, custPhone, custTRN)
  const custNameEl = document.getElementById('custName');
  const custPhoneEl = document.getElementById('custPhone');
  const custTRNEl = document.getElementById('custTRN');
  
  if (custNameEl) custNameEl.value = '';
  if (custPhoneEl) custPhoneEl.value = '';
  if (custTRNEl) custTRNEl.value = '';
  
  // Reset items and hide rows after 3rd
  const itemsBody = document.getElementById('itemsBody');
  for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
    const modelEl = document.getElementById(`model${i}`);
    const descEl = document.getElementById(`description${i}`);
    const qtyEl = document.getElementById(`quantity${i}`);
    const priceEl = document.getElementById(`price${i}`);
    const amountEl = document.getElementById(`amount${i}`);
    
    if (modelEl) modelEl.value = '';
    if (descEl) descEl.value = '';
    if (qtyEl) qtyEl.value = '1';
    if (priceEl) priceEl.value = '';
    if (amountEl) amountEl.textContent = '0.00';
    
    // Hide rows after the 3rd one
    if (itemsBody && i > 3) {
      const row = itemsBody.querySelector(`tr[data-row-index="${i}"]`);
      if (row) row.style.display = 'none';
    }
  }
  
  // Reset payment method
  currentPaymentMethod = null;
  document.querySelectorAll('.payment-btn').forEach(btn => btn.classList.remove('active'));
  
  // Reset totals
  calculateTotals();
  
  // Reset date to today
  const invDateEl = document.getElementById('invDate');
  if (invDateEl) invDateEl.valueAsDate = new Date();
}

// ============================================
// REPRINT & REFUND (FIRESTORE)
// ============================================

window.reprintInvoice = async function(invoiceId) {
  // Implementation here - load invoice from Firestore and populate form
  debugLog('🖨️ Reprint invoice:', invoiceId);
  showToast('Reprint feature coming soon', 'info');
};

window.refundInvoice = async function(invoiceId) {
  if (!confirm('Are you sure you want to refund this invoice?')) {
    return;
  }
  
  try {
    await markInvoiceAsRefunded(invoiceId);
    showToast('✅ Invoice refunded successfully', 'success');
    
    // Refresh lists
    await loadDashboardData();
    await loadRecentInvoices();
    
  } catch (error) {
    console.error('❌ Error refunding invoice:', error);
    showToast('Error refunding invoice', 'error');
  }
};

// ============================================
// ITEM CALCULATIONS (UNCHANGED)
// ============================================

window.updateRowTotal = function(rowNum) {
  const quantity = parseFloat(document.getElementById(`quantity${rowNum}`).value) || 0;
  const price = parseFloat(document.getElementById(`price${rowNum}`).value) || 0;
  const amount = quantity * price;
  
  const amountCell = document.getElementById(`amount${rowNum}`);
  if (amountCell) {
    amountCell.textContent = amount.toFixed(2);
  }
  
  updateTotals();
};

function updateTotals() {
  let subtotal = 0;
  
  for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
    const amountText = document.getElementById(`amount${i}`).textContent;
    const amount = parseFloat(amountText) || 0;
    subtotal += amount;
  }
  
  const vat = subtotal * 0.05;
  const grandTotal = subtotal + vat;
  
  document.getElementById('subtotalAmount').textContent = subtotal.toFixed(2);
  document.getElementById('vatAmount').textContent = vat.toFixed(2);
  document.getElementById('grandTotalAmount').textContent = grandTotal.toFixed(2);
}

// ============================================
// PAYMENT METHOD SELECTION (UNCHANGED)
// ============================================

window.selectPaymentMethod = function(method) {
  currentPaymentMethod = method;
  
  document.querySelectorAll('.payment-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const selectedBtn = document.querySelector(`.payment-btn[onclick*="${method}"]`);
  if (selectedBtn) {
    selectedBtn.classList.add('active');
  }
  
  debugLog('💳 Payment method selected:', method);
};

// ============================================
// PRINT HANDLER (PRESERVED)
// ============================================

window.handlePrint = function() {
  if (isReprintMode) {
    window.print();
  } else {
    saveNewInvoice();
  }
};

// ============================================
// AUTO-REFRESH (FASTER WITH FIRESTORE)
// ============================================

function setupAutoRefresh() {
  setInterval(async () => {
    try {
      await loadDashboardData();
      await loadRecentInvoices();
    } catch (error) {
      console.error('Auto-refresh error:', error);
    }
  }, CONFIG.AUTO_REFRESH_INTERVAL_MS);
}

// ============================================
// UTILITY FUNCTIONS (PRESERVED)
// ============================================

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  
  setTimeout(() => {
    toast.className = 'toast';
  }, 4000);
}

// ============================================
// AUTH STATE OBSERVER (UNCHANGED)
// ============================================

onAuthStateChanged(auth, (user) => {
  if (user && user.email === ALLOWED_EMAIL) {
    currentUser = user;
    showMainApp();
  } else {
    currentUser = null;
    showLoginScreen();
  }
});

// ============================================
// WINDOW EXPORTS (FOR REPAIR MODULE)
// ============================================

// Export Firestore utilities for repair-management-firestore.js
window.firestoreUtils = {
  db,
  formatDate,
  formatTime,
  saveInvoice,
  saveDeposit,
  saveExpense
};

// ============================================
// DEPOSITS (FIRESTORE)
// ============================================

window.openDepositModal = function() {
  const modal = document.getElementById('depositModal');
  if (modal) modal.classList.add('show');
  
  const depositName = document.getElementById('depositName');
  const depositAmount = document.getElementById('depositAmount');
  const depositBank = document.getElementById('depositBank');
  const depositRef = document.getElementById('depositRef');
  
  if (depositName) {
    depositName.value = '';
    depositName.focus();
  }
  if (depositAmount) depositAmount.value = '';
  if (depositBank) depositBank.value = '';
  if (depositRef) depositRef.value = '';
};

window.closeDepositModal = function() {
  document.getElementById('depositModal').classList.remove('show');
};

window.submitDeposit = async function() {
  const depositorName = document.getElementById('depositName').value.trim();
  const amount = parseFloat(document.getElementById('depositAmount').value);
  const bankName = document.getElementById('depositBank').value.trim();
  const slipNumber = document.getElementById('depositRef').value.trim();
  
  // Validation
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
  
  try {
    const today = new Date();
    const depositID = await getNextDepositID();
    
    const depositData = {
      depositId: depositID,
      date: formatDate(today, 'YYYY-MM-DD'),
      time: formatTime(today),
      amount,
      bank: bankName,
      slipNumber,
      depositor: depositorName,
      cashImpact: -amount,
      notes: ''
    };
    
    debugLog('💾 Saving deposit:', depositData);
    
    await saveDeposit(depositData);
    
    showToast('✅ Deposit recorded successfully', 'success');
    closeDepositModal();
    await loadDashboardData();
    
  } catch (error) {
    console.error('❌ Error saving deposit:', error);
    showToast('Failed to save deposit', 'error');
  }
};

// ============================================
// EXPENSES (FIRESTORE)
// ============================================

window.openExpenseModal = function() {
  const modal = document.getElementById('expenseModal');
  if (modal) modal.classList.add('show');
  
  const expenseCategory = document.getElementById('expenseCategory');
  const expenseDesc = document.getElementById('expenseDesc');
  const expenseAmount = document.getElementById('expenseAmount');
  const expenseReceipt = document.getElementById('expenseReceipt');
  
  if (expenseCategory) {
    expenseCategory.value = '';
    expenseCategory.focus();
  }
  if (expenseDesc) expenseDesc.value = '';
  if (expenseAmount) expenseAmount.value = '';
  if (expenseReceipt) expenseReceipt.value = '';
};

window.closeExpenseModal = function() {
  document.getElementById('expenseModal').classList.remove('show');
};

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
  if (!receipt) {
    showToast('Please enter a receipt number', 'error');
    document.getElementById('expenseReceipt').focus();
    return;
  }
  
  try {
    const today = new Date();
    const expenseID = await getNextExpenseID();
    
    const expenseData = {
      expenseId: expenseID,
      date: formatDate(today, 'YYYY-MM-DD'),
      time: formatTime(today),
      category,
      description,
      amount,
      receiptNumber: receipt,
      cashImpact: -amount,
      notes: ''
    };
    
    debugLog('💾 Saving expense:', expenseData);
    
    await saveExpense(expenseData);
    
    showToast('✅ Expense recorded successfully', 'success');
    closeExpenseModal();
    await loadDashboardData();
    
  } catch (error) {
    console.error('❌ Error saving expense:', error);
    showToast('Failed to save expense', 'error');
  }
};

// ============================================
// DAILY REPORT (FIRESTORE)
// ============================================

window.printDailyReport = async function() {
  try {
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    
    // Load today's invoices
    const invoices = await getTodayInvoices(today);
    
    if (!invoices || invoices.length === 0) {
      showToast('No sales data for today', 'error');
      return;
    }
    
    let cashSales = 0, cardSales = 0, tabbySales = 0, chequeSales = 0, refunds = 0;
    
    invoices.forEach(invoice => {
      if (invoice.status === 'Refunded') {
        refunds++;
      } else {
        cashSales += invoice.impacts.cash || 0;
        cardSales += invoice.impacts.card || 0;
        tabbySales += invoice.impacts.tabby || 0;
        chequeSales += invoice.impacts.cheque || 0;
      }
    });
    
    const totalSales = cashSales + cardSales + tabbySales + chequeSales;
    const cashInHandEl = document.getElementById('cashInHand');
    const cashInHand = cashInHandEl ? parseFloat(cashInHandEl.textContent) : 0;
    
    const reportDate = formatDate(new Date(), 'DD-MMM-YYYY');
    
    const reportHTML = `
      <div style="text-align:center;font-weight:bold;font-size:16px;margin:2mm 0;">AKM MUSIC</div>
      <div style="text-align:center;font-weight:bold;font-size:14px;margin:2mm 0 4mm 0;">Daily Report - ${reportDate}</div>
      <div style="border-bottom:2px solid #000;margin:3mm 0;"></div>
      <div style="margin:2mm 3mm;font-weight:bold;font-size:14px;">Total Sales: <span style="float:right;">${totalSales.toFixed(2)}</span></div>
      <div style="clear:both;"></div>
      <div style="margin:2mm 3mm;font-weight:bold;font-size:14px;">Cash: <span style="float:right;">${cashSales.toFixed(2)}</span></div>
      <div style="clear:both;"></div>
      <div style="margin:2mm 3mm;font-weight:bold;font-size:14px;">Card: <span style="float:right;">${cardSales.toFixed(2)}</span></div>
      <div style="clear:both;"></div>
      <div style="margin:2mm 3mm;font-weight:bold;font-size:14px;">Tabby: <span style="float:right;">${tabbySales.toFixed(2)}</span></div>
      <div style="clear:both;"></div>
      <div style="margin:2mm 3mm;font-weight:bold;font-size:14px;">Cheque: <span style="float:right;">${chequeSales.toFixed(2)}</span></div>
      <div style="clear:both;"></div>
      <div style="border-bottom:2px solid #000;margin:3mm 0;"></div>
      <div style="margin:2mm 3mm;font-weight:bold;font-size:14px;">Cash in Hand: <span style="float:right;">${cashInHand.toFixed(2)}</span></div>
      <div style="clear:both;"></div>
      <div style="margin:2mm 3mm;font-weight:bold;font-size:14px;">Refunds: <span style="float:right;">${refunds}</span></div>
      <div style="clear:both;"></div>
    `;
    
    const container = document.getElementById('dailyReportContainer');
    container.innerHTML = reportHTML;
    document.body.classList.add('printing-daily-report');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-daily-report'), 500);
    
  } catch (error) {
    console.error('❌ Error generating daily report:', error);
    showToast('Failed to generate report', 'error');
  }
};

// ============================================
// FORM UTILITIES (PRESERVED)
// ============================================

window.clearForm = function() {
  if (confirm('Are you sure you want to clear the form?')) {
    resetInvoiceForm();
    showToast('Form cleared', 'info');
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
  
  document.querySelectorAll('.payment-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  button.classList.add('active');
  
  debugLog('💳 Payment method selected:', method);
};

window.addItemRow = function() {
  // Items are already in the table, just focus on next empty row
  for (let i = 1; i <= CONFIG.MAX_ITEMS_PER_INVOICE; i++) {
    const model = document.getElementById(`model${i}`);
    if (model && !model.value.trim()) {
      model.focus();
      return;
    }
  }
  showToast('All item rows are already visible', 'info');
};

window.loadMoreInvoices = function() {
  recentInvoicesDays += 7;
  loadRecentInvoices();
  showToast(`Loading ${recentInvoicesDays} days of invoices...`, 'info');
};

window.scrollToTop = function() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
};

// ============================================
// VALIDATION (PRESERVED)
// ============================================

function validatePhone(phone) {
  if (!phone) return { valid: true, message: '' };
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length >= CONFIG.MIN_PHONE_DIGITS && digitsOnly.length <= CONFIG.MAX_PHONE_DIGITS) {
    return { valid: true, message: '✓ Valid' };
  }
  return { valid: false, message: `✗ Must contain ${CONFIG.MIN_PHONE_DIGITS}-${CONFIG.MAX_PHONE_DIGITS} digits` };
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
  
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - CONFIG.MIN_INVOICE_DATE_DAYS_AGO);
  if (selectedDate < minDate) return { valid: false, message: '✗ Date too far in past' };
  
  return { valid: true, message: '✓ Valid' };
}

// ============================================
// KEYBOARD NAVIGATION (PRESERVED)
// ============================================

function setupKeyboardNavigation() {
  debugLog('⌨️ Setting up keyboard navigation');
  
  const printBtn = document.getElementById('printBtn');
  
  document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    
    // Deposit modal navigation
    if (activeElement.closest('#depositModal')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const depositInputs = ['depositName', 'depositAmount', 'depositBank', 'depositRef'];
        const currentId = activeElement.id;
        const currentIndex = depositInputs.indexOf(currentId);
        
        if (currentIndex !== -1 && currentIndex < depositInputs.length - 1) {
          const nextInput = document.getElementById(depositInputs[currentIndex + 1]);
          if (nextInput) nextInput.focus();
        } else if (currentId === 'depositRef') {
          submitDeposit();
        }
        return;
      }
    }
    
    // Expense modal navigation
    if (activeElement.closest('#expenseModal')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const expenseInputs = ['expenseCategory', 'expenseDesc', 'expenseAmount', 'expenseReceipt'];
        const currentId = activeElement.id;
        const currentIndex = expenseInputs.indexOf(currentId);
        
        if (currentIndex !== -1 && currentIndex < expenseInputs.length - 1) {
          const nextInput = document.getElementById(expenseInputs[currentIndex + 1]);
          if (nextInput) nextInput.focus();
        } else if (currentId === 'expenseReceipt') {
          submitExpense();
        }
        return;
      }
    }
    
    // Payment button navigation
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
      
      if (e.key === 'Enter') {
        e.preventDefault();
        activeElement.click();
        if (printBtn) printBtn.focus();
        return;
      }
    }
    
    if (e.key === 'Enter') {
      if (activeElement.id === 'printBtn') {
        e.preventDefault();
        saveAndPrint();
        return;
      }
      
      // Invoice meta navigation
      if (activeElement.closest('.invoice-meta-compact')) {
        e.preventDefault();
        const metaInputs = ['invDate', 'custName', 'custPhone', 'custTRN'];
        const currentId = activeElement.id;
        const currentIndex = metaInputs.indexOf(currentId);
        
        if (currentIndex !== -1 && currentIndex < metaInputs.length - 1) {
          const nextInput = document.getElementById(metaInputs[currentIndex + 1]);
          if (nextInput) nextInput.focus();
        } else if (currentId === 'custTRN') {
          const firstItemInput = document.querySelector('#itemsBody .item-model');
          if (firstItemInput) firstItemInput.focus();
        }
        return;
      }
      
      // Items table navigation
      if (activeElement.closest('#itemsBody')) {
        e.preventDefault();
        const currentRow = activeElement.closest('tr');
        const allRows = Array.from(document.querySelectorAll('#itemsBody tr'));
        const currentRowIndex = allRows.indexOf(currentRow);
        
        if (activeElement.classList.contains('item-price')) {
          if (currentRowIndex < allRows.length - 1) {
            const nextRow = allRows[currentRowIndex + 1];
            const firstInput = nextRow.querySelector('.item-model');
            if (firstInput) firstInput.focus();
          } else {
            const firstPaymentBtn = document.querySelector('.payment-btn');
            if (firstPaymentBtn) firstPaymentBtn.focus();
          }
        } else {
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

// ============================================
// MODAL CLICK HANDLERS
// ============================================

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeDepositModal();
    closeExpenseModal();
  }
});

// ============================================
// BACK TO TOP BUTTON
// ============================================

document.addEventListener('DOMContentLoaded', function() {
  const sidebar = document.querySelector('.sidebar');
  const backToTopBtn = document.getElementById('backToTopBtn');
  
  if (sidebar && backToTopBtn) {
    sidebar.addEventListener('scroll', function() {
      if (sidebar.scrollTop > 300) {
        backToTopBtn.classList.add('show');
      } else {
        backToTopBtn.classList.remove('show');
      }
    });
  }
    // Setup keyboard navigation
  setupKeyboardNavigation();
  
  // Set default date to today
  const invDateInput = document.getElementById('invDate');
  if (invDateInput) {
    invDateInput.valueAsDate = new Date();
  }
  
  // Setup login button event listener
  const loginBtn = document.getElementById('googleSignInBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', signInWithGoogle);
  }
  
  // Setup logout button event listener
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
});

// Export functions to window for HTML onclick handlers
window.signInWithGoogle = signInWithGoogle;
window.logout = logout;

debugLog('✅ app-firestore.js loaded successfully');
