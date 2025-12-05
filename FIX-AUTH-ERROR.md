# 🚨 FIREBASE AUTH ERROR - SOLUTION

## The Error You're Seeing:
```
FirebaseError: Firebase: Error (auth/unauthorized-domain)
```

This means Firebase doesn't recognize your local development domain (`localhost` or `127.0.0.1`).

---

## ✅ Solution (Takes 2 Minutes)

### Step-by-Step:

#### 1. Open Firebase Console
🔗 **Direct Link:** https://console.firebase.google.com/project/akm-pos-480210/authentication/settings

Or manually:
- Go to https://console.firebase.google.com
- Click on project: **akm-pos-480210**

#### 2. Navigate to Authorized Domains
```
Firebase Console
  └─ Authentication (left sidebar)
       └─ Settings (top tab)
            └─ Authorized domains (tab)
                 └─ Click "Add domain" button
```

#### 3. Add These Domains (one at a time)
Click **"Add domain"** and enter:

✅ `localhost`
✅ `127.0.0.1`

Optional (for production):
✅ `akm-pos-480210.web.app`
✅ `akm-pos-480210.firebaseapp.com`

#### 4. Save Changes
- Click **"Add"** for each domain
- Wait 10 seconds for propagation

#### 5. Refresh Your Browser
- Go back to `http://localhost:3000`
- Try signing in again
- Should now work! ✅

---

## After Fix - Expected Console Output:
```
🚀 AKM-POS initializing...
🔐 Auth state changed: No user
📱 Showing login screen
🔑 Opening Google sign-in popup...
✅ User signed in: sales@akm-music.com
```

---

## Alternative: Deploy to Production First

If you want to skip local setup:
```bash
firebase deploy
```
Then open: https://akm-pos-480210.web.app

Production domains are automatically authorized.

---

## Troubleshooting

### Still Getting Error After Adding Domains?
1. Clear browser cache (Ctrl+Shift+Delete)
2. Try incognito/private window
3. Wait 1-2 minutes (Firebase propagation delay)
4. Make sure domains are typed exactly: `localhost` (no http://)

### Can't Access Firebase Console?
- You need admin access to the Firebase project
- Contact the project owner (sales@akm-music.com)
- Or use the production URL after deployment

---

## One-Time Setup
✅ This fix only needs to be done **once** per Firebase project
✅ After adding domains, local development will work forever
✅ All team members need the same domains added

---

**Need Help?** Check the Firebase error message in browser console for more details.
