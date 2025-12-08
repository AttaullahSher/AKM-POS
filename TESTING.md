# 🧪 Testing Checklist for Bug Fixes

## Pre-Deployment Testing

### 1. Server Startup Test
```bash
cd AKM-POS
node proxy-server.js
```
**Expected:** Server starts on port 3000, no errors in console

---

### 2. Invoice Creation Test
- [ ] Open http://localhost:3000
- [ ] Sign in with sales@akm-music.com
- [ ] Add 3 items with prices
- [ ] **DO NOT** select payment method
- [ ] Click "Print Invoice"
- **Expected:** Toast error "Please select a payment method"
- [ ] Select "Cash" payment method
- [ ] Click "Print Invoice"
- **Expected:** Invoice saves and print dialog opens
- [ ] Check browser console for barcode errors
- **Expected:** If barcode fails, see error message but printing continues

---

### 3. Reprint Test
- [ ] Find a recent invoice in sidebar
- [ ] Click "Reprint"
- [ ] Invoice loads successfully
- [ ] Customer details are editable
- [ ] Items are locked (disabled)
- [ ] Payment method can be changed
- [ ] Click "Reprint Invoice"
- **Expected:** Print dialog opens, no crashes

---

### 4. Repair Jobs Test
- [ ] Click "🔧 Repair Jobs" button
- [ ] Click "➕ New Job"
- [ ] Fill in:
  - Mobile: 0501234567
  - Product: Test Guitar
  - Service: Tuning
  - Charges: 100
- [ ] Click "Save & Print"
- **Expected:** Repair slip prints, job appears in list
- [ ] Try changing status from "InProcess" to "Completed"
- **Expected:** Status updates successfully
- [ ] Search for the job by name
- **Expected:** Search works, job appears

---

### 5. Deposit Test
- [ ] Click "💰 Deposit" button
- [ ] Fill in:
  - Name: Test Depositor
  - Amount: 500
  - Bank: UBL
  - Slip Number: 12345
- [ ] Click "Submit"
- **Expected:** Success toast, cash in hand decreases

---

### 6. Expense Test
- [ ] Click "💸 Expense" button
- [ ] Select Category: "Local Purchase"
- [ ] Description: "Test expense"
- [ ] Amount: 50
- [ ] Select payment method: "Cash"
- [ ] Receipt Number: "EXP001"
- [ ] Click "Submit"
- **Expected:** Success toast, cash in hand decreases

---

### 7. Validation Tests
- [ ] Try to print without payment method
- [ ] Try to print with no items
- [ ] Try to create invoice with future date
- [ ] Try to create repair job without mobile number
- **Expected:** All show appropriate error messages

---

### 8. Browser Console Check
- [ ] Open Developer Tools (F12)
- [ ] Check Console tab
- **Expected:** 
  - ✅ "Smart spell-checking system initialized"
  - ✅ "Custom dictionary loaded: XX words"
  - ❌ No red error messages
  - ❌ No "undefined" errors
  - ❌ No "null" errors

---

### 9. Network Tab Check
- [ ] Open Network tab in Dev Tools
- [ ] Create an invoice
- [ ] Check POST requests to:
  - `/readSheet`
  - `/writeToSheet`
- **Expected:** All return 200 status code

---

### 10. Spell Check Test
- [ ] Add an item
- [ ] In Description field, type: "yamaha guitar with stand"
- [ ] Tab out of field
- **Expected:** Text auto-capitalizes to "Yamaha guitar with stand"

---

## Deployment Checklist

- [ ] All tests above pass
- [ ] No console errors
- [ ] Git commit with message:
  ```
  Fixed 9 critical bugs - v83
  - Removed duplicate /readSheet endpoint
  - Fixed race condition in print button
  - Added server-side validation
  - Improved error handling
  - Added null checks for repair jobs
  See BUGFIXES.md for details
  ```
- [ ] Push to GitHub:
  ```bash
  git add .
  git commit -m "Fixed 9 critical bugs - v83"
  git push origin main
  ```
- [ ] Monitor Render deployment
- [ ] Test on production URL
- [ ] Monitor for 24 hours

---

## Rollback Plan (If Needed)

If issues arise after deployment:

```bash
# Revert to previous version
git revert HEAD
git push origin main
```

Or manually restore previous version from Git history.

---

## Performance Metrics to Monitor

1. **API Response Times**
   - /readSheet: Should be < 2s
   - /writeToSheet: Should be < 3s

2. **Error Rate**
   - Target: < 1% of requests fail
   - Check Render logs for errors

3. **User Experience**
   - Invoice creation: < 5 seconds
   - Print dialog: Opens immediately
   - No crashes or freezes

---

**Testing Status:** ⏳ Pending  
**Deployment Status:** ⏳ Pending  
**Production Status:** ⏳ Not Deployed
