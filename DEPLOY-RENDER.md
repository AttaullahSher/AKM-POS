# 🚀 DEPLOY BACKEND TO RENDER.COM (FREE!)

## Steps:

1. **Push to GitHub:**
```bash
cd C:\Users\Administrator\Documents\Coding\Daily-sale\AKM-POS
git init
git add .
git commit -m "Deploy AKM-POS backend"
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

2. **Deploy on Render.com:**
- Go to: https://render.com
- Sign up with GitHub
- Click "New +" → "Web Service"
- Connect your GitHub repo
- Render will auto-detect `render.yaml`
- Click "Create Web Service"

3. **Add Service Account Secret:**
- In Render dashboard, go to your service
- Click "Environment" tab
- Add "Secret File":
  - Filename: `functions/serviceAccountKey.json`
  - Contents: Paste your service account JSON

4. **Get Your API URL:**
After deployment, Render gives you a URL like:
```
https://akm-pos-api.onrender.com
```

5. **Update Frontend:**
Edit `app.js` line 18:
```javascript
const API_BASE_URL = IS_LOCAL 
  ? 'http://localhost:3000' 
  : 'https://akm-pos-api.onrender.com';
```

6. **Deploy Frontend:**
```bash
firebase deploy --only hosting
```

## ✅ Done! Your system works WITHOUT Firebase Blaze!

---

## 🆓 FREE TIER LIMITS:
- 750 hours/month (enough for 24/7 operation)
- Auto-sleeps after 15 min of inactivity (wakes in <1 min)
- Unlimited requests
