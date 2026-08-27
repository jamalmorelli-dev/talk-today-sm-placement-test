/**
 * Talk Today — SM Placement Test Production Backend v3
 *
 * Design goals:
 * - NEVER clear or reformat historical results.
 * - Placement Results remains a stable 37-column results table.
 * - Telemetry is stored separately so schema never shifts again.
 * - Server recomputes score/level from saved answers.
 * - Retries are idempotent when a full payload is submitted.
 * - All writes are locked and errors are logged with trace IDs.
 */

const TT = Object.freeze({
  VERSION: '3.0.0',
  SPREADSHEET_PROPERTY: 'SPREADSHEET_ID',
  RESULTS_SHEET: 'Placement Results',
  REGISTRY_SHEET: 'SM Submission Registry',
  TELEMETRY_SHEET: 'SM Telemetry',
  ERROR_SHEET: 'SM Error Log',
  FIRST_Q: 6,
  LAST_Q: 33,
  TOTAL: 28,
  LOCK_MS: 20000
});

const TT_KEY = Object.freeze({
  6:'B',7:'A',8:'C',9:'C',10:'A',11:'B',12:'C',13:'A',14:'B',
  15:'C',16:'B',17:'B',18:'A',19:'B',20:'A',21:'C',22:'A',23:'C',
  24:'B',25:'B',26:'B',27:'C',28:'A',29:'B',30:'A',31:'A',32:'C',33:'A'
});

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function trace_() {
  return Utilities.getUuid();
}

function norm_(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase();
}

function safeString_(v, maxLen) {
  const s = String(v == null ? '' : v).trim();
  return s.substring(0, maxLen || 500);
}

function openSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(TT.SPREADSHEET_PROPERTY);
  if (!id) throw new Error('Missing SPREADSHEET_ID script property.');
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error('Cannot open configured spreadsheet: ' + err.message);
  }
}

function expectedResultsHeaders_() {
  const h = [
    'Timestamp','Full Name','WhatsApp Number','Age','Test Date',
    'Correct Answers','Total Questions','Score Percentage','Suggested CEFR Level'
  ];
  for (let q = TT.FIRST_Q; q <= TT.LAST_Q; q++) {
    h.push('Q' + q + ' (Correct: ' + TT_KEY[q] + ')');
  }
  return h;
}

function ensureResultsSheet_() {
  const ss = openSpreadsheet_();
  let sh = ss.getSheetByName(TT.RESULTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TT.RESULTS_SHEET);
    sh.getRange(1, 1, 1, expectedResultsHeaders_().length)
      .setValues([expectedResultsHeaders_()])
      .setFontWeight('bold');
  }
  if (sh.getMaxColumns() < 37) {
    sh.insertColumnsAfter(sh.getMaxColumns(), 37 - sh.getMaxColumns());
  }
  return sh;
}

function ensureRegistry_() {
  const ss = openSpreadsheet_();
  let sh = ss.getSheetByName(TT.REGISTRY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TT.REGISTRY_SHEET);
    sh.appendRow([
      'Created At','Updated At','Submission ID','Fingerprint','Result Row',
      'Status','Candidate Name','Phone','Client Score','Server Score',
      'Score Match','Answer Count','Trace ID'
    ]);
    sh.getRange(1,1,1,13).setFontWeight('bold');
  }
  return sh;
}

function ensureTelemetry_() {
  const ss = openSpreadsheet_();
  let sh = ss.getSheetByName(TT.TELEMETRY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TT.TELEMETRY_SHEET);
    sh.appendRow([
      'Timestamp','Result Row','Candidate Name','Submission ID',
      'Total Duration (s)','Tab Focus Losses','Total Audio Plays',
      'Audio Plays Breakdown'
    ]);
    sh.getRange(1,1,1,8).setFontWeight('bold');
  }
  return sh;
}

function ensureErrorLog_() {
  const ss = openSpreadsheet_();
  let sh = ss.getSheetByName(TT.ERROR_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TT.ERROR_SHEET);
    sh.appendRow(['Timestamp','Trace ID','Action','Message','Stack']);
    sh.getRange(1,1,1,5).setFontWeight('bold');
  }
  return sh;
}

