/**
 * Talk Today — SM Placement Test
 * Server-side controller Google Apps Script.
 */

function doGet(e) {
  if (e.parameter && e.parameter.format === "true") {
    try {
      formatSheetNow();
      return HtmlService.createHtmlOutput("<div style='font-family:\'Outfit\',sans-serif;background-color:#0b0f19;color:#f3f4f6;min-height:100vh;display:flex;justify-content:center;align-items:center;flex-direction:column;'><h1 style='color:#10b981;font-size:2.2rem;margin:0 0 10px 0;'>Spreadsheet reformatted successfully!</h1><p style='color:#9ca3af;font-size:1.1rem;margin:0 0 20px 0;'>The sheet has been cleared, layout reformatted, and example candidates John Doe & Jane Smith have been added.</p><a href='https://docs.google.com/spreadsheets/d/1hYUy0fM5EmVNKB8uBbdjXzYt8PFjMR6xM9Gn_fAzVdM/edit?gid=1959903046#gid=1959903046' target='_blank' style='color:#f3f4f6;background-color:#6366f1;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:600;font-size:1rem;box-shadow:0 8px 20px rgba(99, 102, 241, 0.3);'>Open Google Sheet Results</a></div>");
    } catch(err) {
      return HtmlService.createHtmlOutput("<div style='font-family:sans-serif;padding:30px;'><h1 style='color:#ef4444;'>Error reformatting spreadsheet:</h1><p>" + err.message + "</p></div>");
    }
  }
  const t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Talk Today — SM Placement Test')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Registers candidate registration details immediately at start of test.
 * Returns the row number of the created candidate row.
 */
function registerCandidate(candidate) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1hYUy0fM5EmVNKB8uBbdjXzYt8PFjMR6xM9Gn_fAzVdM");
    const ANSWER_KEY = {
      6: "B", 7: "A", 8: "C", 9: "C", 10: "A", 11: "B", 12: "C", 13: "A", 14: "B",
      15: "C", 16: "B", 17: "B", 18: "A", 19: "B", 20: "A", 21: "C", 22: "A", 23: "C",
      24: "B", 25: "B", 26: "B", 27: "C", 28: "A", 29: "B", 30: "A", 31: "A", 32: "C", 33: "A"
    };
    let sheet = getResultsSheet(ANSWER_KEY);
    
    // Construct row data: registration info, empty scores, status, and empty answers
    const rowData = [
      new Date(),
      candidate.name,
      candidate.phone,
      candidate.age,
      candidate.date,
      "", // Correct Answers
      "", // Total Questions
      "", // Score Percentage
      "In Progress...", // Status in Level column
      0,  // Duration (s)
      0,  // Tab Focus Losses
      0,  // Total Audio Plays
      ""  // Audio Plays Breakdown
    ];
    for (let q = 6; q <= 33; q++) {
      rowData.push("");
    }
    
    sheet.appendRow(rowData);
    return sheet.getLastRow();
  } catch (e) {
    console.error("Failed to register candidate: " + e.message);
    throw new Error("Candidate registration failed: " + e.message);
  }
}

/**
 * Logs a single question answer in real-time.
 */
function logQuestionAnswer(rowNumber, questionNum, answer, securityName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1hYUy0fM5EmVNKB8uBbdjXzYt8PFjMR6xM9Gn_fAzVdM");
    const sheet = ss.getSheetByName("Placement Results");
    if (!sheet) throw new Error("Results sheet not found");
    
    // Safety check: verify Name matches to prevent writing to wrong row
    const rowName = sheet.getRange(rowNumber, 2).getValue();
    if (rowName !== securityName) {
      throw new Error("Security verification failed. Expected: " + securityName + ", got: " + rowName);
    }
    
    const ANSWER_KEY = {
      6: "B", 7: "A", 8: "C", 9: "C", 10: "A", 11: "B", 12: "C", 13: "A", 14: "B",
      15: "C", 16: "B", 17: "B", 18: "A", 19: "B", 20: "A", 21: "C", 22: "A", 23: "C",
      24: "B", 25: "B", 26: "B", 27: "C", 28: "A", 29: "B", 30: "A", 31: "A", 32: "C", 33: "A"
    };
    
    const correctAns = ANSWER_KEY[questionNum];
    let formattedAnswer = "";
    if (answer === correctAns) {
      formattedAnswer = answer + " (Correct)";
    } else {
      formattedAnswer = answer + " (Incorrect, Correct: " + correctAns + ")";
    }
    
    const colIndex = 14 + (questionNum - 6);
    sheet.getRange(rowNumber, colIndex).setValue(formattedAnswer);
  } catch (e) {
    console.error("Real-time logging failed: " + e.message);
    throw new Error(e.message);
  }
}

