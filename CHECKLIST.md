# ✅ DEPLOYMENT CHECKLIST

## STEP-BY-STEP CHECKLIST

### ✅ COMPLETED:
- [x] Code prepared for deployment
- [x] Git repository initialized
- [x] Code committed to git
- [x] Service account environment variable support added
- [x] Package.json configured
- [x] render.yaml created
- [x] .gitignore configured

### 🔄 YOUR TURN - DO THESE NOW:

#### □ STEP 1: Create GitHub Repository
- [ ] Go to: https://github.com/new (OPENED IN BROWSER)
- [ ] Name: `akm-pos-backend`
- [ ] Set to **Private**
- [ ] Click "Create repository"
- [ ] Copy the commands shown

#### □ STEP 2: Push to GitHub
Run in terminal (replace YOUR-USERNAME with your GitHub username):
```bash
cd "C:\Users\Administrator\Documents\Coding\Daily-sale\AKM-POS"
git remote add origin https://github.com/YOUR-USERNAME/akm-pos-backend.git
git branch -M main
git push -u origin main
```

#### □ STEP 3: Sign up on Render.com
- [ ] Go to: https://render.com (OPENED IN BROWSER)
- [ ] Click "Get Started"
- [ ] Sign up with GitHub
- [ ] Authorize Render to access your repos

#### □ STEP 4: Create Web Service
- [ ] Click "New +" → "Web Service"
- [ ] Select `akm-pos-backend` repo
- [ ] Name: `akm-pos-api`
- [ ] Region: Singapore or Frankfurt
- [ ] Runtime: Node
- [ ] Build: `npm install`
- [ ] Start: `node proxy-server.js`
- [ ] Plan: **Free**
- [ ] Click "Create Web Service"
- [ ] Wait 2-3 minutes...

#### □ STEP 5: Add Service Account
- [ ] Click "Environment" tab
- [ ] Click "Add Secret File"
- [ ] Filename: `functions/serviceAccountKey.json`
- [ ] Contents: Paste from local file
- [ ] Save and wait for redeploy

#### □ STEP 6: Copy Your Backend URL
- [ ] Copy URL shown: `https://akm-pos-api.onrender.com`
- [ ] Paste it below for reference:
  ```
  MY RENDER URL: _________________________
  ```

#### □ STEP 7: Update Frontend
- [ ] Edit `app.js` line 18
- [ ] Replace with your Render URL
- [ ] Save file

#### □ STEP 8: Deploy Frontend
```bash
firebase deploy --only hosting
```

#### □ STEP 9: TEST!
- [ ] Open: https://akm-daily.web.app
- [ ] Sign in: sales@akm-music.com
- [ ] Create test invoice
- [ ] Check Google Sheets
- [ ] 🎉 SUCCESS!

---

## 📞 CURRENT STATUS:

**What's ready:**
- ✅ Code is in git
- ✅ Ready to push to GitHub
- ✅ Configuration files ready
- ✅ Local system still works (npm start)

**What you need to do:**
1. Create GitHub repo (2 min)
2. Push code (1 min)
3. Deploy to Render (5 min)
4. Add secret (2 min)
5. Update frontend (1 min)
6. Deploy frontend (1 min)

**Total time: ~12 minutes!**

---

## 🆘 NEED HELP?

See detailed instructions in: `DEPLOY-STEPS.md`

**I'm here to help at each step!** Just tell me where you're stuck.
