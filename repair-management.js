// ===== REPAIR JOB MANAGEMENT SYSTEM =====
// Handles repair jobs with status tracking and thermal slip printing
// Version: v127.1 - Hotfix: Fixed displayName undefined error

// Debug mode flag - set to false to reduce console output
const DEBUG_MODE = false;

// Helper for conditional logging
function debugLog(...args) {
  if (DEBUG_MODE) console.log(...args);
}

let allRepairJobs = [];
let currentRepairJobs = [];
let repairAutoRefreshInterval = null;

// Open repair modal and load jobs
window.openRepairModal = function() {
  document.getElementById('repairModal').classList.add('show');
  document.getElementById('repairSearchInput').value = '';
  loadRepairJobs();
  
  // FIX: Clear any existing interval before creating new one to prevent memory leak
  if (repairAutoRefreshInterval) {
    clearInterval(repairAutoRefreshInterval);
    repairAutoRefreshInterval = null;
  }
    // Start auto-refresh every 30 seconds to sync status from Google Sheets
  repairAutoRefreshInterval = setInterval(() => {
    // FIX: Check if modal is still open before refreshing
    const modal = document.getElementById('repairModal');
    if (!modal || !modal.classList.contains('show')) {
      clearInterval(repairAutoRefreshInterval);
      repairAutoRefreshInterval = null;
      debugLog('🛑 Auto-refresh stopped (modal closed)');
      return;
    }
    debugLog('🔄 Auto-refreshing repair jobs...');
    loadRepairJobs(true); // Silent refresh (no toast)
  }, 30000); // 30 seconds
};

// Close repair modal
window.closeRepairModal = function() {
  document.getElementById('repairModal').classList.remove('show');
  
  // FIX: Ensure cleanup happens - stop auto-refresh when modal closes
  if (repairAutoRefreshInterval) {
    clearInterval(repairAutoRefreshInterval);
    repairAutoRefreshInterval = null;
    debugLog('🛑 Auto-refresh stopped (modal closed explicitly)');
  }
};

// Open new repair form modal
window.openNewRepairForm = function() {
  document.getElementById('newRepairModal').classList.add('show');
  document.getElementById('repairCustomerName').value = '';
  document.getElementById('repairCustomerMobile').value = '';
  document.getElementById('repairProductModel').value = '';
  document.getElementById('repairService').value = '';
  document.getElementById('repairCharges').value = '';
  document.getElementById('repairCustomerMobile').focus();
};

// Close new repair form modal
window.closeNewRepairForm = function() {
  document.getElementById('newRepairModal').classList.remove('show');
};

// Load all repair jobs from Google Sheets
async function loadRepairJobs(silent = false) {
  try {
    const data = await readSheet("'Repairing'!A:H");
    
    if (!data || data.length <= 1) {
      allRepairJobs = [];
      currentRepairJobs = [];
      displayRepairJobs();
      return;
    }
      // Parse jobs (skip header row)
    allRepairJobs = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Validate row exists and has minimum required fields
      if (row && Array.isArray(row) && row.length >= 8 && row[0]) {
        allRepairJobs.push({
          jobNumber: row[0] || '',
          date: row[1] || '',
          name: row[2] || '',
          mobile: row[3] || '',
          product: row[4] || '',
          service: row[5] || '',
          charges: row[6] || '0',
          status: row[7] || 'InProcess',
          rowIndex: i + 1 // For updating sheet
        });
      }
    }
    
    currentRepairJobs = [...allRepairJobs];
    sortRepairJobs();
    displayRepairJobs();
    
  } catch (error) {
    console.error('❌ Error loading repair jobs:', error);
    if (!silent) {
      showToast('Failed to load repair jobs', 'error');
    }
  }
}

// Search repair jobs
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

// Sort repair jobs by status priority: Completed -> InProcess -> Collected
function sortRepairJobs() {
  const statusOrder = {
    'completed': 1,
    'inprocess': 2,
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
      console.warn('Date parsing error in sortRepairJobs:', e);
      return 0;
    }
  });
}

