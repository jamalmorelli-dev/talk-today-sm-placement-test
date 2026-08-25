/**
 * Talk Today — SM Placement Test
 * Server-side controller Google Apps Script.
 */

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Talk Today — SM Placement Test')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Saves candidate results to Google Sheet asynchronously.
 * Expands response details to separate columns for each question.
 */
function submitPlacementResults(payload) {
  const candidate = payload.candidate;
  const answers = payload.answers;
  const score = payload.score;
  const total = payload.total;
  const percentage = payload.percentage;
  const level = payload.level;
  
  const ANSWER_KEY = {
    6: "B", 7: "A", 8: "C", 9: "C", 10: "A", 11: "B", 12: "C", 13: "A", 14: "B",
    15: "C", 16: "B", 17: "B", 18: "A", 19: "B", 20: "A", 21: "C", 22: "A", 23: "C",
    24: "B", 25: "B", 26: "B", 27: "C", 28: "A", 29: "B", 30: "A", 31: "A", 32: "C", 33: "A"
  };
  
  try {
    let sheet = getResultsSheet(ANSWER_KEY);
    
    // Construct the row data
    const rowData = [
      new Date(),
      candidate.name,
      candidate.phone,
      candidate.age,
      candidate.date,
      score,
      total,
      percentage,
      level
    ];
    
    // Append answer for each question (Q6 to Q33)
    for (let q = 6; q <= 33; q++) {
      const studentAns = answers[q];
      const correctAns = ANSWER_KEY[q];
      if (!studentAns) {
        rowData.push("Unanswered");
      } else if (studentAns === correctAns) {
        rowData.push(studentAns + " (Correct)");
      } else {
        rowData.push(studentAns + " (Incorrect, Correct: " + correctAns + ")");
      }
    }
    
    sheet.appendRow(rowData);
  } catch (e) {
    console.error("Failed to write to Google Sheet: " + e.message);
    throw new Error("Google Sheet write failed: " + e.message);
  }
  
  return { success: true };
}

/**
 * Gets or creates the spreadsheet for storing results.
 * Uses PropertiesService to cache the ID for high-performance direct open.
 */
function getResultsSheet(answerKey) {
  let ss;
  const scriptProperties = PropertiesService.getScriptProperties();
  let ssId = scriptProperties.getProperty('SPREADSHEET_ID');
  
  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (e) {
      ssId = null; // Stale ID, clear to search again
    }
  }
  
  if (!ssId) {
    // 1. Try to bind to active spreadsheet (if container-bound)
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        scriptProperties.setProperty('SPREADSHEET_ID', ss.getId());
      }
    } catch (e) {
      // Standalone script
    }
    
    // 2. Search Drive by name or create a fresh one
    if (!ss) {
      const sheetName = "Talk Today - SM Placement Results";
      const files = DriveApp.getFilesByName(sheetName);
      if (files.hasNext()) {
        const file = files.next();
        ss = SpreadsheetApp.open(file);
        scriptProperties.setProperty('SPREADSHEET_ID', ss.getId());
      } else {
        ss = SpreadsheetApp.create(sheetName);
        scriptProperties.setProperty('SPREADSHEET_ID', ss.getId());
      }
    }
  }
  
  let sheet = ss.getSheetByName("Placement Results");
  if (sheet) {
    // Check if the sheet uses the old format (less than 10 columns). If so, clear it.
    if (sheet.getLastColumn() > 0 && sheet.getLastColumn() < 10) {
      sheet.clear();
    }
  }
  
  if (!sheet) {
    sheet = ss.insertSheet("Placement Results");
  }
  
  if (sheet.getLastRow() === 0) {
    const headers = [
      "Timestamp",
      "Full Name",
      "WhatsApp Number",
      "Age",
      "Test Date",
      "Correct Answers",
      "Total Questions",
      "Score Percentage",
      "Suggested CEFR Level"
    ];
    for (let q = 6; q <= 33; q++) {
      headers.push("Q" + q + " (Correct: " + answerKey[q] + ")");
    }
    sheet.appendRow(headers);
    // Format header row (bold & light background)
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e2e8f0");
  }
  return sheet;
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const result = submitPlacementResults(payload);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}
