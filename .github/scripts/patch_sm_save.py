from pathlib import Path

# Backend: JSONP status confirmation and score bands matching the test UI.
p = Path('Code.gs')
s = p.read_text()
s = s.replace("if (s <= 9) return 'Below Pre-A1 (Starter)';\n  if (s <= 16) return 'Pre-A1 (Low)';", "if (s <= 6) return 'Below Pre-A1 (Starter)';\n  if (s <= 14) return 'Pre-A1 (Low)';")

helper = r'''
function findRegistryBySubmissionId_(submissionId) {
  const id = safeString_(submissionId,100);
  if (!id) return null;
  const sh = ensureRegistry_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const values = sh.getRange(2,1,last-1,13).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][2]) === id) {
      return {
        found:true,
        submissionId:id,
        resultRow:Number(values[i][4]) || 0,
        status:String(values[i][5] || ''),
        serverScore:values[i][9] === '' ? null : Number(values[i][9]),
        answerCount:values[i][11] === '' ? null : Number(values[i][11]),
        traceId:String(values[i][12] || '')
      };
    }
  }
  return null;
}

function submissionStatus_(submissionId) {
  const hit = findRegistryBySubmissionId_(submissionId);
  if (!hit) return {found:false,saved:false,submissionId:safeString_(submissionId,100)};
  hit.saved = hit.status === 'SAVED';
  hit.receipt = hit.resultRow ? ('SM-' + hit.resultRow + '-CONFIRMED') : '';
  return hit;
}

function jsonp_(obj, callback) {
  const cb = String(callback || '').trim();
  if (!/^[A-Za-z_$][0-9A-Za-z_$.]*$/.test(cb)) {
    throw new Error('Invalid JSONP callback.');
  }
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

'''
if 'function findRegistryBySubmissionId_' not in s:
    marker = 'function doPost(e) {'
    assert marker in s, 'doPost marker missing'
    s = s.replace(marker, helper + marker, 1)

get_marker = 'function doGet(e) {\n'
status_route = r'''function doGet(e) {
  if (e && e.parameter && e.parameter.status === '1') {
    try {
      const result = submissionStatus_(e.parameter.submissionId || '');
      if (e.parameter.callback) return jsonp_({success:true,result:result}, e.parameter.callback);
      return json_({success:true,result:result});
    } catch (err) {
      const out = {success:false,error:String(err.message || err)};
      if (e.parameter.callback) return jsonp_(out, e.parameter.callback);
      return json_(out);
    }
  }
'''
if "e.parameter.status === '1'" not in s:
    assert get_marker in s, 'doGet marker missing'
    s = s.replace(get_marker, status_route, 1)
p.write_text(s)

# Frontend: a completed test is submitted atomically. POST is intentionally opaque;
# save confirmation is independently verified by JSONP, which avoids Apps Script's
# cross-origin redirect problem from GitHub Pages.
p = Path('index.html')
s = p.read_text(errors='strict')
s = s.replace(
    '<p style="text-align: center; color: var(--text-muted); margin-bottom: 25px;">Thank you for taking the SM Placement test. Your answers have been recorded.</p>',
    '<p id="completionMessage" style="text-align: center; color: var(--text-muted); margin-bottom: 25px;">Your test is complete. Confirming that your answers are safely saved…</p>'
)

state = '    let pendingAnswerQueue = [];'
if 'let currentSubmissionId = null;' not in s:
    assert state in s, 'state marker missing'
    s = s.replace(state, state + "\n    let currentSubmissionId = null;", 1)

