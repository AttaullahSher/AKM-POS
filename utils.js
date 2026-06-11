// ===== UTILITY FUNCTIONS =====
// Common helper functions used across the application
// v2.1 - Centralized utilities

import { APP_CONFIG } from './config.js';

let toastTimeout;

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) {
    console.warn('Toast element not found');
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
 * Print a self-contained HTML document.
 * Tries a popup window first (nice preview on desktop). Installed PWAs and
 * mobile browsers often block popups, so it falls back to a hidden iframe
 * and triggers the native print dialog directly.
 * @param {string} html - Complete HTML document to print
 */
export function printHtml(html) {
  let pw = null;
  try { pw = window.open('', '_blank', 'width=480,height=720'); } catch { /* blocked */ }

  if (pw && pw.document) {
    pw.document.write(html);
    pw.document.close();
    return;
  }

  // Popup blocked → hidden iframe + auto print
  document.getElementById('akmPrintFrame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'akmPrintFrame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);

  const fdoc = frame.contentDocument || frame.contentWindow.document;
  fdoc.open();
  fdoc.write(html);
  fdoc.close();

  setTimeout(() => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (err) {
      console.error('Print failed:', err);
    }
    // Keep the frame around long enough for the print dialog to read it.
    setTimeout(() => frame.remove(), 60000);
  }, 300);
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

// Export all utilities as a namespace
export default {
  showToast,
  printHtml,
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
  retryWithBackoff
};
