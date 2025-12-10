# Quick Setup Guide - v127.2

## 🚀 Immediate Action Required

### 1. Configure API Key (2 minutes)

```bash
# Step 1: Copy template
cp config.template.js config.js

# Step 2: Edit config.js and replace the API key
# Find this line:
#   PROXY_KEY: 'your-secure-api-key-here',
# Replace with your actual key:
#   PROXY_KEY: 'your-actual-secure-key',
```

### 2. Update .gitignore (Done ✅)
Already updated to exclude `config.js` from version control.

### 3. Set Production Environment Variables

```bash
# For production deployment (Render, Railway, etc.)
export NODE_ENV="production"
export AKM_ALLOWED_ORIGINS="https://your-domain.com"
export AKM_PROXY_KEY="your-secure-key"
```

---

## 🔍 What Was Fixed

### Security (CRITICAL)
✅ API key no longer exposed in browser  
✅ CORS restricted to approved origins  
✅ Rate limiting added (100 req/min)  
✅ Input sanitization implemented

### Bugs (HIGH)
✅ Memory leaks fixed (event listeners)  
✅ Repair modal auto-refresh cleanup  
✅ Offline queue deduplication

### Validation (MEDIUM)
✅ Phone: 7+ digits required (was 6)  
✅ Invoice date: Max 1 year old  
✅ Negative numbers prevented

### Code Quality
✅ Magic numbers → named constants  
✅ Global error handlers added  
✅ Better error messages

---

## 📋 Testing Checklist (5 minutes)

1. **Security Test:**
   - Open DevTools (F12) → Network tab
   - Look for API key in requests ❌ Should NOT be visible in client code
   - ✅ Should only be in headers from server

2. **Functionality Test:**
   - Create invoice ✅
   - Print invoice ✅
   - Reprint invoice ✅
   - Test offline mode ✅

3. **Validation Test:**
   - Try 6-digit phone: `123456` ❌ Should be rejected
   - Try 7-digit phone: `1234567` ✅ Should be accepted
   - Try old date (2+ years ago) ❌ Should be rejected

4. **Memory Test:**
   - Open/close repair modal 10 times
   - Check DevTools → Performance → Memory
   - ✅ Should stay stable (not increasing)

---

## 🐛 Troubleshooting

### "API key not found" error
**Solution:** Create `config.js` from template and set API key

### CORS error in production
**Solution:** Set `AKM_ALLOWED_ORIGINS` environment variable

### Rate limit exceeded
**Solution:** Wait 1 minute or adjust `RATE_LIMIT_MAX_REQUESTS` in proxy-server.js

### Page not loading
**Solution:** Check browser console for errors, verify config.js exists

---

## 📞 Next Steps

See `CODE_ANALYSIS_REPORT.md` for:
- Detailed issue analysis
- Remaining issues to fix
- Long-term improvements
- Priority matrix

See `FIXES_APPLIED_v127.2.md` for:
- Complete list of changes
- Migration guide
- Testing instructions

---

## 🎯 Priority for Next Sprint

1. **Invoice number race condition** (still needs atomic locking)
2. **Request caching** (improve performance)
3. **Unit tests** (add test coverage)
4. **Refactor large functions** (improve maintainability)

---

**Ready to Deploy?** ✅ Yes (after config.js setup)  
**Version:** v127.2  
**Date:** December 11, 2025