function logError_(traceId, action, err) {
  try {
    ensureErrorLog_().appendRow([
      new Date(), traceId, safeString_(action,100),
      safeString_(err && err.message ? err.message : err,1000),
      safeString_(err && err.stack ? err.stack : '',5000)
    ]);
  } catch (_) {}
}

function validateCandidate_(candidate) {
  if (!candidate || !safeString_(candidate.name,200)) {
    throw new Error('Candidate name is required.');
  }
  const age = candidate.age;
  if (age !== '' && age != null && (isNaN(Number(age)) || Number(age) < 3 || Number(age) > 100)) {
    throw new Error('Candidate age is invalid.');
  }
  return {
    name: safeString_(candidate.name,200),
    phone: safeString_(candidate.phone,80),
    age: age == null ? '' : age,
    date: safeString_(candidate.date,40)
  };
}

function validAnswer_(a) {
  const v = String(a || '').toUpperCase();
  return ['A','B','C'].indexOf(v) >= 0 ? v : '';
}

function formatAnswer_(q, answer) {
  const a = validAnswer_(answer);
  if (!a) return 'Unanswered';
  return a === TT_KEY[q]
    ? a + ' (Correct)'
    : a + ' (Incorrect, Correct: ' + TT_KEY[q] + ')';
}

function parseStoredAnswer_(cell) {
  const s = String(cell || '');
  const m = s.match(/^([ABC])\s/);
  return m ? m[1] : '';
}

function answersFromRow_(sh, row) {
  const values = sh.getRange(row, 10, 1, TT.TOTAL).getDisplayValues()[0];
  const answers = {};
  for (let i = 0; i < TT.TOTAL; i++) {
    answers[TT.FIRST_Q + i] = parseStoredAnswer_(values[i]);
  }
  return answers;
}

function scoreAnswers_(answers) {
  let score = 0;
  let answered = 0;
  for (let q = TT.FIRST_Q; q <= TT.LAST_Q; q++) {
    const a = validAnswer_(answers && answers[q]);
    if (a) {
      answered++;
      if (a === TT_KEY[q]) score++;
    }
  }
  return {score: score, answered: answered};
}

function levelFromScore_(score) {
  const s = Number(score) || 0;
  if (s <= 9) return 'Below Pre-A1 (Starter)';
  if (s <= 16) return 'Pre-A1 (Low)';
  if (s <= 23) return 'Pre-A1 (Mid)';
  return 'Pre-A1 (High)';
}

function percentage_(score) {
  return ((Number(score) / TT.TOTAL) * 100).toFixed(1) + '%';
}

function fingerprint_(candidate, answers) {
  const c = validateCandidate_(candidate);
  let material = [
    norm_(c.name), norm_(c.phone), String(c.age || ''), String(c.date || '')
  ];
  for (let q = TT.FIRST_Q; q <= TT.LAST_Q; q++) {
    material.push(validAnswer_(answers && answers[q]));
  }
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    material.join('|'),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function findRegistryByFingerprint_(fingerprint) {
  const sh = ensureRegistry_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const values = sh.getRange(2,1,last-1,13).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][3]) === String(fingerprint) && String(values[i][5]) === 'SAVED') {
      return {
        registryRow: i + 2,
        submissionId: String(values[i][2]),
        resultRow: Number(values[i][4]) || 0,
        serverScore: Number(values[i][9]) || 0
      };
    }
  }
  return null;
}

function writeRegistry_(obj) {
  const sh = ensureRegistry_();
  sh.appendRow([
    obj.createdAt || new Date(),
    new Date(),
    obj.submissionId || '',
    obj.fingerprint || '',
    obj.resultRow || '',
    obj.status || '',
    obj.name || '',
    obj.phone || '',
    obj.clientScore === '' ? '' : obj.clientScore,
    obj.serverScore === '' ? '' : obj.serverScore,
    obj.scoreMatch == null ? '' : obj.scoreMatch,
    obj.answerCount == null ? '' : obj.answerCount,
    obj.traceId || ''
  ]);
}

function writeTelemetry_(rowNumber, name, submissionId, anticheat) {
  anticheat = anticheat || {};
  ensureTelemetry_().appendRow([
    new Date(),
    rowNumber,
    safeString_(name,200),
    submissionId || '',
    Number(anticheat.totalDurationSec) || 0,
    Number(anticheat.focusLossCount) || 0,
    Number(anticheat.totalAudioPlays) || 0,
    safeString_(anticheat.playCountsBreakdown,5000)
  ]);
}

