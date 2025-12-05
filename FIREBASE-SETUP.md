## 🔧 FIREBASE SETUP REQUIRED

### Error: `auth/unauthorized-domain`

This error occurs because Firebase doesn't recognize your local development domain.

### Quick Fix (5 minutes):

1. **Open Firebase Console**
   - Go to: https://console.firebase.google.com
   - Select project: **akm-pos-480210**

2. **Add Authorized Domains**
   - Click **Authentication** (left sidebar)
   - Click **Settings** tab
   - Click **Authorized domains** tab
   - Click **Add domain**
   
3. **Add These Domains:**
   ```
   localhost
   127.0.0.1
   ```
   
   If you're hosting on Firebase:
   ```
   akm-pos-480210.web.app
   akm-pos-480210.firebaseapp.com
   ```

4. **Save & Refresh**
   - Click **Add** for each domain
   - Refresh your browser at http://localhost:3000
   - Try signing in again

### Screenshot Guide:

```
Firebase Console
└── Authentication
    └── Settings
        └── Authorized domains
            └── [Add domain] button
                ├── localhost ✅
                ├── 127.0.0.1 ✅
                └── your-domain.com ✅
```

### After Adding Domains:

Your console should show:
```
app.js:94 🔑 Opening Google sign-in popup...
app.js:96 ✅ User signed in: sales@akm-music.com
```

### Alternative: Use Production URL

If you've already deployed to Firebase Hosting:
```bash
firebase deploy
# Then open: https://akm-pos-480210.web.app
```

Production domains are automatically authorized.

---

**Note:** This is a one-time setup. Once domains are added, all future development sessions will work without this step.
