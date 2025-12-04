/**
 * AKM-POS Cloud Functions
 * Google Sheets API Integration for POS Invoice Management
 */

const functions = require("firebase-functions");
const {google} = require("googleapis");

// Load service account credentials
const serviceAccount = require("./serviceAccountKey.json");

// Google Sheets configuration
const SPREADSHEET_ID = "1QS7iSSq1sd948l2qQ-nI_qYuOWNsXs6UFkFAOd72QKM";

/**
 * Initialize Google Sheets API client
 */
async function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const authClient = await auth.getClient();
  return google.sheets({version: "v4", auth: authClient});
}

/**
 * Cloud Function: Write Invoice Data to Google Sheets
 * Handles both append and update operations
 */
exports.writeToSheet = functions.https.onRequest(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  // Set CORS headers
  res.set("Access-Control-Allow-Origin", "*");

  // Only allow POST requests
  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }

  try {
    const {action, sheetName, values, range} = req.body;

    // Validate request
    if (!action || !sheetName || !values) {
      res.status(400).json({
        error: "Missing required fields: action, sheetName, values",
      });
      return;
    }

    console.log("Sheet write request", {action, sheetName, range});

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    let result;

    if (action === "append") {
      // Append new row to sheet
      result = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [values],
        },
      });

      console.log("Append successful", {
        updatedRange: result.data.updates.updatedRange,
      });

      res.status(200).json({
        success: true,
        message: "Data appended successfully",
        updatedRange: result.data.updates.updatedRange,
        updatedRows: result.data.updates.updatedRows,
      });
    } else if (action === "update") {
      // Update existing row
      if (!range) {
        res.status(400).json({
          error: "Range is required for update action",
        });
        return;
      }

      result = await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!${range}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [values],
        },
      });

      console.log("Update successful", {
        updatedRange: result.data.updatedRange,
      });

      res.status(200).json({
        success: true,
        message: "Data updated successfully",
        updatedRange: result.data.updatedRange,
        updatedCells: result.data.updatedCells,
      });
    } else {
      res.status(400).json({
        error: "Invalid action. Use 'append' or 'update'",
      });
    }
  } catch (error) {
    console.error("Sheet operation failed", error);

    res.status(500).json({
      error: "Failed to write to sheet",
      details: error.message,
    });
  }
});
