# GROK BUILD — COMPLETE HANDOFF

## Mission
Finish, harden, test, and prove the **Talk Today SM Placement Test production save path**. Do not redesign the test. Do not change pedagogical content. Do not overwrite or destroy historical results. The immediate objective is simple: **a student who finishes all 28 SM questions must reliably produce one complete, server-verified saved result, without freezes, duplicate rows, partial rows, or false “saved” messages.**

Repository: `jamalmorelli-dev/talk-today-sm-placement-test`
Default branch: `main`

## Source of truth
The production backend source of truth is **`Code.gs` (v3+)**.

`BACKEND_V2.gs` is retired and intentionally contains no executable backend functions. **Do not restore v2. Do not create duplicate `doGet` / `doPost` handlers.**

Primary files:
- `Code.gs` — production Apps Script backend
- `index.html` — production SM placement-test frontend
- `00_CONFIG.gs` — configuration
- `appsscript.json` — Apps Script manifest
- `.clasp.json` — Apps Script project mapping
- `.github/scripts/patch_sm_save.py` — proposed save-transport patch
- `.github/workflows/patch-sm-save.yml` — workflow intended to apply that patch
- `.github/workflows/inspect-sm.yml` — inspection workflow

## Existing production architecture that must be preserved
`Code.gs` is already designed around these invariants:

1. Historical rows are never cleared or reformatted.
2. `Placement Results` remains a stable **37-column** table.
3. Telemetry is stored separately so the results schema does not keep shifting.
4. The server recomputes score and level from saved answers.
5. Full-payload retries are intended to be idempotent.
6. Writes are lock-protected.
7. Errors are logged with trace IDs.

Current logical sheets:
- `Placement Results`
- `SM Submission Registry`
- `SM Telemetry`
- `SM Error Log`

Current SM question range:
- Q6 through Q33
- 28 total questions

Current score bands in production source:
- 0–6: `Below Pre-A1 (Starter)`
- 7–14: `Pre-A1 (Low)`
- 15–23: `Pre-A1 (Mid)`
- 24–28: `Pre-A1 (High)`

Do not silently alter the answer key or score bands.

## The failure mode to solve
The browser test is hosted separately from Google Apps Script, so normal cross-origin Apps Script POST behavior can be unreliable because Apps Script may redirect and browser CORS rules can prevent the frontend from reading a successful response. The current patch strategy correctly treats the write and the verification as separate concerns:

1. Submit the **entire completed test atomically** to Apps Script.
2. Do not depend on the POST response being readable.
3. Give every completed test a stable `submissionId`.
4. Verify the save independently through a GET/JSONP status route keyed by `submissionId`.
5. Only tell the student the test is safely saved after the backend registry confirms `SAVED`.
6. If verification fails temporarily, retain the complete payload in `localStorage` and expose an explicit retry mechanism.

This architecture is the target unless you find a demonstrably safer implementation that preserves the same guarantees.

## Existing patch you must inspect, not blindly trust
`.github/scripts/patch_sm_save.py` currently attempts to:

### Backend changes
- add `findRegistryBySubmissionId_()`
- add `submissionStatus_()`
- add a safe JSONP helper `jsonp_()`
- add a `doGet` status route using `status=1&submissionId=...`

### Frontend changes
- define the Apps Script API URL
- generate a stable `currentSubmissionId`
- save the completed payload in `localStorage`
- send a single full test payload using `fetch(..., {method:'POST', mode:'no-cors'})`
- poll the backend through JSONP for confirmation
- show `✓ Saved and verified` only after server confirmation
- keep failed/unverified payloads locally
- expose a `Retry save` action
- stop creating partial result rows during the test

Inspect every assumption. The patch is not authoritative merely because it exists.

## Critical workflow issue
The GitHub workflow `.github/workflows/patch-sm-save.yml` is configured to run only on pushes that modify **that workflow file itself**:

```yaml
on:
  push:
    paths:
      - '.github/workflows/patch-sm-save.yml'
```

That means normal pushes to the patch script or application files do not trigger it. Previous runs have also produced “no jobs were run” behavior. Treat CI as suspect until proven.

You must either:
- repair the workflow trigger so it can be intentionally executed and tested, preferably with `workflow_dispatch`, or
- bypass the workflow and apply/review the patch directly in a controlled branch/commit.

Do not rely on a workflow that never actually ran.

## Hard requirements

### A. Atomic save
A completed test must create **one complete result row**. No row-by-row question logging should be required for the production browser flow.

### B. Exactly 28 answers
The backend must reject finalization unless all 28 answers are present.

### C. Server-authoritative scoring
The browser score is advisory only. The backend must score against its own answer key and write the server score, percentage, and band.

### D. Idempotency
Reload, retry, double-click, transient network error, repeated POST, or verification retry must not create duplicate saved rows for the same completed payload.

Use the existing fingerprint/submission-registry mechanism or improve it without weakening deduplication.

### E. Verifiable persistence
Frontend success must mean **confirmed persisted backend state**, not merely “fetch returned” or “no exception was thrown.”

### F. Offline/transient recovery
Until verified, retain the completed payload locally. A browser refresh must not destroy an unconfirmed completed submission.

### G. No destructive migrations
Do not clear, truncate, recreate, reorder, or reformat historical result data. Do not change the stable 37-column `Placement Results` schema unless explicitly approved.

