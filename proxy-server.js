/**
 * Simple Express Proxy Server for Google Sheets API
 * This runs locally or can be deployed to free hosting (Render/Railway)
 * No Firebase Blaze plan required!
 */

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (needed for deployed frontend)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Serve static files (HTML, CSS, JS) from the current directory
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// Load service account credentials
// In production (Render), use environment variable
// In local development, use file
let serviceAccount;
if (process.env.SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT);
  console.log('📋 Using service account from environment variable');
} else {
  const serviceAccountPath = path.join(__dirname, 'functions', 'serviceAccountKey.json');
  serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  console.log('📋 Using service account from file');
}

// Google Sheets configuration
const SPREADSHEET_ID = '1QS7iSSq1sd948l2qQ-nI_qYuOWNsXs6UFkFAOd72QKM';

/**
 * Initialize Google Sheets API client
 */
async function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

/**
 * Serve index.html at root
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Health check API endpoint
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AKM-POS Proxy Server is running',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Favicon handler (to avoid 404 errors)
 */
app.get('/favicon.ico', (req, res) => {
  const faviconPath = path.join(__dirname, 'Favicon.png');
  if (fs.existsSync(faviconPath)) {
    res.sendFile(faviconPath);
  } else {
    res.status(204).end(); // No content
  }
});

/**
 * Read from Google Sheets endpoint
 */
app.post('/readSheet', async (req, res) => {
  try {
    const { range, ranges } = req.body;

    console.log('📖 Sheet read request:', { range, ranges });

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    let result;

    if (ranges && ranges.length > 0) {
      // Batch read multiple ranges
      result = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: ranges,
      });

      console.log('✅ Batch read successful');

      return res.status(200).json({
        success: true,
        valueRanges: result.data.valueRanges,
      });
    } else if (range) {
      // Single range read
      result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
      });

      console.log('✅ Read successful:', range);

      return res.status(200).json({
        success: true,
        values: result.data.values || [],
        range: result.data.range,
      });
    } else {
      return res.status(400).json({
        error: 'Either range or ranges parameter is required',
      });
    }
  } catch (error) {
    console.error('❌ Sheet read failed:', error.message);

    return res.status(500).json({
      error: 'Failed to read from sheet',
      details: error.message,
    });
  }
});

/**
 * Write to Google Sheets endpoint
 */
app.post('/writeToSheet', async (req, res) => {
  try {
    const { action, sheetName, values, range } = req.body;

    // Validate request
    if (!action || !sheetName || !values) {
      return res.status(400).json({
        error: 'Missing required fields: action, sheetName, values',
      });
    }

    console.log('📝 Sheet write request:', { action, sheetName, range });

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    let result;    if (action === 'append') {
      // Append new row(s) to sheet
      // If values is already an array of rows, use it as-is
      // If values is a single row, wrap it in an array
      const rowsToAppend = Array.isArray(values[0]) ? values : [values];
      
      result = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rowsToAppend,
        },
      });

      console.log('✅ Append successful:', result.data.updates.updatedRange);

      return res.status(200).json({
        success: true,
        message: 'Data appended successfully',
        updatedRange: result.data.updates.updatedRange,
        updatedRows: result.data.updates.updatedRows,
      });    } else if (action === 'update') {
      // Update existing row(s)
      if (!range) {
        return res.status(400).json({
          error: 'Range is required for update action',
        });
      }

      // If values is already an array of rows, use it as-is
      // If values is a single row, wrap it in an array
      const rowsToUpdate = Array.isArray(values[0]) ? values : [values];

      result = await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!${range}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rowsToUpdate,
        },
      });

      console.log('✅ Update successful:', result.data.updatedRange);

      return res.status(200).json({
        success: true,
        message: 'Data updated successfully',
        updatedRange: result.data.updatedRange,
        updatedCells: result.data.updatedCells,
      });
    } else {
      return res.status(400).json({
        error: "Invalid action. Use 'append' or 'update'",
      });
    }
  } catch (error) {
    console.error('❌ Sheet operation failed:', error.message);

    return res.status(500).json({
      error: 'Failed to write to sheet',
      details: error.message,
    });
  }
});

/**
 * Read from Google Sheets endpoint
 */
app.get('/readSheet', async (req, res) => {
  try {
    console.log('📖 Sheet read request');

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    // Read all data from Sheet1
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E', // Columns A to E (Invoice Number, Date, Total, Payment, Data)
    });

    const rows = result.data.values || [];
    
    console.log(`✅ Read successful: ${rows.length} rows`);

    return res.status(200).json({
      success: true,
      rows: rows,
      count: rows.length,
    });
  } catch (error) {
    console.error('❌ Sheet read failed:', error.message);

    return res.status(500).json({
      error: 'Failed to read from sheet',
      details: error.message,
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   🚀 AKM-POS Server Running                  ║
║   📍 Port: ${PORT}                              ║
║   🌐 POS System: http://localhost:${PORT}       ║
║   📄 Status Page: http://localhost:${PORT}/STATUS.html ║
║   🔌 API: http://localhost:${PORT}/writeToSheet ║
║   📊 Google Sheets: Connected                ║
╚═══════════════════════════════════════════════╝
  `);
});