/**
 * Finalizes test results at the end, writing scores and anti-cheat indicators.
 */
function finalizeTestResults(rowNumber, score, level, anticheat, securityName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1hYUy0fM5EmVNKB8uBbdjXzYt8PFjMR6xM9Gn_fAzVdM");
    const sheet = ss.getSheetByName("Placement Results");
    if (!sheet) throw new Error("Results sheet not found");
    
    // Safety check: verify Name
    const rowName = sheet.getRange(rowNumber, 2).getValue();
    if (rowName !== securityName) {
      throw new Error("Security verification failed on finalize.");
    }
    
    const percentage = ((score / 28) * 100).toFixed(1) + "%";
    
    // Set score details and anti-cheat fields (Columns 6 to 13)
    sheet.getRange(rowNumber, 6, 1, 8).setValues([[
      score,
      28,
      percentage,
      level,
      anticheat.totalDurationSec,
      anticheat.focusLossCount,
      anticheat.totalAudioPlays,
      anticheat.playCountsBreakdown
    ]]);
  } catch (e) {
    console.error("Finalization failed: " + e.message);
    throw new Error(e.message);
  }
}

/**
 * Saves candidate results to Google Sheet asynchronously (Fallback offline path).
 */
function submitPlacementResults(payload) {
  const candidate = payload.candidate;
  const answers = payload.answers;
  const score = payload.score;
  const total = payload.total;
  const percentage = payload.percentage;
  const level = payload.level;
  const anticheat = payload.anticheat || {
    totalDurationSec: 0,
    focusLossCount: 0,
    totalAudioPlays: 0,
    playCountsBreakdown: ""
  };
  
  const ANSWER_KEY = {
    6: "B", 7: "A", 8: "C", 9: "C", 10: "A", 11: "B", 12: "C", 13: "A", 14: "B",
    15: "C", 16: "B", 17: "B", 18: "A", 19: "B", 20: "A", 21: "C", 22: "A", 23: "C",
    24: "B", 25: "B", 26: "B", 27: "C", 28: "A", 29: "B", 30: "A", 31: "A", 32: "C", 33: "A"
  };
  
  try {
    let sheet = getResultsSheet(ANSWER_KEY);
    
    // Construct the full row data
    const rowData = [
      new Date(),
      candidate.name,
      candidate.phone,
      candidate.age,
      candidate.date,
      score,
      total,
      percentage,
      level,
      anticheat.totalDurationSec,
      anticheat.focusLossCount,
      anticheat.totalAudioPlays,
      anticheat.playCountsBreakdown
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
 */
function getResultsSheet(answerKey) {
  let ss;
  const scriptProperties = PropertiesService.getScriptProperties();
  let ssId = scriptProperties.getProperty('SPREADSHEET_ID');
  
  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (e) {
      ssId = null;
    }
  }
  
  if (!ssId) {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        scriptProperties.setProperty('SPREADSHEET_ID', ss.getId());
      }
    } catch (e) {
      // Standalone script
    }
    
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
    // If the sheet uses the old layout (less than 13 columns), clear it
    if (sheet.getLastColumn() > 0 && sheet.getLastColumn() < 13) {
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
      "Suggested CEFR Level",
      "Total Duration (s)",
      "Tab Focus Losses",
      "Total Audio Plays",
      "Audio Plays Breakdown"
    ];
    for (let q = 6; q <= 33; q++) {
      headers.push("Q" + q + " (Correct: " + answerKey[q] + ")");
    }
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e2e8f0");
  }
  return sheet;
}

/**
 * Triggered on demand to reformat the sheets and insert mock candidates for testing
 */