### H. Telemetry separation
Telemetry stays out of the core result schema. Preserve separate telemetry storage.

### I. Error evidence
Backend errors must remain traceable in `SM Error Log` with a trace ID. User-facing failure states must never silently swallow the save.

### J. Production-safe concurrency
Multiple students submitting simultaneously must not overwrite, cross-link, or corrupt one another. Locking should be as narrow as safely possible, but correctness beats micro-optimization.

## Security / integrity rules
- Never expose the answer key in client-side code.
- Never trust client score as authoritative.
- Validate candidate data server-side.
- Validate JSONP callback names before emitting JavaScript.
- Sanitize/limit stored strings.
- Do not introduce a public endpoint that can mutate arbitrary spreadsheet rows.
- Do not restore duplicate backend handlers from `BACKEND_V2.gs`.
- Do not commit secrets, tokens, credentials, or private keys.

## Candidate/result data that must survive the full save
At minimum preserve:
- timestamp
- full name
- WhatsApp number
- age
- test date
- correct answers
- total questions
- score percentage
- suggested CEFR/SM band
- every Q6–Q33 answer in the stable result columns

And separately where already supported:
- total duration
- tab/focus losses
- total audio plays
- audio play breakdown
- submission ID
- fingerprint
- result row
- save status
- client score
- server score
- score match
- answer count
- trace ID

## Phone/data normalization
Do not weaken existing Moroccan-number handling. Normalize common Moroccan `06` / `07` formats consistently while preserving enough original identity data for staff to trace the student.

## Test protocol — mandatory
Do not claim success from code inspection alone.

### 1. Static validation
Prove:
- only one active `doGet`
- only one active `doPost`
- no executable v2 backend remains
- 28-question server key exists only server-side
- `Placement Results` expected width remains 37 columns
- score bands match the current production specification

### 2. Backend unit-style checks
Test:
- 28/28 answers accepted
- 27/28 rejected
- malformed answer rejected/ignored appropriately
- correct server score calculated
- wrong client score does not override server score
- duplicate full payload resolves to the existing saved row
- same submission ID can be checked by status route
- invalid JSONP callback is rejected

### 3. Browser happy path
On desktop and mobile:
- enter candidate details
- answer all 28 questions
- finish test
- one atomic submission occurs
- UI displays “saving/verifying” state
- registry reaches `SAVED`
- UI displays verified success with receipt/result identifier
- exactly one result row exists
- all 28 answer columns are populated
- score matches server recomputation

### 4. Network-failure tests
Simulate at least:
- POST response unreadable because of CORS/redirect
- connection lost after pressing finish
- connection restored later
- status verification timeout
- page refresh while submission is still unverified

Required result: the completed payload survives locally and can eventually be retried/verified without duplicate rows.

### 5. Duplicate/retry tests
Simulate:
- double-click finish
- repeated POST of same payload
- explicit Retry Save
- browser refresh followed by retry

Required result: **one canonical saved result**.

### 6. Concurrency
Submit at least 3 distinct candidates in close succession. Confirm unique correct rows, correct names/answers, no cross-contamination, and no lock-timeout regression.

### 7. Regression
Confirm:
- all question rendering still works
- audio still works
- progression/navigation still works
- scoring display still works
- mobile layout still works
- no new console errors
- no loss of historical spreadsheet data

## Required evidence in your final report
Return all of the following, not a vague “fixed”:

1. Root cause(s) found.
2. Exact files changed.
3. Exact functions/blocks changed.
4. Commit SHA.
5. Apps Script Script ID used.
6. Deployment ID used.
7. Production `/exec` URL used.
8. Spreadsheet ID/URL used for verification (do not expose credentials).
9. Test matrix with pass/fail for every mandatory test above.
10. At least one verified saved submission ID.
11. Its result row number.
12. Server score and answer count.
13. Evidence that retry did not duplicate it.
14. Desktop result.
15. Mobile result.
16. Any remaining defect or uncertainty.

## Deployment discipline
First repair/test in source control. Do not casually deploy half-tested code.

Before production deployment:
1. diff all changes
2. inspect for accidental answer-key exposure
3. inspect for destructive spreadsheet logic
4. inspect for multiple `doGet` / `doPost` definitions
5. run tests
6. create a versioned Apps Script deployment/update
7. verify the actual production `/exec`
8. perform one real end-to-end test

Do not change the public production URL unless necessary. If an existing deployment can be safely updated, preserve its URL.

## Do not do these things
- Do not rebuild the application from scratch.
- Do not substitute Firebase/Supabase/a new database just because it is convenient.
- Do not change SM pedagogy, wording, question order, answer key, or bands without explicit approval.
- Do not create a second “temporary” results spreadsheet and leave production fragmented.
- Do not seed/copy fake permanent student records.
- Do not delete historical rows.
- Do not show “saved” before persistence is verified.
- Do not leave a retry capable of making duplicates.
- Do not treat a passing GitHub Action as proof of an Apps Script production deployment.

## Definition of done
This is done only when a real completed SM test can be submitted from the production browser UI, the backend independently confirms it is saved, all 28 answers and the server-derived score are present in the canonical spreadsheet row, a retry cannot duplicate it, and the same behavior is proven on desktop and mobile.

Anything less is not finished.