function registerCandidate(candidate) {
  const c = validateCandidate_(candidate);
  const lock = LockService.getScriptLock();
  lock.waitLock(TT.LOCK_MS);
  try {
    const sh = ensureResultsSheet_();
    const row = [
      new Date(), c.name, c.phone, c.age, c.date,
      '', '', '', 'In Progress...'
    ];
    for (let q = TT.FIRST_Q; q <= TT.LAST_Q; q++) row.push('');
    sh.appendRow(row);
    SpreadsheetApp.flush();
    return sh.getLastRow();
  } finally {
    lock.releaseLock();
  }
}

function logQuestionAnswer(rowNumber, questionNum, answer, securityName) {
  const row = Number(rowNumber);
  const q = Number(questionNum);
  if (!Number.isInteger(row) || row < 2) throw new Error('Invalid result row.');
  if (!Number.isInteger(q) || q < TT.FIRST_Q || q > TT.LAST_Q) {
    throw new Error('Invalid question number.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(TT.LOCK_MS);
  try {
    const sh = ensureResultsSheet_();
    if (row > sh.getLastRow()) throw new Error('Result row does not exist.');
    const storedName = sh.getRange(row,2).getDisplayValue();
    if (norm_(storedName) !== norm_(securityName)) {
      throw new Error('Security verification failed.');
    }
    sh.getRange(row, 10 + (q - TT.FIRST_Q)).setValue(formatAnswer_(q, answer));
    return {success:true,rowNumber:row,question:q};
  } finally {
    lock.releaseLock();
  }
}

function finalizeTestResults(rowNumber, clientScore, clientLevel, anticheat, securityName) {
  const traceId = trace_();
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 2) throw new Error('Invalid result row.');

  const lock = LockService.getScriptLock();
  lock.waitLock(TT.LOCK_MS);
  try {
    const sh = ensureResultsSheet_();
    if (row > sh.getLastRow()) throw new Error('Result row does not exist.');
    const storedName = sh.getRange(row,2).getDisplayValue();
    if (norm_(storedName) !== norm_(securityName)) {
      throw new Error('Security verification failed on finalize.');
    }

    const answers = answersFromRow_(sh,row);
    const audit = scoreAnswers_(answers);
    const serverScore = audit.score;
    const level = levelFromScore_(serverScore);

    sh.getRange(row,6,1,4).setValues([[
      serverScore,
      TT.TOTAL,
      percentage_(serverScore),
      level
    ]]);
    writeTelemetry_(row,storedName,'',anticheat);

    writeRegistry_({
      submissionId:'',
      fingerprint:'',
      resultRow:row,
      status:audit.answered === TT.TOTAL ? 'SAVED' : 'SAVED_INCOMPLETE',
      name:storedName,
      phone:sh.getRange(row,3).getDisplayValue(),
      clientScore:Number(clientScore),
      serverScore:serverScore,
      scoreMatch:Number(clientScore) === serverScore,
      answerCount:audit.answered,
      traceId:traceId
    });

    SpreadsheetApp.flush();
    return {
      success:true,
      saved:true,
      rowNumber:row,
      serverScore:serverScore,
      clientScore:Number(clientScore),
      scoreCorrected:Number(clientScore) !== serverScore,
      total:TT.TOTAL,
      answered:audit.answered,
      percentage:percentage_(serverScore),
      level:level,
      receipt:'SM-' + row + '-' + traceId.substring(0,8)
    };
  } finally {
    lock.releaseLock();
  }
}

function submitPlacementResults(payload) {
  if (!payload || !payload.candidate) throw new Error('Invalid payload.');
  const c = validateCandidate_(payload.candidate);
  const answers = payload.answers || {};
  const audit = scoreAnswers_(answers);
  if (audit.answered !== TT.TOTAL) {
    throw new Error('Cannot finalize: expected 28 answers, received ' + audit.answered + '.');
  }

  const fingerprint = fingerprint_(c,answers);
  const traceId = trace_();
  const lock = LockService.getScriptLock();
  lock.waitLock(TT.LOCK_MS);
  try {
    const existing = findRegistryByFingerprint_(fingerprint);
    if (existing && existing.resultRow) {
      return {
        success:true,
        saved:true,
        duplicate:true,
        rowNumber:existing.resultRow,
        serverScore:existing.serverScore,
        receipt:'SM-' + existing.resultRow + '-REPLAY'
      };
    }

    const sh = ensureResultsSheet_();
    const serverScore = audit.score;
    const level = levelFromScore_(serverScore);
    const row = [
      new Date(), c.name, c.phone, c.age, c.date,
      serverScore, TT.TOTAL, percentage_(serverScore), level
    ];
    for (let q = TT.FIRST_Q; q <= TT.LAST_Q; q++) {
      row.push(formatAnswer_(q,answers[q]));
    }
    sh.appendRow(row);
    const resultRow = sh.getLastRow();
    const submissionId = safeString_(payload.submissionId,100) || trace_();

    writeTelemetry_(resultRow,c.name,submissionId,payload.anticheat || {});
    writeRegistry_({
      submissionId:submissionId,
      fingerprint:fingerprint,
      resultRow:resultRow,
      status:'SAVED',
      name:c.name,
      phone:c.phone,
      clientScore:Number(payload.score),
      serverScore:serverScore,
      scoreMatch:Number(payload.score) === serverScore,
      answerCount:audit.answered,
      traceId:traceId
    });

    SpreadsheetApp.flush();
    return {
      success:true,
      saved:true,
      duplicate:false,
      submissionId:submissionId,
      rowNumber:resultRow,
      serverScore:serverScore,
      clientScore:Number(payload.score),
      scoreCorrected:Number(payload.score) !== serverScore,
      total:TT.TOTAL,
      percentage:percentage_(serverScore),
      level:level,
      receipt:'SM-' + resultRow + '-' + traceId.substring(0,8)
    };
  } finally {
    lock.releaseLock();
  }
}

function healthCheck() {
  const ss = openSpreadsheet_();
  const sh = ensureResultsSheet_();
  const expected = expectedResultsHeaders_();
  const actual = sh.getRange(1,1,1,37).getDisplayValues()[0];
  let headerMismatch = [];
  for (let i = 0; i < 37; i++) {
    if (String(actual[i]) !== String(expected[i])) {
      headerMismatch.push({column:i+1,expected:expected[i],actual:actual[i]});
    }
  }
  return {
    ok: headerMismatch.length === 0,
    version: TT.VERSION,
    spreadsheetId:ss.getId(),
    spreadsheetName:ss.getName(),
    resultsSheet:sh.getName(),
    rows:sh.getLastRow(),
    expectedColumns:37,
    maxColumns:sh.getMaxColumns(),
    headerMismatch:headerMismatch,
    timestamp:new Date().toISOString()
  };
}

function doPost(e) {
  const traceId = trace_();
  let action = 'unknown';
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Missing POST body.');
    const data = JSON.parse(e.postData.contents);
    action = safeString_(data.action,100);
    const args = data.args || [];
    let result;

    if (action === 'registerCandidate') result = registerCandidate(args[0]);
    else if (action === 'logQuestionAnswer') result = logQuestionAnswer(args[0],args[1],args[2],args[3]);
    else if (action === 'finalizeTestResults') result = finalizeTestResults(args[0],args[1],args[2],args[3],args[4]);
    else if (action === 'submitPlacementResults') result = submitPlacementResults(args[0]);
    else if (action === 'healthCheck') result = healthCheck();
    else throw new Error('Unknown action: ' + action);

    return json_({success:true,traceId:traceId,result:result});
  } catch (err) {
    logError_(traceId,action,err);
    console.error('SM API failure [' + traceId + '] ' + (err.stack || err.message));
    return json_({success:false,traceId:traceId,error:String(err.message || err)});
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.health === '1') {
    try {
      return json_({success:true,result:healthCheck()});
    } catch (err) {
      return json_({success:false,error:String(err.message || err)});
    }
  }

  try {
    let template;
    try {
      template = HtmlService.createTemplateFromFile('Index');
    } catch (_) {
      template = HtmlService.createTemplateFromFile('index');
    }
    return template.evaluate()
      .setTitle('Talk Today — SM Placement Test')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport','width=device-width, initial-scale=1');
  } catch (_) {
    return json_({
      success:true,
      service:'Talk Today SM Placement API',
      version:TT.VERSION,
      note:'Use POST for API calls or ?health=1 for diagnostics.'
    });
  }
}
