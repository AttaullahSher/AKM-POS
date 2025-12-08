// ===== REPAIR JOB MANAGEMENT SYSTEM =====
// Handles repair jobs with status tracking and thermal slip printing

let allRepairJobs = [];
let currentRepairJobs = [];

// Open repair modal and load jobs
window.openRepairModal = function() {
  document.getElementById('repairModal').classList.add('show');
  document.getElementById('repairSearchInput').value = '';
  loadRepairJobs();
};

// Close repair modal
window.closeRepairModal = function() {
  document.getElementById('repairModal').classList.remove('show');
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
async function loadRepairJobs() {
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
    showToast('Failed to load repair jobs', 'error');
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
    'Completed': 1,
    'InProcess': 2,
    'Collected': 3
  };
  
  currentRepairJobs.sort((a, b) => {
    // Handle unknown statuses gracefully
    const orderA = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 999;
    const orderB = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 999;
    
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    
    // If same status, sort by date (newest first)
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

// Display repair jobs in the list
function displayRepairJobs() {
  const container = document.getElementById('repairJobsList');
  
  if (currentRepairJobs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#666;">No repair jobs found</div>';
    return;
  }
  
  let html = '';
  currentRepairJobs.forEach(job => {
    let statusClass = '';
    if (job.status === 'InProcess') statusClass = 'status-inprocess';
    else if (job.status === 'Completed') statusClass = 'status-completed';
    
    html += `
      <div class="repair-job-item ${statusClass}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-weight:bold;font-size:15px;">${job.jobNumber}</div>
          <select class="repair-status-select ${statusClass}" 
                  onchange="updateRepairStatus('${job.jobNumber}', this.value, ${job.rowIndex})">
            <option value="InProcess" ${job.status === 'InProcess' ? 'selected' : ''}>InProcess</option>
            <option value="Completed" ${job.status === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Collected" ${job.status === 'Collected' ? 'selected' : ''}>Collected</option>
          </select>
        </div>
        <div style="color:#555;margin-bottom:4px;"><strong>Name:</strong> ${job.name || 'N/A'}</div>
        <div style="color:#555;margin-bottom:4px;"><strong>Mobile:</strong> ${job.mobile}</div>
        <div style="color:#555;margin-bottom:4px;"><strong>Product:</strong> ${job.product}</div>
        ${job.service ? `<div style="color:#555;margin-bottom:4px;"><strong>Service:</strong> ${job.service}</div>` : ''}
        <div style="color:#555;margin-bottom:8px;"><strong>Charges:</strong> AED ${parseFloat(job.charges).toFixed(2)}</div>
        <button onclick="reprintRepairSlip('${job.jobNumber}')" 
                style="padding:6px 12px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;">
          🖨️ Reprint Slip
        </button>
      </div>
    `;
  });
  
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

// Generate next job number
async function getNextJobNumber() {
  try {
    const data = await readSheet("'Repairing'!A:A");
    const today = new Date();
    const year = String(today.getFullYear()).slice(-2);
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const yearMonth = `${year}${month}`;
    
    if (!data || data.length <= 1) {
      return `R${yearMonth}001`;
    }
    
    const lastJobNumber = data[data.length - 1][0];
    const match = lastJobNumber.match(/R(\d{4})(\d+)/);
    
    if (match) {
      const lastYearMonth = match[1];
      const lastSequence = parseInt(match[2]);
      
      if (lastYearMonth === yearMonth) {
        const nextSequence = String(lastSequence + 1).padStart(3, '0');
        return `R${yearMonth}${nextSequence}`;
      }
    }
    
    return `R${yearMonth}001`;
  } catch (error) {
    console.error('❌ Error generating job number:', error);
    const today = new Date();
    const year = String(today.getFullYear()).slice(-2);
    const month = String(today.getMonth() + 1).padStart(2, '0');
    return `R${year}${month}001`;
  }
}

// Submit new repair job
window.submitNewRepairJob = async function() {
  const mobile = document.getElementById('repairCustomerMobile').value.trim();
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
    
    console.log('💾 Saving repair job:', rowData);
    
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
  
  const slipHTML = `
    <div class="repair-slip-header">
      <h1>مركز أجمل خان محمد للموسيقى ذ.م.م</h1>
      <h1>Ajmal Khan Mohammed Music Centre LLC.</h1>
      <div>TRN: 100496016100003</div>
      <div>Al Sabkha Street, Deira, Dubai</div>
      <div>Tel: +971-4-2289009</div>
    </div>
    
    <div class="repair-slip-number">REPAIR SLIP #${job.jobNumber}</div>
    <div class="repair-slip-date">Date: ${formattedDate}</div>
    
    <div class="repair-slip-details">
      ${job.name ? `<div><strong>Name:</strong> ${job.name}</div>` : ''}
      <div><strong>Mobile:</strong> ${job.mobile}</div>
      <div><strong>Product/Model:</strong> ${job.product}</div>
      ${job.service ? `<div><strong>Service:</strong> ${job.service}</div>` : ''}
      <div><strong>Estimated Charges:</strong> AED ${parseFloat(job.charges).toFixed(2)}</div>
    </div>
    
    <div class="repair-slip-terms">
      <div style="font-weight:bold;margin-bottom:6px;text-align:center;">TERMS & CONDITIONS</div>
      <div>1. Repairs are subject to technical inspection.</div>
      <div>2. Final charges may vary based on actual work required.</div>
      <div>3. Items must be collected within 30 days of completion notification.</div>
      <div>4. Management is not responsible for items left beyond 30 days.</div>
      <div>5. Repairs are warranted for 7 days from collection date.</div>
      <div style="margin-top:8px;text-align:center;font-weight:bold;">Thank you for your business!</div>
    </div>
  `;
  
  container.innerHTML = slipHTML;
  
  // Trigger print
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

console.log('✅ Repair Management System initialized');