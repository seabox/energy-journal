# Energy Journal (Static Web App)

A simple, beautiful static site to track daily energy/fatigue data, surface local fatigue insights, and sync to OneDrive.

## Features
- Daily form with your journal fields.
- Local-first storage in browser.
- CSV import and CSV export.
- Fatigue insights cards and short narrative summaries based on recent entries.
- OneDrive sync to app folder in two formats:
  - `energy-journal.json`
  - `energy-journal.csv`

## Run locally
Open `index.html` with a static server (recommended):

```powershell
cd c:\git\energy-journal\energy-journal
python -m http.server 8080
```

Then open `http://localhost:8080`.

## OneDrive setup (consumer account)
1. Go to Azure App Registrations and create a new app.
1. Supported account types: personal Microsoft accounts only.
1. Add a SPA redirect URI:
   - Local dev: `http://localhost:8080/`
   - GitHub Pages: `https://<your-user>.github.io/<repo>/`
1. Grant Microsoft Graph delegated permission: `Files.ReadWrite.AppFolder`.
1. Copy Application (client) ID.
1. Update `js/config.js` and set `clientId`.

## Deploy to GitHub Pages
1. Push repository to GitHub.
1. Enable Pages from `main` branch root.
1. Ensure `redirectUri` in `js/config.js` matches the Pages URL.
1. Re-open the site and connect OneDrive.

## Notes
- Insights are heuristic, local, and intentionally explainable (no external AI API).
- If OneDrive is not configured yet, all local features still work.
