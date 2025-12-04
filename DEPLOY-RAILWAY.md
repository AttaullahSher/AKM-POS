# 🚀 ALTERNATIVE: Deploy to Railway.app (FREE $5 credit)

## Even Easier Setup:

1. **Install Railway CLI:**
```bash
npm install -g @railway/cli
```

2. **Login:**
```bash
railway login
```

3. **Deploy:**
```bash
cd C:\Users\Administrator\Documents\Coding\Daily-sale\AKM-POS
railway init
railway up
```

4. **Add Service Account:**
```bash
railway variables set SERVICE_ACCOUNT="$(cat functions/serviceAccountKey.json)"
```

5. **Get URL:**
```bash
railway domain
```
Returns: `https://akm-pos-production.up.railway.app`

6. **Update app.js:**
```javascript
const API_BASE_URL = IS_LOCAL 
  ? 'http://localhost:3000' 
  : 'https://akm-pos-production.up.railway.app';
```

7. **Deploy Frontend:**
```bash
firebase deploy --only hosting
```

## ✅ DONE! No Blaze plan needed!

---

## 🆓 FREE TIER:
- $5 free credit/month
- 500 hours execution
- 100GB outbound bandwidth
