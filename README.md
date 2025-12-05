# AKM-POS - Point of Sale System

Clean POS system for AKM Music Centre with Firebase auth and Google Sheets backend.

## ⚠️ IMPORTANT - Must Run Through Proxy Server

**DO NOT use VS Code Live Server (port 5500)!**

This app requires the Node.js proxy server to access Google Sheets API.

## Quick Start

1. **Get Firebase Service Account Key**:
   - Go to [Firebase Console](https://console.firebase.google.com/project/akm-pos-480210/settings/serviceaccounts)
   - Settings → Service Accounts → Generate new private key
   - Save as `functions/serviceAccountKey.json`

2. **Start Proxy Server**:
   ```bash
   npm start
   ```

3. **Open Browser**: `http://localhost:3000` (NOT 5500!)

4. **Fix Firebase Auth Error** (if you see "auth/unauthorized-domain"):
   - Go to [Firebase Console](https://console.firebase.google.com/project/akm-pos-480210/authentication/settings)
   - Authentication → Settings → Authorized domains
   - Add: `localhost` and `127.0.0.1`

---

## For AI Agents
Keep responses concise. No multiple MD files. No expert-level guides.

## Features

- ✅ Firebase Authentication (sales@akm-music.com only)
- ✅ Invoice Management (YYYY-##### format)
- ✅ 80mm Thermal Receipt Printing
- ✅ Real-time Dashboard (Today's Sales)
- ✅ Payment Methods: Cash, Card, Tabby, Cheque
- ✅ Reprint & Refund Invoices
- ✅ Deposit & Expense Tracking
- ✅ Daily Report Printing
- ✅ VAT Report (Daily/Monthly)
- ✅ Cash in Hand Calculation

## Tech Stack

- **Frontend**: Vanilla JS + CSS (no frameworks, no build tools)
- **Auth**: Firebase Authentication
- **Database**: Google Sheets (via proxy server)
- **Print**: Browser print API + JsBarcode
- **Hosting**: Firebase Hosting + Render.com (proxy)
- **Code**: Clean, no comments clutter, production-ready

## Project Structure

```
AKM-POS/
├── index.html          # Main UI
├── app.js             # Application logic (cleaned)
├── styles.css         # Styling + print styles
├── proxy-server.js    # Google Sheets API proxy
├── package.json       # Node dependencies
└── firebase.json      # Firebase config
```

## Configuration

### Firebase Setup Required
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select project: `akm-pos-480210`
3. Go to **Authentication** → **Settings** → **Authorized domains**
4. Add these domains:
   - `localhost`
   - `127.0.0.1`
   - Your production domain (e.g., `akm-pos-480210.web.app`)

### Firebase (app.js)
- Project ID: `akm-pos-480210`
- Allowed email: `sales@akm-music.com`

### Google Sheets
- Spreadsheet ID: `1QS7iSSq1sd948l2qQ-nI_qYuOWNsXs6UFkFAOd72QKM`
- Sheets: AKM-POS, InvoiceItems, Deposits, Expenses

### API Endpoints
- Local: `http://localhost:3000`
- Production: `https://akm-pos-api.onrender.com`

## Deployment

### Deploy Proxy Server to Render.com
```bash
git push origin main
```
Render will auto-deploy from GitHub.

### Deploy Frontend to Firebase
```bash
firebase deploy
```

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

## Notes

- All comments cleaned from code
- No unnecessary test files
- Minimal, production-ready codebase
- Invoice numbers reset each year
- Empty rows hidden when printing
- Real-time validation on inputs