// Display repair jobs in the list - Compact Table View
function displayRepairJobs() {
  const container = document.getElementById('repairJobsList');
  
  if (currentRepairJobs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#666;">No repair jobs found</div>';
    return;
  }
  
  // Build table HTML with Excel-style layout
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

    // Truncate long values for compact display
    const displayName = (job.name && job.name.length > 18) ? job.name.substring(0, 18) + '...' : (job.name || 'N/A');
    const displayMobile = job.mobile || 'N/A';
    const displayProduct = (job.product && job.product.length > 20) ? job.product.substring(0, 20) + '...' : (job.product || 'N/A');
    const displayService = (job.service && job.service.length > 28) ? job.service.substring(0, 28) + '...' : (job.service || '-');
    const safeCharges = Number(job.charges) || 0;    html += `
      <tr class="repair-row ${statusClass}">
        <td class="job-number" title="${job.jobNumber}">${job.jobNumber}</td>
        <td class="truncate" title="${job.name || 'N/A'}">${displayName}</td>
        <td class="mobile-number" title="${job.mobile}">${displayMobile}</td>
        <td class="truncate" title="${job.product || 'N/A'}">${displayProduct}</td>
        <td class="truncate" title="${job.service || '-'}">${displayService}</td>
        <td class="amount">AED ${safeCharges.toFixed(2)}</td>
        <td class="status-cell">
          <select class="repair-status-select ${statusClass}" 
                  onchange="updateRepairStatus('${job.jobNumber}', this.value, ${job.rowIndex})">
            <option value="InProcess" ${normStatus === 'InProcess' ? 'selected' : ''}>InProcess</option>
            <option value="Completed" ${normStatus === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Collected" ${normStatus === 'Collected' ? 'selected' : ''}>Collected</option>
          </select>
        </td>
        <td class="action-cell">
          <button class="reprint-btn" onclick="reprintRepairSlip('${job.jobNumber}')" title="Reprint slip">
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

// Update repair job status
window.updateRepairStatus = async function(jobNumber, newStatus, rowIndex) {
  try {
    // Update in Google Sheets (Column H)
    const success = await updateSheet(`'Repairing'!H${rowIndex}`, [[newStatus]]);
    
    if (success) {
      // Update local data
      const job = allRepairJobs.find(j => j.jobNumber === jobNumber);
      if (job) {
        job.status = newStatus;
      }
      
      // Refresh display
      searchRepairJobs();
      showToast('Status updated successfully', 'success');
    } else {
      showToast('Failed to update status', 'error');
      loadRepairJobs(); // Reload to reset
    }
  } catch (error) {
    console.error('❌ Error updating status:', error);
    showToast('Failed to update status', 'error');
  }
};

// Generate next job number (Format: MMSS where MM=month, SS=sequence)
// Example: 1201 (December, 1st job), 1202 (December, 2nd job), 0105 (January, 5th job)
async function getNextJobNumber() {
  try {
    const data = await readSheet("'Repairing'!A:A");
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // 01-12
    
    if (!data || data.length <= 1) {
      return `${month}01`; // First job of the month
    }
    
    const lastJobNumber = data[data.length - 1][0];
    const match = lastJobNumber.match(/^(\d{2})(\d{2})$/); // Match MMSS format
    
    if (match) {
      const lastMonth = match[1];
      const lastSequence = parseInt(match[2]);
      
      if (lastMonth === month) {
        // Same month, increment sequence
        const nextSequence = String(lastSequence + 1).padStart(2, '0');
        return `${month}${nextSequence}`;
      }
    }
    
    // New month or invalid format, start at 01
    return `${month}01`;
  } catch (error) {
    console.error('❌ Error generating job number:', error);
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    return `${month}01`;
  }
}

// Job number is already in MMSS format, just return it
function formatSlipNumber(jobNumber, jobDate) {
  // Job number is already in correct format: MMSS (e.g., 1201 for December, 1st job)
  return jobNumber;
}

// Submit new repair job
window.submitNewRepairJob = async function() {
  let mobile = document.getElementById('repairCustomerMobile').value.trim();
  const product = document.getElementById('repairProductModel').value.trim();
  const name = document.getElementById('repairCustomerName').value.trim();
  const service = document.getElementById('repairService').value.trim();
  const charges = document.getElementById('repairCharges').value.trim() || '0';
  
  // Validation
  if (!mobile) {
    showToast('Mobile number is required', 'error');
    document.getElementById('repairCustomerMobile').focus();
    return;
  }
    // Validate phone number format (mobile, landline, or international)
  // Accept: 0xxxxxxxxx (10 digits), +971xxxxxxxxx, 02xxxxxxx (landline), or international format
  const phoneRegex = /^(\+?[0-9]{1,4}[\s-]?)?[0-9]{7,15}$/;
  if (!phoneRegex.test(mobile.replace(/[\s-]/g, ''))) {
    showToast('Please enter a valid phone number', 'error');
    document.getElementById('repairCustomerMobile').focus();
    return;
  }
  
  // Clean up the phone number (remove extra spaces/dashes but keep the format)
  mobile = mobile.trim();
  
  if (!product) {
    showToast('Product/Model is required', 'error');
    document.getElementById('repairProductModel').focus();
    return;
  }
  
  try {
    const today = new Date();
    const jobNumber = await getNextJobNumber();
    const date = formatDate(today, 'YYYY-MM-DD');
    
    // Prepare row data for Repairing sheet
    const rowData = [
      jobNumber,        // Job-Number (Column A)
      date,            // Date (Column B)
      name,            // Name (Column C)
      mobile,          // Mobile-Number (Column D)
      product,         // Product (Column E)
      service,         // Service (Column F)
      charges,         // Charges (Column G)
      'InProcess'      // Status (Column H)
    ];
    
    debugLog('💾 Saving repair job:', rowData);
    
    // Save to Google Sheets
    const success = await appendToSheet("'Repairing'!A:H", [rowData]);
    
    if (success) {
      showToast('✅ Repair job created successfully', 'success');
      
      // Create job object for printing
      const newJob = {
        jobNumber,
        date,
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
    } else {
      showToast('❌ Failed to save repair job. Please try again.', 'error');
    }
    
  } catch (error) {
    console.error('❌ Error creating repair job:', error);
    showToast('Failed to create repair job', 'error');
  }
};

// Print repair slip
function printRepairSlip(job) {
  const container = document.getElementById('repairSlipContainer');

  // Format date as "08-Dec-2025"
  const formattedDate = formatDate(new Date(job.date), 'DD-MMM-YYYY');
  const slipNumber = formatSlipNumber(job.jobNumber, job.date);

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

// Reprint repair slip
window.reprintRepairSlip = async function(jobNumber) {
  try {
    const job = allRepairJobs.find(j => j.jobNumber === jobNumber);
    
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

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  if (e.target.id === 'repairModal') {
    closeRepairModal();
  }
  if (e.target.id === 'newRepairModal') {
    closeNewRepairForm();
  }
});

// Add Enter key navigation for repair form
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
            // Move to next field
            const nextField = document.getElementById(formFields[index + 1]);
            if (nextField) {
              nextField.focus();
            }
          } else {
            // Last field - focus on submit button
            const submitBtn = document.querySelector('#newRepairModal button[type="submit"]');
            if (submitBtn) {
              submitBtn.focus();
            }
          }
        }
      });
    }
  });
});

debugLog('✅ Repair Management System initialized');