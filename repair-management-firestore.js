// ===== REPAIR JOB MANAGEMENT SYSTEM (FIRESTORE VERSION) =====
// Handles repair jobs with status tracking and thermal slip printing
// Migrated from Google Sheets to Firestore for faster performance
// v2.1 - Centralized Configuration

import {
  db,
  getNextRepairJobNumber,
  saveRepairJob,
  getRecentRepairJobs,
  updateRepairJobStatus,
  formatDate
} from './firestore-utils.js?v=4.0';

import { APP_CONFIG, debugLog } from './config.js?v=4.0';
import { showToast } from './utils.js?v=4.0';

const DEBUG_MODE = APP_CONFIG.DEBUG_MODE;

let allRepairJobs = [];
let currentRepairJobs = [];
let repairAutoRefreshInterval = null;

// ============================================
// MODAL MANAGEMENT
// ============================================

window.openRepairModal = function() {
  document.getElementById('repairModal').classList.add('show');
  document.getElementById('repairSearchInput').value = '';
  loadRepairJobs();
  
  // Clear any existing interval before creating new one
  if (repairAutoRefreshInterval) {
    clearInterval(repairAutoRefreshInterval);
    repairAutoRefreshInterval = null;
  }
  
  // Auto-refresh every 30 seconds
  repairAutoRefreshInterval = setInterval(() => {
    const modal = document.getElementById('repairModal');
    if (!modal || !modal.classList.contains('show')) {
      clearInterval(repairAutoRefreshInterval);
      repairAutoRefreshInterval = null;
      debugLog('🛑 Auto-refresh stopped (modal closed)');
      return;
    }
    debugLog('🔄 Auto-refreshing repair jobs...');
    loadRepairJobs(true); // Silent refresh
  }, 30000);
};

window.closeRepairModal = function() {
  document.getElementById('repairModal').classList.remove('show');
  
  if (repairAutoRefreshInterval) {
    clearInterval(repairAutoRefreshInterval);
    repairAutoRefreshInterval = null;
    debugLog('🛑 Auto-refresh stopped');
  }
};

window.openNewRepairForm = function() {
  document.getElementById('newRepairModal').classList.add('show');
  document.getElementById('repairCustomerName').value = '';
  document.getElementById('repairCustomerMobile').value = '';
  document.getElementById('repairProductModel').value = '';
  document.getElementById('repairService').value = '';
  document.getElementById('repairCharges').value = '';
  document.getElementById('repairCustomerMobile').focus();
};

window.closeNewRepairForm = function() {
  document.getElementById('newRepairModal').classList.remove('show');
};

// ============================================
// LOAD REPAIR JOBS (FIRESTORE)
// ============================================

async function loadRepairJobs(silent = false) {
  try {
    // Load recent repair jobs from Firestore (fast query!)
    const jobs = await getRecentRepairJobs(200); // Last 200 jobs
    
    if (!jobs || jobs.length === 0) {
      allRepairJobs = [];
      currentRepairJobs = [];
      displayRepairJobs();
      return;
    }
    
    allRepairJobs = jobs.map(job => ({
      id: job.id, // Firestore document ID
      jobNumber: job.jobNumber,
      date: job.date,
      name: job.customer?.name || '',
      mobile: job.customer?.phone || '',
      product: job.product,
      service: job.service,
      charges: job.charges.toString(),
      status: job.status
    }));
    
    currentRepairJobs = [...allRepairJobs];
    sortRepairJobs();
    displayRepairJobs();
    
    debugLog('✅ Loaded', jobs.length, 'repair jobs from Firestore');
    
  } catch (error) {
    console.error('❌ Error loading repair jobs:', error);
    if (!silent) {
      showToast('Failed to load repair jobs', 'error');
    }
  }
}

// ============================================
// SEARCH & FILTER
// ============================================

