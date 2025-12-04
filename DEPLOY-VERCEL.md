# 🚀 FASTEST: Deploy to Vercel (FREE - Serverless)

## Convert proxy-server.js to Vercel Serverless:

Create `api/readSheet.js`:
```javascript
const { google } = require('googleapis');

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT);
const SPREADSHEET_ID = '1QS7iSSq1sd948l2qQ-nI_qYuOWNsXs6UFkFAOd72QKM';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { range, ranges } = req.body;
  
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  
  if (ranges) {
    const result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: ranges,
    });
    return res.json({ success: true, valueRanges: result.data.valueRanges });
  }
  
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range,
  });
  
  res.json({ success: true, values: result.data.values || [] });
};
```

## Quick Deploy:
```bash
npm install -g vercel
vercel login
vercel
```

Then add environment variable in Vercel dashboard:
- `SERVICE_ACCOUNT` = (paste serviceAccountKey.json content)

Your API: `https://akm-pos.vercel.app/api/readSheet`
