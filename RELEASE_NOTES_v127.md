# AKM-POS Release Notes v127

**Release Date:** December 10, 2025  
**Deployment:** https://akm-daily.web.app

---

## 🎯 Overview

Version 127 improves the dashboard user experience with better scrolling behavior and more flexible phone number validation for repair jobs.

---

## ✨ New Features

### 1. 📜 Dashboard Full Scrolling
- **Fixed**: Entire dashboard (sidebar) now scrolls as one unit
- **Before**: Only "Recent Invoices" section was scrollable
- **After**: Smooth scrolling from top to bottom including all metrics, buttons, and invoices
- Better UX for viewing long invoice histories

### 2. ⬆️ Back to Top Button
- **Added**: Floating back-to-top button on dashboard
- **Behavior**: 
  - Appears after scrolling down 300px
  - Smooth scroll animation to top
  - Fixed position at bottom-left corner
  - Modern circular design with arrow icon
- **Styling**: Primary blue color matching app theme

### 3. 📞 Flexible Phone Validation (Repair Form)
- **Updated**: Relaxed phone number validation to support multiple UAE formats
- **UAE Mobile Formats Accepted**:
  - `0501234567` - Etisalat/Du (10 digits, 05 prefix)
  - `0401234567` - Dubai mobile (10 digits, 04 prefix)
  - `0601234567` - Sharjah mobile (10 digits, 06 prefix)
  - `+971501234567` - International format with +
  - `971501234567` - International format without +
  - `00971501234567` - International format with 00 prefix
- **UAE Landline Formats Accepted**:
  - `026219929` - Abu Dhabi landline (02 prefix)
  - `043334444` - Dubai landline (04 prefix)
  - `065555666` - Sharjah landline (06 prefix)
- **International Formats**: Any valid international number with country code
- **Flexible Formatting**: Accepts spaces and dashes (e.g., `+971 50 123 4567`)
- **Validation**: 7-15 digits with optional country code prefix
- **Removed**: Strict 10-digit UAE mobile-only requirement
- **Label Change**: "Mobile" → "Phone" (more accurate)
- **Placeholder**: `e.g., 0501234567 or +971501234567`
- **Help Text**: "Mobile, landline, or international format accepted"

---

## 🔧 Technical Changes

### Frontend (styles.css)
```css
/* Sidebar - Enable full scrolling */
.sidebar {
  overflow-y: auto;  /* Changed from: overflow: hidden */
  position: relative;
}

/* Recent wrapper - Remove individual scroll */
.recent-wrapper {
  flex: 0 0 auto;    /* Changed from: flex: 1 */
  /* overflow-y removed */
}

/* Back to top button */
.back-to-top {
  position: fixed;
  bottom: 20px;
  left: 20px;
  width: 44px;
  height: 44px;
  background: var(--primary);
  /* ... smooth transitions and hover effects */
}
```

### Form Updates (index.html)
```html
<!-- Before -->
<label>Mobile: *</label>
<input pattern="0[0-9]{9}" maxlength="10" placeholder="05xxxxxxxx">

<!-- After -->
<label>Phone: *</label>
<input placeholder="e.g., 0501234567 or +971501234567">
```

### Validation Logic (repair-management.js)
```javascript
// Old: Strict UAE mobile only
if (!/^0[0-9]{9}$/.test(mobile)) {
  showToast('Mobile must be 10 digits starting with 0', 'error');
}

// New: Flexible phone validation
const phoneRegex = /^(\+?[0-9]{1,4}[\s-]?)?[0-9]{7,15}$/;
if (!phoneRegex.test(mobile.replace(/[\s-]/g, ''))) {
  showToast('Please enter a valid phone number', 'error');
}
```

### JavaScript (app.js)
```javascript
// Back to top functionality
window.scrollToTop = function() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.scrollTo({ top: 0, behavior: 'smooth' });
};

// Show button after scrolling 300px
sidebar.addEventListener('scroll', function() {
  if (sidebar.scrollTop > 300) {
    backToTopBtn.classList.add('show');
  } else {
    backToTopBtn.classList.remove('show');
  }
});
```

---

## 🎨 User Experience Improvements

### Dashboard Navigation
- **Smoother scrolling** through all dashboard content
- **Easier navigation** back to top with floating button
- **Better visibility** of all metrics and recent invoices
- **No more confusion** about scrollable areas

### Repair Form Flexibility
- **Accept international customers** with country codes
- **Support landline numbers** for businesses
- **No auto-formatting** that might break valid numbers
- **Clear guidance** with updated placeholder and help text

---

## 📝 Files Modified

