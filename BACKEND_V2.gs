/**
 * Talk Today — SM Placement Test backend v2
 * GitHub Pages frontend -> Google Apps Script JSON API.
 *
 * IMPORTANT: GitHub does not execute this file. Antigravity/operator must copy/push
 * this file into Apps Script, set SPREADSHEET_ID, and redeploy the web app.
 */

const TT_CONFIG = Object.freeze({
  SHEET_NAME: 'Placement Results',
  SPREADSHEET_PROPERTY: 'SPREADSHEET_ID',
  TOTAL_QUESTIONS: 28,
  FIRST_QUESTION: 6,
  LAST_QUESTION: 33
});

const TT_ANSWER_KEY = Object.freeze({
  6:'B',7:'A',8:'C',9:'C',10:'A',11:'B',12:'C',13:'A',14:'B',
  15:'C',16:'B',17:'B',18:'A',19:'B',20:'A',21:'C',22:'A',23:'C',
  24:'B',25:'B',26:'B',27:'C',28:'A',29:'B',30:'A',31:'A',32:'C',33:'A'
});

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeName_(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function requestId_() {
  return Utilities.getUuid();
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(TT_CONFIG.SPREADSHEET_PROPERTY);
  if (!id) throw new Error('SPREADSHEET_ID script property is missing.');
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error('Cannot open SPREADSHEET_ID=' + id + ': ' + err.message);
  }
}

function getResultsSheetV2_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(TT_CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(TT_CONFIG.SHEET_NAME);

  const headers = [
    'Timestamp','Submission ID','Full Name','WhatsApp Number','Age','Test Date',
    'Correct Answers','Total Questions','Score Percentage','Suggested CEFR Level',
    'Total Duration (s)','Tab Focus Losses','Total Audio Plays','Audio Plays Breakdown','Save Status'
  ];
  for (let q = TT_CONFIG.FIRST_QUESTION; q <= TT_CONFIG.LAST_QUESTION; q++) {
    headers.push('Q' + q + ' (Correct: ' + TT_ANSWER_KEY[q] + ')');
  }

  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

function healthCheck() {
  const ss = getSpreadsheet_();
  const sh = getResultsSheetV2_();
  return {
    ok: true,
    version: '2.0.0',
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheetName: sh.getName(),
    timestamp: new Date().toISOString()
  };
}

function findSubmissionRow_(sh, submissionId) {
  if (!submissionId) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const values = sh.getRange(2,2,last-1,1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(submissionId)) return i + 2;
  }
  return 0;
}

function registerCandidateV2(candidate, submissionId) {
  if (!candidate || !candidate.name) throw new Error('Candidate name is required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getResultsSheetV2_();
    const id = submissionId || requestId_();
    let row = findSubmissionRow_(sh, id);
    if (row) return { success:true, submissionId:id, rowNumber:row, duplicate:true };

    const rowData = [
      new Date(), id, candidate.name || '', candidate.phone || '', candidate.age || '', candidate.date || '',
      '', '', '', 'In Progress...', 0, 0, 0, '', 'REGISTERED'
    ];
    for (let q = TT_CONFIG.FIRST_QUESTION; q <= TT_CONFIG.LAST_QUESTION; q++) rowData.push('');
    sh.appendRow(rowData);
    row = sh.getLastRow();
    SpreadsheetApp.flush();
    return { success:true, submissionId:id, rowNumber:row, duplicate:false };
  } finally {
    lock.releaseLock();
  }
}

