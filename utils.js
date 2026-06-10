// ===== UTILITY FUNCTIONS =====
// Common helper functions used across the application
// v2.1 - Centralized utilities

import { APP_CONFIG } from './config.js?v=4.0';

const LOG_CAPTURE_LIMIT = 300;
const CONSOLE_LOGS = [];
let toastTimeout;

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

function formatConsoleLog(level, args) {
  const timestamp = new Date().toISOString();
  const formatted = args.map((value) => {
    if (typeof value === 'object' && value !== null) {
      try { return JSON.stringify(value); } catch {
        return String(value);
      }
    }
    return String(value);
  }).join(' ');
  return `[${timestamp}] [${level.toUpperCase()}] ${formatted}`;
}

function captureConsoleMessage(level, args) {
  const entry = formatConsoleLog(level, args);
  CONSOLE_LOGS.push(entry);
  if (CONSOLE_LOGS.length > LOG_CAPTURE_LIMIT) CONSOLE_LOGS.shift();
}

['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
  console[method] = (...args) => {
    captureConsoleMessage(method, args);
    originalConsole[method](...args);
  };
});

window.addEventListener('error', (event) => {
  captureConsoleMessage('error', [
    'Unhandled error:',
    event.message,
    event.filename,
    `line:${event.lineno}`,
    `col:${event.colno}`,
    event.error?.stack || ''
  ]);
});

window.addEventListener('unhandledrejection', (event) => {
  captureConsoleMessage('error', ['Unhandled promise rejection:', event.reason]);
});

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) {
    originalConsole.warn('Toast element not found');
    return;
  }

  if (toastTimeout) clearTimeout(toastTimeout);
  toast.className = 'toast';
  toast.textContent = message;
  toast.classList.add('show', type);

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Validate phone number (supports mobile, landline, international)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid
 */
export function validatePhone(phone) {
  if (!phone) return false;
  
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  const digitCount = cleaned.replace(/[^\d]/g, '').length;
  
  return digitCount >= APP_CONFIG.VALIDATION.MIN_PHONE_DIGITS && 
         digitCount <= APP_CONFIG.VALIDATION.MAX_PHONE_DIGITS;
}

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Format currency (AED)
 * @param {number} amount - Amount to format
 * @param {boolean} showSymbol - Whether to show AED symbol
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount, showSymbol = false) {
  const formatted = parseFloat(amount || 0).toFixed(2);
  return showSymbol ? `AED ${formatted}` : formatted;
}

/**
 * Calculate VAT
 * @param {number} amount - Base amount
 * @returns {number} VAT amount
 */
export function calculateVAT(amount) {
  return parseFloat((amount * APP_CONFIG.BUSINESS.VAT_RATE).toFixed(2));
}

/**
 * Debounce function to limit execution rate
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function to limit execution frequency
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit = 1000) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Sanitize HTML to prevent XSS
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeHTML(str) {
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

/**
 * Get date range for today
 * @returns {Object} Object with start and end timestamps
 */
export function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
}

/**
 * Check if date is today
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if date is today
 */
export function isToday(date) {
  const d = new Date(date);
  const today = new Date();
  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
}

/**
 * Safe JSON parse with fallback
 * @param {string} str - JSON string to parse
 * @param {*} fallback - Fallback value if parse fails
 * @returns {*} Parsed object or fallback
 */
export function safeJSONParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.warn('JSON parse failed:', e);
    return fallback;
  }
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}

/**
 * Clean up event listeners to prevent memory leaks
 * @param {HTMLElement} element - Element to clean
 * @param {string} event - Event type
 * @param {Function} handler - Handler function
 */
export function removeEventListener(element, event, handler) {
  if (element && handler) {
    element.removeEventListener(event, handler);
  }
}

/**
 * Add event listener with automatic cleanup
 * @param {HTMLElement} element - Element to attach to
 * @param {string} event - Event type
 * @param {Function} handler - Handler function
 * @returns {Function} Cleanup function
 */
export function addEventListener(element, event, handler) {
  element.addEventListener(event, handler);
  return () => element.removeEventListener(event, handler);
}

/**
 * Check if user is online
 * @returns {boolean} Online status
 */
export function isOnline() {
  return navigator.onLine;
}

/**
 * Wait for specified time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after delay
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delayMs - Initial delay in milliseconds
 * @returns {Promise} Result of function or error
 */
export async function retryWithBackoff(fn, maxRetries = 3, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await delay(delayMs * Math.pow(2, i));
    }
  }
}

export function getConsoleLogs() {
  return CONSOLE_LOGS.slice();
}

export function getConsoleLogsText() {
  return CONSOLE_LOGS.join('\n');
}

export function clearConsoleLogs() {
  CONSOLE_LOGS.length = 0;
}

export function downloadBlob(content, filename = 'logs.txt', mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export async function copyConsoleLogs() {
  const text = getConsoleLogsText();
  if (!navigator.clipboard) {
    showToast('Clipboard not supported in this browser', 'error');
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Logs copied to clipboard', 'success');
    return true;
  } catch (err) {
    originalConsole.error('Failed to copy logs:', err);
    showToast('Failed to copy logs', 'error');
    return false;
  }
}

export function downloadConsoleLogs(filename = 'AKM-POS-logs.txt') {
  downloadBlob(getConsoleLogsText(), filename, 'text/plain');
}

export function openLogsModal() {
  const modal = document.getElementById('logsModal');
  if (!modal) return;
  const content = modal.querySelector('#logsContent');
  if (content) content.textContent = getConsoleLogsText() || 'No logs captured yet.';
  modal.classList.add('show');
}

export function closeLogsModal() {
  document.getElementById('logsModal')?.classList.remove('show');
}

export function clearLogs() {
  clearConsoleLogs();
  const content = document.getElementById('logsContent');
  if (content) content.textContent = 'Logs cleared.';
  showToast('Logs cleared', 'info');
}

window.openLogsModal = openLogsModal;
window.closeLogsModal = closeLogsModal;
window.copyConsoleLogs = copyConsoleLogs;
window.downloadConsoleLogs = downloadConsoleLogs;
window.clearLogs = clearLogs;

// Export all utilities as a namespace
export default {
  showToast,
  validatePhone,
  validateEmail,
  formatCurrency,
  calculateVAT,
  debounce,
  throttle,
  sanitizeHTML,
  getTodayRange,
  isToday,
  safeJSONParse,
  copyToClipboard,
  addEventListener,
  removeEventListener,
  isOnline,
  delay,
  retryWithBackoff,
  getConsoleLogs,
  getConsoleLogsText,
  clearConsoleLogs,
  downloadBlob,
  copyConsoleLogs,
  downloadConsoleLogs,
  openLogsModal,
  closeLogsModal,
  clearLogs
};