function formatSheetNow() {
  const ANSWER_KEY = {
    6: "B", 7: "A", 8: "C", 9: "C", 10: "A", 11: "B", 12: "C", 13: "A", 14: "B",
    15: "C", 16: "B", 17: "B", 18: "A", 19: "B", 20: "A", 21: "C", 22: "A", 23: "C",
    24: "B", 25: "B", 26: "B", 27: "C", 28: "A", 29: "B", 30: "A", 31: "A", 32: "C", 33: "A"
  };
  
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch(e) {}
  
  if (!ss) {
    ss = SpreadsheetApp.openById("1hYUy0fM5EmVNKB8uBbdjXzYt8PFjMR6xM9Gn_fAzVdM");
  }
  
  let sheet = ss.getSheetByName("Placement Results");
  if (!sheet) {
    sheet = ss.insertSheet("Placement Results");
  }
  
  sheet.clear();
  
  const headers = [
    "Timestamp",
    "Full Name",
    "WhatsApp Number",
    "Age",
    "Test Date",
    "Correct Answers",
    "Total Questions",
    "Score Percentage",
    "Suggested CEFR Level",
    "Total Duration (s)",
    "Tab Focus Losses",
    "Total Audio Plays",
    "Audio Plays Breakdown"
  ];
  for (let q = 6; q <= 33; q++) {
    headers.push("Q" + q + " (Correct: " + ANSWER_KEY[q] + ")");
  }
  
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e2e8f0");
  
  // Mock Candidate 1 (John Doe - Pre-A1 High)
  const johnAnswers = {};
  for (let q = 6; q <= 33; q++) {
    if (q % 5 === 0) {
      johnAnswers[q] = ANSWER_KEY[q] === "A" ? "B" : "A";
    } else {
      johnAnswers[q] = ANSWER_KEY[q];
    }
  }
  
  const johnRow = [
    new Date(),
    "John Doe (Example)",
    "+212612345678",
    "10",
    new Date().toISOString().split('T')[0],
    "24",
    "28",
    "85.7%",
    "Pre-A1 (High)",
    180,
    0,
    32,
    "Q6:1, Q7:2, Q8:1, Q9:1, Q10:2, Q11:1, Q12:1, Q13:1, Q14:1, Q15:1, Q16:1, Q17:1, Q18:1, Q19:1, Q20:1, Q21:1, Q22:1, Q23:1, Q24:1, Q25:2, Q26:1, Q27:1, Q28:1, Q29:2, Q30:1, Q31:1, Q32:1, Q33:2"
  ];
  for (let q = 6; q <= 33; q++) {
    if (johnAnswers[q] === ANSWER_KEY[q]) {
      johnRow.push(johnAnswers[q] + " (Correct)");
    } else {
      johnRow.push(johnAnswers[q] + " (Incorrect, Correct: " + ANSWER_KEY[q] + ")");
    }
  }
  sheet.appendRow(johnRow);
  
  // Mock Candidate 2 (Jane Smith - Below Pre-A1)
  const janeAnswers = {};
  for (let q = 6; q <= 33; q++) {
    if (q % 5 === 0) {
      janeAnswers[q] = ANSWER_KEY[q];
    } else {
      janeAnswers[q] = ANSWER_KEY[q] === "A" ? "B" : "A";
    }
  }
  
  const janeRow = [
    new Date(),
    "Jane Smith (Example)",
    "+212687654321",
    "6",
    new Date().toISOString().split('T')[0],
    "5",
    "28",
    "17.9%",
    "Below Pre-A1 (Starter)",
    450,
    12,
    54,
    "Q6:3, Q7:2, Q8:2, Q9:1, Q10:2, Q11:2, Q12:1, Q13:3, Q14:2, Q15:2, Q16:1, Q17:2, Q18:1, Q19:2, Q20:2, Q21:2, Q22:1, Q23:1, Q24:2, Q25:3, Q26:2, Q27:1, Q28:3, Q29:2, Q30:1, Q31:2, Q32:3, Q33:2"
  ];
  for (let q = 6; q <= 33; q++) {
    if (janeAnswers[q] === ANSWER_KEY[q]) {
      janeRow.push(janeAnswers[q] + " (Correct)");
    } else {
      janeRow.push(janeAnswers[q] + " (Incorrect, Correct: " + ANSWER_KEY[q] + ")");
    }
  }
  sheet.appendRow(janeRow);
  
  sheet.autoResizeColumns(1, headers.length);
}


function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result = null;
    if (data.action === "logQuestionAnswer") {
      result = logQuestionAnswer(data.args[0], data.args[1], data.args[2], data.args[3]);
    } else if (data.action === "registerCandidate") {
      result = registerCandidate(data.args[0]);
    } else if (data.action === "submitPlacementResults") {
      result = submitPlacementResults(data.args[0]);
    } else if (data.action === "finalizeTestResults") {
      result = finalizeTestResults(data.args[0], data.args[1], data.args[2], data.args[3], data.args[4]);
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true, result: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
