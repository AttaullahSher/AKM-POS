# AKM-POS Release Notes v126

**Release Date:** December 10, 2025  
**Deployment:** https://akm-daily.web.app

---

## 🎯 What's New in v126

### Invoice Header Optimization
**Hide on Screen, Show on Print**

The invoice header (company name, contact information, TRN) is now hidden on the screen for a cleaner, more compact interface. The header automatically appears when printing invoices.

---

## 📋 Changes

### 1. **Invoice Header Display**
- **Screen View:** Header is hidden for a cleaner, more compact interface
- **Print View:** Header displays automatically with full company information
  - Arabic company name: أكام للإلكترونيات
  - English company name: AKM ELECTRONICS
  - Contact: Po Box 8227 | 02 621 9929
  - TRN: 100525458400003

### 2. **Invoice Title Display**
- **Screen View:** Title is hidden to save vertical space
- **Print View:** "INVOICE" title displays prominently at the top

---

## 🛠️ Technical Changes

### Files Modified:

#### `styles.css`
- Added `display: none;` to `.invoice-header` for screen view
- Added `display: none;` to `.invoice-title` for screen view
- Print media queries already configured with `display: block !important`

#### Version Updates:
- `styles.css`: v125 → v126
- `index.html`: CSS and script versions updated to v126
- `app.js`: Version comment updated to v126
- `repair-management.js`: Version comment updated to v126

---

## 🎨 User Experience Improvements

### Benefits:
1. **Cleaner Interface:** More screen space for transaction data
2. **Professional Prints:** Full company branding on printed invoices
3. **Better Workflow:** Reduced visual clutter during daily operations
4. **Consistent Branding:** Print output maintains complete company identity

---

## 🔄 Previous Releases

### v125 - Color Palette & Repair Management Updates
- Updated modern color palette (vibrant blue, green, orange, red, cyan)
- Fixed repair job status labels (InProcess, Completed, Collected)
- Added mobile number validation with mandatory "0" prefix
- Enhanced repair job list with visible row borders
- Changed modal close button to proper "Close" button
- Changed button label to "Create New Job"

### v124 - UI Improvements
- Fixed print button positioning and styling
- Enhanced reprint/refund button layout
- Updated contact information row in invoice header

### v123 - Performance & Stability
- Reduced console logging for better performance
- Improved error handling
- Enhanced stability for production use

---

## 📝 Notes

- All features fully tested and verified
- No breaking changes
- Backward compatible with existing data
- Deployed to Firebase: https://akm-daily.web.app

---

## 🚀 Deployment Checklist

- [x] Version numbers updated across all files
- [x] Release notes created
- [ ] Changes tested locally
- [ ] Deployed to Firebase
- [ ] Pushed to GitHub repository
- [ ] Release tagged in Git

---

**For questions or support, contact the development team.**
