# AKM-POS Print Styling Fixes - Version 62

**Date:** December 6, 2025  
**Previous Version:** v61 (Space Mono font, 5-column frontend, 2-row print conversion)

---

## Changes Implemented

### 1. ✅ Remove `.00` Decimals from Prices/Amounts
**File:** `app.js` - `printInvoice()` function

- Added `formatNumber()` helper function that removes `.00` from whole numbers
- Applied formatting to `qty`, `price`, and `amount` values before printing
- Logic: If number has no decimal part (e.g., 100.00), display as integer (100)
- If number has decimals (e.g., 99.50), keep 2 decimal places

```javascript
const formatNumber = (value) => {
  const num = parseFloat(value);
  return isNaN(num) ? value : (num % 1 === 0 ? num.toString() : num.toFixed(2).replace(/\.?0+$/, ''));
};
```

### 2. ✅ Text Wrapping for Descriptions (Max 2 Rows)
**File:** `styles.css` - `.item-desc-row td input` selector

Added CSS line-clamping for description inputs:
- `display: -webkit-box`
- `-webkit-line-clamp: 2` (limits to 2 lines)
- `line-clamp: 2` (standard property)
- `-webkit-box-orient: vertical`
- `overflow: hidden`
- `text-overflow: ellipsis`
- `max-height: 2.6em` (2 lines × 1.3 line-height)

### 3. ✅ Make ALL Text Bold on Print
**File:** `styles.css` - Multiple selectors

Changed `font-weight: 400` → `font-weight: 700` for ALL print elements:
- `html, body` - Base bold weight
- `h1, h2, h3, h4, h5, h6, p, span, div, td, th, label` - All text elements
- `input, select, textarea` - Form inputs
- `.print-text-replacement` - Print text spans
- `.items-table thead th` - Table headers
- `.items-table tbody td` - Table cells
- `.items-table tbody td input` - Item inputs
- `.amount-display` - Amount values
- `.item-desc-row td` - Description cells
- `.totals-table td` - Totals section
- `.grand-total-row td` - Grand total
- `.print-footer` - Footer text
- `.meta-field` - Invoice metadata
- All meta field inputs (customer name, mobile, TRN, date)

**Result:** ALL printed text now appears in bold for better thermal receipt readability

### 4. ✅ Fix Empty Row Detection
**File:** `app.js` - `printInvoice()` function

Enhanced empty row detection logic:
```javascript
// OLD: Only checked if model and desc are empty
if (!model && !desc) {
  tr.style.display = 'none';
  return;
}

// NEW: Also checks if amount is 0 or empty
const amountNum = parseFloat(amount);
if ((!model && !desc) || !amount || amountNum === 0 || isNaN(amountNum)) {
  tr.style.display = 'none';
  return;
}
```

Now properly hides rows where:
- Model AND description are both empty, OR
- Amount is empty, zero, or not a valid number

### 5. ✅ Increase Side Margins (3mm → 5mm)
**File:** `styles.css` - `.invoice-container` selector

- **Margin:** Changed from `3mm` to `5mm`
- **Width:** Adjusted from `74mm` to `70mm`
- **Total:** 5mm (left) + 70mm (content) + 5mm (right) = 80mm thermal paper width

```css
.invoice-container {
  width: 70mm !important;
  max-width: 70mm !important;
  margin: 5mm !important;
}
```

---

## Technical Details

### Number Formatting Logic
```javascript
formatNumber(100.00) → "100"
formatNumber(99.50)  → "99.5"
formatNumber(99.99)  → "99.99"
formatNumber(0.50)   → "0.5"
```

### Description Wrapping Behavior
- **Line 1-2:** Full text displayed
- **Line 3+:** Text truncated with ellipsis (...)
- **Max Height:** 2.6em (accommodates 2 lines with 1.3 line-height)

### Font Weight Changes
- **Screen View:** Remains unchanged (normal weight for readability)
- **Print View:** ALL text forced to 700 (bold) for thermal receipt clarity

---

## Files Modified

1. **`app.js`** (Lines 688-724)
   - Added `formatNumber()` helper
   - Updated number formatting before print
   - Enhanced empty row detection with amount check

2. **`styles.css`** (Multiple print media query sections)
   - Updated `font-weight: 400` → `700` across ~20 selectors
   - Added description text wrapping with line-clamp
   - Adjusted invoice container width and margins
   - Added standard `line-clamp` property for compatibility

---

## Testing Checklist

- [ ] Print invoice with whole numbers (100, 250) - verify `.00` removed
- [ ] Print invoice with decimals (99.50, 10.75) - verify kept/formatted
- [ ] Print invoice with long descriptions - verify 2-line limit
- [ ] Print invoice with empty rows - verify properly hidden
- [ ] Verify all text appears bold on thermal receipt
- [ ] Measure printed margins - should be ~5mm each side
- [ ] Check total paper width - should be 80mm

---

## Deployment Status

**Current Status:** Changes applied locally (v62)  
**Next Steps:**
1. Test print functionality
2. Verify all fixes work as expected
3. Deploy to GitHub
4. Auto-deploy to Firebase (https://akm-daily.web.app)
5. Auto-deploy to Render API

---

## Version History

- **v57:** JavaScript solution to replace inputs with text spans (fixed gray text)
- **v58:** Changed to removing inputs from DOM (fixed double text)
- **v59:** Changed to Roboto Mono font + increased font sizes by 2px
- **v60:** Restructured to 2-row table layout + changed to Courier Prime
- **v61:** Reverted frontend to 5-column, JS conversion for print + Space Mono font
- **v62:** ✨ **CURRENT** - Bold text, decimal removal, text wrapping, better empty row detection, 5mm margins

---

## Notes

- **Frontend (Screen):** Still uses 5-column table layout (unchanged from v61)
- **Print (Thermal):** JavaScript converts to 2-row layout dynamically before printing
- **Font:** Space Mono (monospace, similar to DejaVu Sans Mono)
- **All Changes:** Applied only to print media query, screen view unaffected
- **Compatibility:** Added both `-webkit-line-clamp` and standard `line-clamp` for browser support
