# AKM-POS - Point of Sale System

**Firestore-powered POS** for AKM Music Centre with Firebase authentication and real-time data sync.

**Version:** 2.1 - Centralized Configuration & Code Cleanup

---

## 🚀 Quick Start (Firestore Version - v2.1)

### **Just Open & Use!**
1. Open `index.html` in any browser (double-click or use Live Server)
2. Sign in with `sales@akm-music.com`
3. Start creating invoices! 🎉

**No proxy server needed!** No npm install! No backend!

---

## ✨ Features

- ✅ **Firebase Authentication** (sales@akm-music.com only)
- ✅ **Firestore Database** (<200ms load times - was 20-30s!)
- ✅ **Invoice Management** (YY-##### format)
- ✅ **80mm Thermal Receipt Printing**
- ✅ **Real-time Dashboard** (Today's Sales)
- ✅ **Payment Methods:** Cash, Card, Tabby, Cheque
- ✅ **Reprint & Refund Invoices**
- ✅ **Deposit & Expense Tracking**
- ✅ **Repair Job Management**
- ✅ **Daily/Monthly Reports**
- ✅ **VAT Reports**
- ✅ **Offline Mode** (50MB cache)

---

## 📦 Tech Stack

- **Frontend:** Vanilla JS + CSS (no frameworks!)
- **Auth:** Firebase Authentication
- **Database:** Cloud Firestore (migrated from Google Sheets)
- **Hosting:** Firebase Hosting (deployed at akm-daily.web.app)
- **Offline:** Firestore Persistent Cache (50MB)

---

## 🏗️ Architecture (v2.1)

### **File Structure:**
```
AKM-POS/
├── index.html                      # Main POS interface
├── dashboard.html                  # Analytics dashboard
├── styles.css                      # Global styles
├── config.js                       # ⭐ NEW: Centralized configuration
├── utils.js                        # ⭐ NEW: Common utility functions
├── firebase-config.js              # Firebase initialization
├── firestore-utils.js              # Database operations
├── app-firestore.js                # Main POS logic
├── repair-management-firestore.js  # Repair job management
├── dashboard.js                    # Dashboard logic
└── Backup/                         # Obsolete files (Google Sheets version)
```

### **Key Improvements in v2.1:**
✅ **Centralized Configuration** - All settings in one place (`config.js`)  
✅ **Utility Library** - Reusable helper functions (`utils.js`)  
✅ **Better Documentation** - JSDoc comments on all major functions  
✅ **Memory Leak Prevention** - Proper event listener cleanup  
✅ **Code Deduplication** - Firebase config imported from single source  
✅ **Cleaner Codebase** - Old Google Sheets files moved to Backup/

---

## 🔧 First-Time Setup

### **Step 1: Initialize Counters**
Open `firestore-init.html` in your browser:
1. Sign in with `sales@akm-music.com`
2. Set starting numbers (e.g., Invoice: 15001)
3. Click "Initialize Firestore Counters"

### **Step 2: Deploy (Optional)**
```bash
firebase deploy
```
Your app is live at: https://akm-daily.web.app

---

## 📊 Invoice Number Format

| Type | Format | Example |
|------|--------|---------|
| Invoice | `YY-#####` | `25-15001` |
| Deposit | `D-MM##` | `D-1201` |
| Expense | `E-MM##` | `E-1202` |
| Repair | `R-MM##` | `R-1203` |

---

## 🔄 Migration from Google Sheets

**Status:** ✅ COMPLETE (Dec 30, 2024)  
**Cleanup:** ✅ COMPLETE (Jan 4, 2025 - v2.1)

### **What Changed:**
- ❌ Google Sheets → ✅ Cloud Firestore
- ❌ Render.com proxy → ✅ Direct Firebase SDK
- ❌ 20-30s load times → ✅ <200ms
- ❌ No offline mode → ✅ Full offline support
- ❌ Scattered configs → ✅ Centralized in `config.js`
- ❌ Duplicate code → ✅ Shared utilities in `utils.js`

### **Archived Files** (moved to Backup/old-google-sheets-version/):
- ✅ `app.js` (old Google Sheets version)
- ✅ `repair-management.js` (old Google Sheets version)
- ✅ `proxy-server.js` (obsolete backend)
- ✅ `package.json` (no longer needed)
- ✅ `render.yaml` (no longer needed)

**Current Active Files:**
- ✅ `app-firestore.js` (main POS logic)
- ✅ `repair-management-firestore.js` (repair jobs)
- ✅ `config.js` (centralized configuration)
- ✅ `utils.js` (shared utilities)

---

## 🎯 Performance

| Metric | Before (Sheets) | After (Firestore) | Improvement |
|--------|-----------------|-------------------|-------------|
| Dashboard | 20-30s | <500ms | **50-100x faster** ⚡ |
| Save Invoice | 2-3s | <500ms | **5x faster** ⚡ |
| Offline Mode | ❌ None | ✅ Full | **NEW** 🎯 |

---

## 🐛 Troubleshooting

### **"Index is building" warnings:**
- Normal after first deployment (takes 1-5 minutes)
- App still works, dashboard shows "0" temporarily

### **"Permission denied" errors:**
- Sign in with `sales@akm-music.com`

### **Print issues:**
- Use Chrome/Edge
- Set printer to 80mm thermal
- Margins: 0mm

---

## Project Structure

```
AKM-POS/
├── index.html                          # Main app
├── app-firestore.js                    # Core logic
├── firebase-config.js                  # Firebase setup
├── firestore-utils.js                  # Database functions
├── repair-management-firestore.js      # Repair jobs
├── styles.css                          # All styles
├── firestore-init.html                 # Counter setup
├── firestore.rules                     # Security rules
├── firestore.indexes.json              # Query indexes
└── firebase.json                       # Firebase config
```

---

## 🔒 Security

- ✅ Only `sales@akm-music.com` can access
- ✅ Firestore Rules validate all data
- ✅ Invoices cannot be deleted (audit trail)
- ✅ API keys are public (secured by rules - this is normal!)

---

## Deployment

**Firebase Hosting:**
```bash
firebase deploy
```

**Live URL:** https://akm-daily.web.app

---

## Usage

### Create Invoice
1. Sign in with sales@akm-music.com
2. Fill customer details (optional)
3. Add items (Model, Description, Qty, Price)
4. Select payment method
5. Click "Print Invoice"

### Print Reports
- **Daily Report**: Shows today's sales breakdown
- **VAT Report**: Shows VAT summary (daily/monthly)

### Reprint/Refund
- Click invoice in sidebar
- Choose "Reprint" or "Refund"

## Print Setup

For 80mm thermal printers:
- Paper size: 80mm width
- Auto-fit height
- Margins: 0
- Print background graphics: ON

---

**Version:** 2.0 (Firestore Migration)  
**Last Updated:** December 30, 2024  
**Firebase Project:** akm-pos-480210

**Migrated from Google Sheets to Firestore** - 50-100x faster, full offline support!