window.searchRepairJobs = function() {
  const searchTerm = document.getElementById('repairSearchInput').value.toLowerCase().trim();
  
  if (!searchTerm) {
    currentRepairJobs = [...allRepairJobs];
  } else {
    currentRepairJobs = allRepairJobs.filter(job => 
      job.jobNumber.toLowerCase().includes(searchTerm) ||
      job.name.toLowerCase().includes(searchTerm) ||
      job.mobile.includes(searchTerm) ||
      job.product.toLowerCase().includes(searchTerm)
    );
  }
  
  sortRepairJobs();
  displayRepairJobs();
};

function sortRepairJobs() {
  const statusOrder = {
    'inprocess': 1,
    'completed': 2,
    'collected': 3
  };
  
  currentRepairJobs.sort((a, b) => {
    const normA = (a.status || '').trim().toLowerCase();
    const normB = (b.status || '').trim().toLowerCase();
    
    const orderA = statusOrder[normA] !== undefined ? statusOrder[normA] : 999;
    const orderB = statusOrder[normB] !== undefined ? statusOrder[normB] : 999;
    
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    
    try {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
      return dateB - dateA;
    } catch (e) {
      console.warn('Date parsing error:', e);
      return 0;
    }
  });
}

// ============================================
// DISPLAY REPAIR JOBS
// ============================================

function displayRepairJobs() {
  const container = document.getElementById('repairJobsList');
  
  if (currentRepairJobs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#666;">No repair jobs found</div>';
    return;
  }
  
  let html = `
    <div class="repair-table-container">
      <table class="repair-table">
        <thead>
          <tr>
            <th style="width: 85px;">Job #</th>
            <th style="width: 130px;">Name</th>
            <th style="width: 110px;">Mobile</th>
            <th style="width: 140px;">Model</th>
            <th style="width: 180px;">Service</th>
            <th style="width: 80px;">Charges</th>
            <th style="width: 110px;">Status</th>
            <th style="width: 70px;">Action</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  currentRepairJobs.forEach(job => {
    let statusClass = '';
    const normStatus = (job.status || '').trim();
    if (normStatus === 'InProcess') statusClass = 'status-inprocess';
    else if (normStatus === 'Completed') statusClass = 'status-completed';
    
    const displayName = (job.name && job.name.length > 18) ? job.name.substring(0, 18) + '...' : (job.name || 'N/A');
    const displayMobile = job.mobile || 'N/A';
    const displayProduct = (job.product && job.product.length > 20) ? job.product.substring(0, 20) + '...' : (job.product || 'N/A');
    const displayService = (job.service && job.service.length > 28) ? job.service.substring(0, 28) + '...' : (job.service || '-');
    const safeCharges = Number(job.charges) || 0;
    
    html += `
      <tr class="repair-row ${statusClass}">
        <td class="job-number" title="${job.jobNumber}">${job.jobNumber}</td>
        <td class="truncate" title="${job.name || 'N/A'}">${displayName}</td>
        <td class="mobile-number" title="${job.mobile}">${displayMobile}</td>
        <td class="truncate" title="${job.product || 'N/A'}">${displayProduct}</td>
        <td class="truncate" title="${job.service || '-'}">${displayService}</td>
        <td class="amount">AED ${safeCharges.toFixed(2)}</td>
        <td class="status-cell">
          <select class="repair-status-select ${statusClass}" 
                  onchange="updateRepairStatus('${job.id}', this.value)">
            <option value="InProcess" ${normStatus === 'InProcess' ? 'selected' : ''}>InProcess</option>
            <option value="Completed" ${normStatus === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Collected" ${normStatus === 'Collected' ? 'selected' : ''}>Collected</option>
          </select>
        </td>
        <td class="action-cell">
          <button class="reprint-btn" onclick="reprintRepairSlip('${job.id}')" title="Reprint slip">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 5.33333V2.66667C4 2.48986 4.07024 2.32029 4.19526 2.19526C4.32029 2.07024 4.48986 2 4.66667 2H11.3333C11.5101 2 11.6797 2.07024 11.8047 2.19526C11.9298 2.32029 12 2.48986 12 2.66667V5.33333M4 11.3333H3.33333C2.97971 11.3333 2.64057 11.1929 2.39052 10.9428C2.14048 10.6928 2 10.3536 2 10V7.33333C2 6.97971 2.14048 6.64057 2.39052 6.39052C2.64057 6.14048 2.97971 6 3.33333 6H12.6667C13.0203 6 13.3594 6.14048 13.6095 6.39052C13.8595 6.64057 14 6.97971 14 7.33333V10C14 10.3536 13.8595 10.6928 13.6095 10.9428C13.3594 11.1929 13.0203 11.3333 12.6667 11.3333H12M4.66667 9.33333H11.3333V13.3333C11.3333 13.5101 11.2631 13.6797 11.1381 13.8047C11.013 13.9298 10.8435 14 10.6667 14H5.33333C5.15652 14 4.98695 13.9298 4.86193 13.8047C4.7369 13.6797 4.66667 13.5101 4.66667 13.3333V9.33333Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  });
  
  html += `
        </tbody>
      </table>
    </div>
  `;
  
  container.innerHTML = html;
}

