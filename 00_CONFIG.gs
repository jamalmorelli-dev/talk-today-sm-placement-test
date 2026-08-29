/**
 * Production configuration guard for the SM placement backend.
 *
 * The backend historically depended on a manually-set Script Property named
 * SPREADSHEET_ID. That proved too fragile for production. This guard restores
 * the canonical results spreadsheet ID on every execution before request
 * handlers run, so a missing/deleted Script Property cannot break student saves.
 */

const TT_PRODUCTION_SPREADSHEET_ID = '1hYUy0fM5EmVNKB8uBbdjXzYt8PFjMR6xM9Gn_fAzVdM';

(function ensureProductionSpreadsheetProperty_() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('SPREADSHEET_ID') !== TT_PRODUCTION_SPREADSHEET_ID) {
      props.setProperty('SPREADSHEET_ID', TT_PRODUCTION_SPREADSHEET_ID);
    }
  } catch (err) {
    console.error('SM config guard failed: ' + (err && err.message ? err.message : err));
  }
})();