bridge = r'''

    const SM_API_URL = "https://script.google.com/macros/s/AKfycbz8HTL75ZnXMjJeUEAYDl-FE3-2I8nVL2oVHrNRTUTXXd_HQl2X1K9mthze5uzyzsst/exec";
    const SM_PENDING_KEY = 'tt_sm_pending_submission_v1';

    function sleep_(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    function jsonpSubmissionStatus_(submissionId, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        const cb = '__ttSmStatus_' + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        let finished = false;
        let timer = null;
        const cleanup = () => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          try { delete window[cb]; } catch (_) { window[cb] = undefined; }
          script.remove();
        };
        window[cb] = data => { cleanup(); resolve(data); };
        script.onerror = () => { cleanup(); reject(new Error('Save confirmation unavailable')); };
        script.src = SM_API_URL + '?status=1&submissionId=' + encodeURIComponent(submissionId) + '&callback=' + encodeURIComponent(cb) + '&_=' + Date.now();
        timer = setTimeout(() => { cleanup(); reject(new Error('Save confirmation timed out')); }, timeoutMs);
        document.head.appendChild(script);
      });
    }

    async function saveCompletePayload(payload) {
      const statusEl = document.getElementById('saveStatus');
      const messageEl = document.getElementById('completionMessage');
      localStorage.setItem(SM_PENDING_KEY, JSON.stringify(payload));
      statusEl.innerHTML = '<span>Saving and verifying results…</span>';
      if (messageEl) messageEl.textContent = 'Your test is complete. Confirming that your answers are safely saved…';

      try {
        await fetch(SM_API_URL, {
          method: 'POST',
          mode: 'no-cors',
          cache: 'no-store',
          body: JSON.stringify({action:'submitPlacementResults', args:[payload]})
        });
      } catch (err) {
        console.warn('SM write transport error; confirmation polling determines actual save state.', err);
      }

      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          const reply = await jsonpSubmissionStatus_(payload.submissionId);
          const r = reply && reply.result;
          if (reply && reply.success && r && r.saved) {
            localStorage.removeItem(SM_PENDING_KEY);
            statusEl.innerHTML = '<span style="color: var(--success-color);">✓ Saved and verified' + (r.receipt ? ' · ' + r.receipt : '') + '</span>';
            if (messageEl) messageEl.textContent = 'Your answers have been recorded successfully.';
            return true;
          }
        } catch (_) {}
        await sleep_(1000 + attempt * 150);
      }

      statusEl.innerHTML = '<span style="color: var(--error-color);">⚠ Save not yet verified. Your completed test is kept safely on this device. <button type="button" onclick="retrySmSave()" style="margin-left:8px;padding:7px 12px;border-radius:8px;cursor:pointer;">Retry save</button></span>';
      if (messageEl) messageEl.textContent = 'Your test is complete and has been kept on this device until the server confirms the save.';
      return false;
    }

    window.retrySmSave = function() {
      try {
        const payload = JSON.parse(localStorage.getItem(SM_PENDING_KEY) || 'null');
        if (payload) saveCompletePayload(payload);
      } catch (err) {
        console.error('Could not recover pending SM submission', err);
      }
    };
'''
if 'function jsonpSubmissionStatus_' not in s:
    anchor = '      };\n\n    const IMAGES = '
    assert anchor in s, 'frontend wrapper anchor missing'
    s = s.replace(anchor, '      };' + bridge + '\n\n    const IMAGES = ', 1)

start = s.find('      // Asynchronously register candidate in the spreadsheet')
end_marker = '\n    }\n    \n    function renderQuestion()'
if start >= 0:
    end = s.find(end_marker, start)
    assert end >= 0, 'registration block end missing'
    replacement = "      // GitHub Pages: save one complete atomic record at the end; do not create partial rows.\n      candidateRowNumber = null;\n      pendingAnswerQueue = [];"
    s = s[:start] + replacement + s[end:]

payload_marker = '      const payload = {\n        candidate: candidateInfo,'
if 'submissionId: currentSubmissionId' not in s:
    assert payload_marker in s, 'payload marker missing'
    payload_repl = "      currentSubmissionId = currentSubmissionId || ('SMWEB-' + Date.now() + '-' + Math.random().toString(36).slice(2,10));\n      const payload = {\n        submissionId: currentSubmissionId,\n        candidate: candidateInfo,"
    s = s.replace(payload_marker, payload_repl, 1)

block_start = s.find('      if (candidateRowNumber === null) {\n        // Fallback: full registration & submission in one go')
if block_start >= 0:
    function_end = s.find('\n    }\n  </script>', block_start)
    assert function_end >= 0, 'completion save block end missing'
    s = s[:block_start] + '      saveCompletePayload(payload);' + s[function_end:]

p.write_text(s)