// ============================================
// UPDATE STATUS (FIRESTORE)
// ============================================

window.updateRepairStatus = async function(jobId, newStatus) {
  try {
    // Update in Firestore (atomic operation)
    await updateRepairJobStatus(jobId, newStatus);
    
    // Update local data
    const job = allRepairJobs.find(j => j.id === jobId);
    if (job) {
      job.status = newStatus;
    }
    
    // Refresh display
    searchRepairJobs();
    showToast('✅ Status updated successfully', 'success');
    
  } catch (error) {
    console.error('❌ Error updating status:', error);
    showToast('Failed to update status', 'error');
    loadRepairJobs(); // Reload to reset
  }
};

// ============================================
// CREATE NEW REPAIR JOB (FIRESTORE)
// ============================================

window.submitNewRepairJob = async function() {
  let mobile = document.getElementById('repairCustomerMobile').value.trim();
  const product = document.getElementById('repairProductModel').value.trim();
  const name = document.getElementById('repairCustomerName').value.trim();
  const service = document.getElementById('repairService').value.trim();
  const charges = document.getElementById('repairCharges').value.trim() || '0';
  
  // Validation
  if (!mobile) {
    showToast('Phone number is required', 'error');
    document.getElementById('repairCustomerMobile').focus();
    return;
  }
  
  // Validate phone number format
  const phoneRegex = /^(\+?[0-9]{1,4}[\s-]?)?[0-9]{7,15}$/;
  if (!phoneRegex.test(mobile.replace(/[\s-]/g, ''))) {
    showToast('Please enter a valid phone number', 'error');
    document.getElementById('repairCustomerMobile').focus();
    return;
  }
  
  mobile = mobile.trim();
  
  if (!product) {
    showToast('Product/Model is required', 'error');
    document.getElementById('repairProductModel').focus();
    return;
  }
  
  try {
    const today = new Date();
    
    // Get next job number from Firestore counter (atomic!)
    const jobNumber = await getNextRepairJobNumber();
    const date = formatDate(today, 'YYYY-MM-DD');
    
    // Prepare repair job data
    const repairData = {
      jobNumber,
      date,
      customer: {
        name: name || '',
        phone: mobile
      },
      product,
      service: service || '',
      charges: parseFloat(charges) || 0,
      status: 'InProcess'
    };
    
    debugLog('💾 Saving repair job:', repairData);
    
    // Save to Firestore (returns plain string docId)
    const docId = await saveRepairJob(repairData);

    showToast('✅ Repair job created successfully', 'success');

    // Create job object for printing
    const newJob = {
      id: docId,
      jobNumber,
      date: formatDate(today, 'DD/MM/YYYY'), // UAE format for display
      name,
      mobile,
      product,
      service,
      charges,
      status: 'InProcess'
    };
    
    // Print repair slip
    printRepairSlip(newJob);
    
    // Close form and refresh list
    closeNewRepairForm();
    loadRepairJobs();
    
  } catch (error) {
    console.error('❌ Error creating repair job:', error);
    showToast('Failed to create repair job. It may be saved offline and synced later.', 'warning');
  }
};

