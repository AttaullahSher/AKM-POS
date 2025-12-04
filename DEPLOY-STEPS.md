# 🚀 DEPLOY TO RENDER.COM - COMPLETE GUIDE

## ✅ CODE IS READY! Now follow these steps:

---

## 📋 STEP 1: Create GitHub Repository

1. Go to: **https://github.com/new**
2. Repository name: `akm-pos-backend`
3. Description: `AKM POS Backend API`
4. Make it **Private** (recommended)
5. Click **"Create repository"**

You'll get commands like:
```bash
git remote add origin https://github.com/YOUR-USERNAME/akm-pos-backend.git
git branch -M main
git push -u origin main
```

---

## 📋 STEP 2: Push Code to GitHub

Run these commands in your terminal (replace YOUR-USERNAME):

```bash
cd "C:\Users\Administrator\Documents\Coding\Daily-sale\AKM-POS"

# Add GitHub remote
git remote add origin https://github.com/YOUR-USERNAME/akm-pos-backend.git

# Rename branch to main
git branch -M main

# Push code
git push -u origin main
```

---

## 📋 STEP 3: Deploy to Render.com

1. **Go to**: https://render.com
2. **Sign up** with GitHub (click "Get Started")
3. Click **"New +"** → **"Web Service"**
4. Click **"Connect account"** to link GitHub
5. Find and select: `akm-pos-backend`
6. Fill in the form:
   - **Name**: `akm-pos-api`
   - **Region**: Choose closest to UAE (e.g., Singapore or Frankfurt)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node proxy-server.js`
   - **Instance Type**: `Free`
7. Click **"Create Web Service"**

⏳ Wait 2-3 minutes for deployment...

---

## 📋 STEP 4: Add Service Account Secret

1. In Render dashboard, click your service: `akm-pos-api`
2. Go to **"Environment"** tab (left sidebar)
3. Click **"Add Secret File"**
4. Fill in:
   - **Filename**: `functions/serviceAccountKey.json`
   - **Contents**: Copy and paste the ENTIRE contents of your local file:
     `C:\Users\Administrator\Documents\Coding\Daily-sale\AKM-POS\functions\serviceAccountKey.json`
5. Click **"Save Changes"**

🔄 Render will automatically redeploy with the secret!

---

## 📋 STEP 5: Get Your Backend URL

After deployment completes, you'll see:

```
Your service is live at https://akm-pos-api.onrender.com
```

Copy this URL! ✅

---

## 📋 STEP 6: Update Frontend

Edit `app.js` line 17-18, replace:
```javascript
const API_BASE_URL = IS_LOCAL 
  ? 'http://localhost:3000' 
  : 'https://us-central1-akm-pos-480210.cloudfunctions.net';
```

With your Render URL:
```javascript
const API_BASE_URL = IS_LOCAL 
  ? 'http://localhost:3000' 
  : 'https://akm-pos-api.onrender.com';  // ← Your Render URL
```

---

## 📋 STEP 7: Deploy Frontend to Firebase

```bash
cd "C:\Users\Administrator\Documents\Coding\Daily-sale\AKM-POS"
firebase deploy --only hosting
```

---

## 🎉 DONE! TEST YOUR SYSTEM

1. Open: **https://akm-daily.web.app**
2. Sign in with: **sales@akm-music.com**
3. Create a test invoice
4. Check Google Sheets!

---

## 🔧 TROUBLESHOOTING

### If service won't start:
- Check Render logs: Click "Logs" tab
- Verify service account was added correctly
- Check that all npm packages installed

### If API calls fail:
- Check Render service is running (green dot)
- Verify URL in `app.js` matches Render URL exactly
- Check browser console for CORS errors

### Service sleeping?
- Free tier sleeps after 15 minutes of inactivity
- First request wakes it up (takes <30 seconds)
- After waking, it stays fast!

---

## 💡 NEXT STEPS

### Keep Service Awake (Optional):
Use UptimeRobot or Cron-Job.org to ping your service every 14 minutes:
```
https://akm-pos-api.onrender.com/api/status
```

### Custom Domain (Optional):
- Buy domain (e.g., akm-pos.com)
- Add CNAME in Render dashboard
- Point to your Render URL

---

## ✅ YOUR SETUP:

- **Frontend**: https://akm-daily.web.app (Firebase Hosting)
- **Backend**: https://akm-pos-api.onrender.com (Render.com)
- **Database**: Google Sheets
- **Auth**: Firebase Auth

**Total Monthly Cost: $0** 🎉

---

## 📞 NEED HELP?

Check Render logs if something goes wrong:
1. Go to Render dashboard
2. Click your service
3. Click "Logs" tab
4. Look for error messages

Common issues:
- ❌ `Cannot find module` → npm install didn't run
- ❌ `SERVICE_ACCOUNT is not defined` → Secret file not added
- ❌ `Port already in use` → Should not happen on Render
- ❌ `CORS error` → Check URL in app.js matches exactly

---

🎊 **Congratulations! Your POS is fully deployed to the cloud!**