1. **styles.css**
   - Version: v126 → v127
   - Updated `.sidebar` scrolling behavior
   - Modified `.recent-wrapper` flex properties
   - Added `.back-to-top` button styles

2. **index.html**
   - CSS/JS versions: v126 → v127
   - Changed phone input label and validation
   - Added back-to-top button HTML

3. **app.js**
   - Version: v126 → v127
   - Added `scrollToTop()` function
   - Added scroll event listener for button visibility

4. **repair-management.js**
   - Version: v126 → v127
   - Updated phone validation regex
   - Removed auto-formatting logic
   - Changed display logic for phone numbers

---

## 🚀 Deployment Checklist

- [x] Version numbers updated across all files
- [x] Release notes created
- [x] Changes tested locally
- [x] Deployed to Firebase
- [x] Pushed to GitHub repository
- [x] Release tagged in Git

---

## 🧪 Testing Checklist

### Dashboard Scrolling
- [ ] Dashboard scrolls from top to bottom smoothly
- [ ] Back-to-top button appears after scrolling 300px
- [ ] Back-to-top button disappears near top
- [ ] Clicking button scrolls to top smoothly
- [ ] Recent invoices load correctly

### Phone Validation
- [ ] UAE mobile local accepted: `0501234567`, `0401234567`, `0601234567`
- [ ] UAE international accepted: `+971501234567`, `971501234567`, `00971501234567`
- [ ] UAE landline accepted: `026219929`, `043334444`, `065555666`
- [ ] International with spaces/dashes: `+971 50 123 4567`, `+971-50-123-4567`
- [ ] Invalid numbers rejected (e.g., `123`, `abc123`)
- [ ] Phone displays correctly in repair list
- [ ] Thermal slip prints phone correctly

---

## 📊 Impact

### Before v127
❌ Only Recent Invoices section scrollable  
❌ No easy way to return to top  
❌ Strict UAE mobile-only validation  
❌ International customers couldn't register  

### After v127
✅ Entire dashboard scrollable  
✅ Quick back-to-top button  
✅ Flexible phone validation  
✅ International & landline support  

---

## 🔄 Upgrade Path

**From v126 to v127:**
- Automatic deployment update
- No database changes required
- Existing phone numbers remain unchanged
- New entries can use any valid format

---

## 📞 Support

For issues or questions about this release:
- **Project Console**: https://console.firebase.google.com/project/akm-pos-480210
- **Live Site**: https://akm-daily.web.app
- **GitHub**: https://github.com/AttaullahSher/AKM-POS

---

## 🎉 Summary

v127 delivers a better dashboard experience with full scrolling and a convenient back-to-top button, plus more flexible phone validation that supports international and landline numbers for repair jobs.

**Key Benefits:**
- ⬆️ Easier navigation with back-to-top button
- 📜 Better scrolling experience
- 🌍 International customer support
- 📞 Landline number acceptance

---

## 📱 UAE Phone Number Format Reference

### Mobile Numbers (10 digits)

**Format Pattern**: `0X-XXX-XXXX`

| Prefix | Carrier/Region | Example | International |
|--------|---------------|---------|---------------|
| 050 | Etisalat | 0501234567 | +971501234567 |
| 052 | Etisalat | 0521234567 | +971521234567 |
| 054 | Du | 0541234567 | +971541234567 |
| 055 | Du | 0551234567 | +971551234567 |
| 056 | Du | 0561234567 | +971561234567 |
| 058 | Du | 0581234567 | +971581234567 |

### Landline Numbers (7-8 digits)

**Format Pattern**: `0X-XXX-XXXX`

| Area Code | Emirate | Example | International |
|-----------|---------|---------|---------------|
| 02 | Abu Dhabi | 026219929 | +97126219929 |
| 03 | Al Ain | 037654321 | +97137654321 |
| 04 | Dubai | 043334444 | +97143334444 |
| 06 | Sharjah | 065555666 | +97165555666 |
| 07 | Ras Al Khaimah | 072223333 | +97172223333 |
| 09 | Fujairah | 092221111 | +97192221111 |

### International Prefix Options

| Format | Example | Description |
|--------|---------|-------------|
| +971 | +971501234567 | Standard international |
| 00971 | 00971501234567 | Alternative international |
| 971 | 971501234567 | Without prefix symbol |

### Supported Format Variations

```
Local Format:        0501234567
With Spaces:         050 123 4567
With Dashes:         050-123-4567
International (+):   +971 50 123 4567
International (00):  00971 50 123 4567
International (no):  971 50 123 4567
Mixed:               +971-50-123-4567
```

**All variations are automatically validated and accepted!**

---