function logQuestionAnswerV2(submissionId, questionNum, answer, securityName) {
  const sh = getResultsSheetV2_();
  const row = findSubmissionRow_(sh, submissionId);
  if (!row) throw new Error('Submission not found: ' + submissionId);
  const storedName = sh.getRange(row,3).getDisplayValue();
  if (normalizeName_(storedName) !== normalizeName_(securityName)) {
    throw new Error('Security verification failed.');
  }
  const q = Number(questionNum);
  if (q < TT_CONFIG.FIRST_QUESTION || q > TT_CONFIG.LAST_QUESTION) throw new Error('Invalid question number.');
  const correct = TT_ANSWER_KEY[q];
  const formatted = !answer ? 'Unanswered' : (answer === correct ? answer + ' (Correct)' : answer + ' (Incorrect, Correct: ' + correct + ')');
  const col = 16 + (q - TT_CONFIG.FIRST_QUESTION);
  sh.getRange(row,col).setValue(formatted);
  return { success:true, submissionId:submissionId, rowNumber:row, question:q };
}

function finalizeTestResultsV2(submissionId, score, level, anticheat, securityName) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getResultsSheetV2_();
    const row = findSubmissionRow_(sh, submissionId);
    if (!row) throw new Error('Submission not found: ' + submissionId);
    const storedName = sh.getRange(row,3).getDisplayValue();
    if (normalizeName_(storedName) !== normalizeName_(securityName)) throw new Error('Security verification failed on finalize.');

    anticheat = anticheat || {};
    const numericScore = Number(score) || 0;
    const percentage = ((numericScore / TT_CONFIG.TOTAL_QUESTIONS) * 100).toFixed(1) + '%';
    sh.getRange(row,7,1,9).setValues([[
      numericScore,
      TT_CONFIG.TOTAL_QUESTIONS,
      percentage,
      level || '',
      anticheat.totalDurationSec || 0,
      anticheat.focusLossCount || 0,
      anticheat.totalAudioPlays || 0,
      anticheat.playCountsBreakdown || '',
      'SAVED'
    ]]);
    SpreadsheetApp.flush();
    return { success:true, submissionId:submissionId, rowNumber:row, saved:true, score:numericScore, total:TT_CONFIG.TOTAL_QUESTIONS, percentage:percentage };
  } finally {
    lock.releaseLock();
  }
}

function submitPlacementResultsV2(payload) {
  if (!payload || !payload.candidate) throw new Error('Invalid payload.');
  const submissionId = payload.submissionId || requestId_();
  const reg = registerCandidateV2(payload.candidate, submissionId);
  const answers = payload.answers || {};
  Object.keys(answers).forEach(function(q) {
    const n = Number(q);
    if (n >= TT_CONFIG.FIRST_QUESTION && n <= TT_CONFIG.LAST_QUESTION) {
      logQuestionAnswerV2(submissionId, n, answers[q], payload.candidate.name);
    }
  });
  return finalizeTestResultsV2(submissionId, payload.score, payload.level, payload.anticheat || {}, payload.candidate.name);
}

/**
 * JSON API endpoint for GitHub Pages.
 * Supported actions: healthCheck, registerCandidate, logQuestionAnswer,
 * finalizeTestResults, submitPlacementResults.
 *
 * The client should use ONE stable submissionId for the entire attempt.
 */
function doPost(e) {
  const traceId = requestId_();
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Missing POST body.');
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const args = data.args || [];
    let result;

    if (action === 'healthCheck') result = healthCheck();
    else if (action === 'registerCandidate') result = registerCandidateV2(args[0], args[1]);
    else if (action === 'logQuestionAnswer') result = logQuestionAnswerV2(args[0], args[1], args[2], args[3]);
    else if (action === 'finalizeTestResults') result = finalizeTestResultsV2(args[0], args[1], args[2], args[3], args[4]);
    else if (action === 'submitPlacementResults') result = submitPlacementResultsV2(args[0]);
    else throw new Error('Unknown action: ' + action);

    return json_({ success:true, traceId:traceId, result:result });
  } catch (err) {
    console.error('API failure [' + traceId + ']: ' + (err.stack || err.message));
    return json_({ success:false, traceId:traceId, error:String(err.message || err) });
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.health === '1') return json_({ success:true, result:healthCheck() });
  return json_({
    success:true,
    service:'Talk Today SM Placement API',
    version:'2.0.0',
    note:'Use POST for API calls; add ?health=1 for spreadsheet health check.'
  });
}