// ============================================
// PRINT REPAIR SLIP
// ============================================

function printRepairSlip(job) {
  const container = document.getElementById('repairSlipContainer');
  
  const formattedDate = formatDate(new Date(job.date), 'DD-MMM-YYYY');
  const slipNumber = job.jobNumber; // Already in correct format
  
  const truncateName = (job.name && job.name.length > 25) ? job.name.substring(0, 25) + '...' : (job.name || '');
  const truncateMobile = (job.mobile && job.mobile.length > 15) ? job.mobile.substring(0, 15) + '...' : (job.mobile || '');
  const truncateProduct = (job.product && job.product.length > 25) ? job.product.substring(0, 25) + '...' : (job.product || '');
  
  const estAmount = Number(job.charges) || 0;
  
  const slipHTML = `
    <div class="repair-slip-header">
      <h1>AKM Music</h1>
      <div>F9Q8+XQ Abu Dhabi</div>
      <div>Tel: 02-621 9929</div>
    </div>

    <div class="repair-slip-separator"></div>

    <div class="repair-slip-number">SERVICE SLIP #${slipNumber}</div>
    <div class="repair-slip-date">Date: ${formattedDate}</div>

    <div class="repair-slip-separator"></div>

    <div class="repair-slip-details">
      ${truncateName ? `<div class="slip-row"><strong>Name:</strong> ${truncateName}</div>` : ''}
      <div class="slip-row"><strong>Mob:</strong> ${truncateMobile}</div>
      <div class="slip-row"><strong>Model:</strong> ${truncateProduct}</div>
      ${job.service ? `<div class="slip-row"><strong>Service:</strong> ${job.service}</div>` : ''}
      <div class="slip-row"><strong>Est:</strong> AED ${estAmount.toFixed(2)}</div>
    </div>

    <div class="repair-slip-separator"></div>

    <div class="repair-slip-terms">
      <div>Repairs are subject to technical inspection.</div>
      <div>Final charges may vary based on actual work required.</div>
      <div>Items must be collected within 30 days of completion notification.</div>
      <div>Management is not responsible for items left beyond 30 days.</div>
      <div>Repairs are warranted for 7 days from collection date.</div>
      <div style="margin-top:4px;text-align:center;">Thank you</div>
    </div>
  `;
  
  container.innerHTML = slipHTML;
  
  document.body.classList.add('printing-repair-slip');
  window.print();
  
  setTimeout(() => {
    document.body.classList.remove('printing-repair-slip');
  }, 500);
}

// ============================================
// REPRINT
// ============================================

window.reprintRepairSlip = async function(jobId) {
  try {
    const job = allRepairJobs.find(j => j.id === jobId);
    
    if (!job) {
      showToast('Job not found', 'error');
      return;
    }
    
    printRepairSlip(job);
    
  } catch (error) {
    console.error('❌ Error reprinting slip:', error);
    showToast('Failed to reprint slip', 'error');
  }
};

// ============================================
// EVENT LISTENERS
// ============================================

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  if (e.target.id === 'repairModal') {
    closeRepairModal();
  }
  if (e.target.id === 'newRepairModal') {
    closeNewRepairForm();
  }
});

// Enter key navigation for repair form
document.addEventListener('DOMContentLoaded', () => {
  const formFields = [
    'repairCustomerMobile',
    'repairProductModel',
    'repairService',
    'repairCharges'
  ];
  
  formFields.forEach((fieldId, index) => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          
          if (index < formFields.length - 1) {
            const nextField = document.getElementById(formFields[index + 1]);
            if (nextField) {
              nextField.focus();
            }
          } else {
            const submitBtn = document.querySelector('#newRepairModal button[type="submit"]');
            if (submitBtn) {
              submitBtn.focus();
            }
          }
        }
      });
    }  });
});

debugLog('✅ repair-management-firestore.js loaded');
