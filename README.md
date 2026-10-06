# Energy Journal (Static Web App)

A simple, beautiful static site to track daily energy/fatigue data, surface local fatigue insights, and sync to OneDrive.

## Features
- Daily form with your journal fields.
- Local-first storage in browser.
- CSV import and CSV export.
- Fatigue insights cards and short narrative summaries based on recent entries.
- OneDrive and Google Drive sync of `energy-journal.json` to their app folders.
- Cutoff-date archiving to timestamped JSON and CSV cloud files.
- Recent Entries shows today and the previous nine local calendar days. This is a display filter, not deletion: older entries remain in storage, exports, archives, and insights, and can be edited by selecting their date.
- Reflection is a Y/N control (Yes = numeric `10`, No = numeric `0`). Existing positive scores display as Yes when editing; historical values are only converted when saved. New entries default to No.
- Mood and Mood Awareness are no longer shown in the form, history, or generated AI prompt. Existing values are preserved when editing and remain supported in JSON and CSV import/export.

## Archive older entries
1. Save any changes in the daily-entry form, then connect or reconnect your cloud storage.
1. Click **Archive** beside **Import CSV** and **Export CSV** in Recent Entries.
1. Choose a cutoff date. Only entries **before** that date are archived; entries on or after it stay active.
1. Review the count and confirm. The app checks cloud entries as well as this device's entries.

The app creates uniquely named `energy-journal-archive-<timestamp>-<unique-id>.json` and `.csv` files in the selected provider's app folder. Both uploads must succeed before the active cloud journal is trimmed, and the local journal is trimmed only after that cloud update succeeds. Keep the page open until it finishes. Errors leave local entries in place; partial archive files can remain if an upload fails. If the final cloud update fails, reconnect to check its state before retrying.

CSV exports and archives prefix formula-like text cells with an apostrophe so spreadsheets treat them as text. Numeric cells are unchanged. Importing these CSVs preserves the protective apostrophe; JSON archives retain the original text unchanged.

Archive requires a connected cloud provider; local-only mode is not supported. Archiving never removes undated or malformed-date entries. Archived entries no longer appear in history, insights, or regular CSV exports. Archive IDs remain in the active journal so older local copies do not reintroduce them during sync. Reload the app on other devices before syncing so they use this archive-aware version. Avoid editing the same cloud journal simultaneously on multiple devices; sync is not a cross-device transaction.

OneDrive archives are in the app folder. Google Drive archives are in its private `appDataFolder`, which is not visible in the Drive UI. There is currently no in-app archive browser or restore action. If you want an easily accessible local copy, use **Export CSV** before archiving. A downloaded archive CSV can be imported to deliberately restore its entries as new records.

## Tests
Run `npm test` for archive ordering, failure safety, cutoff boundaries, local migration, sync reconciliation, and mocked cloud-provider tests. These tests use Node's built-in test runner and do not connect to cloud accounts.

## Run locally
Open `index.html` with a static server (recommended):

```powershell
cd c:\git\energy-journal\energy-journal
npm install
python -m http.server 8080
```

Then open `http://localhost:8080`.

## OneDrive setup (consumer account)
1. Go to Azure App Registrations and create a new app.
1. Supported account types: personal Microsoft accounts only.
1. Add a SPA redirect URI for the app page:
  - Local dev: `http://localhost:8080/`
  - GitHub Pages: `https://<your-user>.github.io/<repo>/`
1. Grant Microsoft Graph delegated permission: `Files.ReadWrite.AppFolder`.
1. Copy Application (client) ID.
1. Update `js/config.js` and set `clientId`.

## Deploy to GitHub Pages
1. Push repository to GitHub.
1. Enable Pages from `main` branch root.
1. Ensure the Pages redirect URI is registered in Azure: `https://<your-user>.github.io/<repo>/`.
1. Re-open the site and connect OneDrive.

## Notes
- Insights are heuristic, local, and intentionally explainable (no external AI API).
- If OneDrive is not configured yet, all local features still work.
- OneDrive sign-in uses a full-page redirect to Microsoft login, then returns to the app automatically.
- MSAL is installed with npm and copied to `js/vendor/msal-browser.min.js`.
- After upgrading dependencies, run `npm run vendor:msal` to refresh the local MSAL file.

## MSAL event logging (for auth troubleshooting)
1. Open browser devtools Console on the app page.
1. Click Connect OneDrive and reproduce the issue.
1. Run:

```js
window.__energyJournalMsalLog
```

1. Copy the last 20-40 log entries and share them.

The app now logs MSAL logger output and event callbacks to this in-memory array and to the console (`[MSAL]`, `[MSAL EVENT]`).
