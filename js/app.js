import { loadEntries, saveEntries } from "./storage-local.js";
import { entriesToCsv, parseCsv } from "./csv.js";
import { buildInsights } from "./insights.js";
import { connectOneDrive, getODDisplayName, initOneDrive, isODConnected, pullFromOneDrive, syncToOneDrive } from "./storage-onedrive.js";
import { connectGoogleDrive, getGDDisplayName, isGDConnected, pullFromGoogleDrive, reconnectGoogleDrive, syncToGoogleDrive } from "./storage-googledrive.js";
import { isoDate, normalizeYN, sortEntriesByDateDesc, toNumberOrNull, uid } from "./utils.js";
import { STORAGE_PREF_KEY } from "./constants.js";

const form = document.querySelector("#entry-form");
const clearButton = document.querySelector("#clear-form");
const body = document.querySelector("#entries-body");
const cardsEl = document.querySelector("#insights-cards");
const narrativeEl = document.querySelector("#insights-narrative");
const importInput = document.querySelector("#import-csv");
const statusEl = document.querySelector("#sync-status");
const formStatusEl = document.querySelector("#form-status");
const connectBtn = document.querySelector("#connect-onedrive");
const connectGDBtn = document.querySelector("#connect-googledrive");
const useLocalBtn = document.querySelector("#use-local");
const changeStorageBtn = document.querySelector("#change-storage");
const exportCsvBtn = document.querySelector("#export-csv");
const themeToggleBtn = document.querySelector("#theme-toggle");
const dateInput = form.elements.namedItem("date");
const dateWarningEl = document.querySelector("#date-warning");
const missingDaysWrap = document.querySelector("#missing-days-wrap");
const missingDaysEl = document.querySelector("#missing-days");
const sliderInputs = [...document.querySelectorAll("input[data-slider]")];

const sliderDefaults = {
  sleepQuality: "9",
  fatigue: "1",
  moodAwareness: "0",
  focus: "1",
  play: "1",
  connecting: "1",
  physical: "1",
  reflect: "1",
  down: "1",
  nutrition: "7"
};

let entries = loadEntries();
let editId = null;

// ── Theme toggle (default dark from HTML attribute) ────────────────────
/**
 * Applies the given colour theme to the document, updates the toggle button
 * label, and persists the preference to localStorage.
 * @param {'dark'|'light'} theme - The theme name to activate.
 */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "dark" ? "\u2600\ufe0f" : "\uD83C\uDF19";
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  themeToggleBtn.title = label;
  themeToggleBtn.setAttribute("aria-label", label);
  localStorage.setItem("ej-theme", theme);
}

// Restore saved preference; HTML default is already dark.
const savedTheme = localStorage.getItem("ej-theme");
if (savedTheme) {
  applyTheme(savedTheme);
} else {
  applyTheme("dark");
}

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

hydrateDateDefault();
hydrateSliderDefaults();
bindSliderUpdates();
refreshSliderDisplays();
bindDateDuplicateCheck();
renderAll();

// ── Storage management ────────────────────────────────────────────────────

function setStoragePref(pref) {
  localStorage.setItem(STORAGE_PREF_KEY, pref);
  document.documentElement.setAttribute("data-storage-pref", pref);
  document.documentElement.removeAttribute("data-storage-pending");
}

function setOneDriveConnectedUI() {
  const name = getODDisplayName();
  connectBtn.textContent = name ? `${name} — OneDrive` : "OneDrive connected";
  connectBtn.disabled = true;
}

function setGDConnectedUI() {
  const name = getGDDisplayName();
  connectGDBtn.textContent = name ? `${name} — Google Drive` : "Google Drive connected";
  connectGDBtn.disabled = true;
}

async function doOneDriveSync() {
  try {
    setStatus("Syncing with OneDrive…");
    const remote = await pullFromOneDrive();
    if (remote?.entries) {
      entries = mergeEntries(entries, remote.entries);
      saveEntries(entries);
      renderAll();
    }
    await syncToOneDrive({ json: { updatedAt: new Date().toISOString(), entries: sortEntriesByDateDesc(entries) } });
    setStatus("OneDrive synced.");
  } catch (err) {
    setStatus("Connected but sync failed: " + (err.message || "unknown error"), true);
  }
}

async function doGoogleDriveSync() {
  try {
    setStatus("Syncing with Google Drive…");
    const remote = await pullFromGoogleDrive();
    if (remote?.entries) {
      entries = mergeEntries(entries, remote.entries);
      saveEntries(entries);
      renderAll();
    }
    await syncToGoogleDrive({ json: { updatedAt: new Date().toISOString(), entries: sortEntriesByDateDesc(entries) } });
    setStatus("Google Drive synced.");
  } catch (err) {
    setStatus("Connected but sync failed: " + (err.message || "unknown error"), true);
  }
}

// Always run initOneDrive to process any MSAL redirect response.
initOneDrive().then(async (connected) => {
  const currentPref = localStorage.getItem(STORAGE_PREF_KEY);

  if (connected && !currentPref) {
    // Returning from first-time OneDrive login redirect.
    setStoragePref("onedrive");
    setOneDriveConnectedUI();
    await doOneDriveSync();
    return;
  }

  if (currentPref === "onedrive") {
    if (connected) {
      setOneDriveConnectedUI();
      await doOneDriveSync();
    } else {
      setStatus("OneDrive not connected — entries are saved locally.");
    }
    return;
  }

  if (currentPref === "googledrive") {
    const gdName = getGDDisplayName();
    connectGDBtn.textContent = gdName ? `Reconnect ${gdName}` : "Reconnect Google Drive";
    setStatus("Click ‘Reconnect Google Drive’ to sync your entries.");
    return;
  }

  if (currentPref === "local") {
    setStatus("Saving locally on this device.");
    return;
  }

  // No preference set — data-storage-pending keeps main hidden; all options visible.
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = readForm();
  if (!record.date) {
    setStatus("Date is required.", true);
    return;
  }
  if (!Number.isFinite(record.fatigue)) {
    setStatus("Fatigue must be a number.", true);
    return;
  }

  if (editId) {
    entries = entries.map((entry) => (entry.id === editId ? { ...entry, ...record, id: editId, updatedAt: new Date().toISOString() } : entry));
    // keep editId so further saves update the same entry
  } else {
    const newId = uid();
    entries.push({ ...record, id: newId, updatedAt: new Date().toISOString() });
    editId = newId; // lock subsequent saves to this entry
  }

  saveEntries(entries);
  renderAll();

  const activePref = localStorage.getItem(STORAGE_PREF_KEY);
  if (activePref === "onedrive" && isODConnected()) {
    try {
      formStatusEl.textContent = "Syncing…";
      formStatusEl.style.color = "var(--ink-soft)";
      await syncToOneDrive({ json: { updatedAt: new Date().toISOString(), entries: sortEntriesByDateDesc(entries) } });
      formStatusEl.textContent = "Saved & synced \u2713";
      formStatusEl.style.color = "var(--ok)";
      setStatus("Synced to OneDrive.");
    } catch (error) {
      formStatusEl.textContent = "Saved locally (sync failed)";
      formStatusEl.style.color = "var(--warn)";
      setStatus("OneDrive sync failed: " + (error.message || "unknown error"), true);
    }
  } else if (activePref === "googledrive" && isGDConnected()) {
    try {
      formStatusEl.textContent = "Syncing…";
      formStatusEl.style.color = "var(--ink-soft)";
      await syncToGoogleDrive({ json: { updatedAt: new Date().toISOString(), entries: sortEntriesByDateDesc(entries) } });
      formStatusEl.textContent = "Saved & synced \u2713";
      formStatusEl.style.color = "var(--ok)";
      setStatus("Synced to Google Drive.");
    } catch (error) {
      formStatusEl.textContent = "Saved locally (sync failed)";
      formStatusEl.style.color = "var(--warn)";
      setStatus("Google Drive sync failed: " + (error.message || "unknown error"), true);
    }
  } else {
    formStatusEl.textContent = "Saved locally \u2713";
    formStatusEl.style.color = "var(--ok)";
    setStatus("Entry saved locally.");
  }
  setTimeout(() => { formStatusEl.textContent = ""; }, 4000);
});

clearButton.addEventListener("click", () => {
  editId = null;
  form.reset();
  formStatusEl.textContent = "";
  hydrateDateDefault();
  hydrateSliderDefaults();
  refreshSliderDisplays();
});

importInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const text = await file.text();
  const imported = parseCsv(text);
  if (!imported.length) {
    setStatus("No rows imported from CSV.", true);
    return;
  }

  entries = mergeEntries(entries, imported);
  saveEntries(entries);
  renderAll();
  setStatus(`Imported ${imported.length} rows.`);
  importInput.value = "";
});

connectBtn.addEventListener("click", async () => {
  try {
    setStatus("Redirecting to Microsoft sign-in...");
    await connectOneDrive();
    // Page will navigate away — code below only runs if navigation is blocked.
  } catch (error) {
    setStatus(error.message || "OneDrive connection failed.", true);
  }
});

connectGDBtn.addEventListener("click", async () => {
  const currentPref = localStorage.getItem(STORAGE_PREF_KEY);
  const isReconnect = currentPref === "googledrive";
  connectGDBtn.disabled = true;
  connectGDBtn.textContent = "Connecting…";
  try {
    if (isReconnect) {
      await reconnectGoogleDrive();
    } else {
      await connectGoogleDrive();
      setStoragePref("googledrive");
    }
    setGDConnectedUI();
    await doGoogleDriveSync();
  } catch (err) {
    connectGDBtn.disabled = false;
    const gdName = getGDDisplayName();
    connectGDBtn.textContent = isReconnect
      ? (gdName ? `Reconnect ${gdName}` : "Reconnect Google Drive")
      : "Connect Google Drive";
    setStatus(err.message || "Google Drive connection failed.", true);
  }
});

useLocalBtn.addEventListener("click", () => {
  setStoragePref("local");
  setStatus("Saving locally on this device.");
});

changeStorageBtn.addEventListener("click", () => {
  if (confirm("Reset your storage choice? Your entries will remain on this device.")) {
    localStorage.removeItem(STORAGE_PREF_KEY);
    localStorage.removeItem("ej-gd-display");
    location.reload();
  }
});

exportCsvBtn.addEventListener("click", () => {
  const csv = entriesToCsv(sortEntriesByDateDesc(entries));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  link.download = `energy-journal-${localDate}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// Auto-set Physical (Exercise) slider from minutes exercised
const exerciseMinsInput = form.elements.namedItem("exerciseMins");
const physicalSlider = form.elements.namedItem("physical");
exerciseMinsInput.addEventListener("input", () => {
  const mins = parseFloat(exerciseMinsInput.value);
  if (!Number.isFinite(mins) || mins <= 0) return;
  physicalSlider.value = String(Math.min(10, Math.round(mins / 50 * 10)));
  refreshSliderDisplayFor({ target: physicalSlider });
});

document.querySelector("#deep-insights").addEventListener("click", () => {
  if (!entries.length) {
    setStatus("No entries to analyse yet.", true);
    return;
  }
  const sorted = sortEntriesByDateDesc(entries).slice(0, 21);
  const header = "Date\tFatigue\tSleep\tEx.Mins\tEx.Type\tNap\tMoodAwareness\tMood\tFocus\tPlaytime\tConnecting\tPhysical\tReflection\tDowntime\tNotes";
  const rows = sorted.map((e) => [
    e.date || "",
    e.fatigue ?? "",
    e.sleepQuality ?? "",
    e.exerciseMins ?? "",
    e.exerciseType || "",
    e.dayNap || "",
    e.moodAwareness ?? "",
    e.mood || "",
    e.focus ?? "",
    e.play ?? "",
    e.connecting ?? "",
    e.physical ?? "",
    e.reflect ?? "",
    e.down ?? "",
    e.notes || ""
  ].join("\t")).join("\n");

  const prompt = `You are a health and wellness analyst helping someone understand their energy and fatigue patterns. I am sharing personal daily journal data below. Please analyse it and provide practical, compassionate insights.

## About this journal
I track daily fatigue and lifestyle factors using the Healthy Mind Platter framework (adapted from Dr Dan Siegel and David Rock, 2012).

## Field descriptions
- **Fatigue** (0\u201310): 0\u202f= no fatigue, 10\u202f= extreme/debilitating fatigue
- **Sleep Quality** (0\u201310): 0\u202f= terrible, 10\u202f= excellent, refreshing sleep
- **Exercise mins**: Minutes of physical activity that day
- **Nap**: Daytime nap taken (Y/N)
- **Mood Awareness** (0\u201310): 0\u202f= no self-awareness, 10\u202f= fully present and aware of emotions
- **Mood**: Qualitative mood description
- **Focus time** (0\u201310): Goal-oriented focused task time
- **Playtime** (0\u201310): Spontaneous, creative, or playful activity
- **Connecting** (0\u201310): Time connecting with people or nature
- **Physical** (0\u201310): Aerobic body movement / exercise intensity
- **Reflection** (0\u201310): Mindful internal reflection
- **Downtime** (0\u201310): Non-focused rest, mind-wandering, relaxing
- **Notes**: Free text notes about the day

## My recent entries (newest first)
\`\`\`
${header}
${rows}
\`\`\`

## Please provide
1. **Key patterns**: What factors most strongly correlate with my fatigue levels?
2. **Healthy Mind Platter gaps**: Which areas do I consistently neglect, and how might that contribute to fatigue?
3. **Practical suggestions**: 3\u20135 specific, actionable improvements tailored to my actual data.
4. **What I am doing well**: Positive observations worth continuing.
5. **Red flags** (if any): Any patterns worth raising with a healthcare provider.

Be specific and reference actual data points. Keep your tone warm and practical, not clinical.`;

  navigator.clipboard.writeText(prompt).then(() => {
    setStatus("Prompt copied \u2014 paste it into Claude to get your insights.");
  }).catch(() => {
    setStatus("Could not auto-copy; please copy the prompt manually.", true);
  });
  window.open("https://claude.ai/new", "_blank", "noopener");
});

/**
 * Re-renders the full UI from the current entries array:
 * the history table, insights cards/narrative, and missing-days badges.
 */
function renderAll() {
  const sorted = sortEntriesByDateDesc(entries);
  renderEntries(sorted);
  renderInsights(sorted);
  renderMissingDays(sorted);
}

/**
 * Renders up to 60 entries into the history table.
 * Shows an empty-state row when there are no entries.
 * @param {object[]} sorted - Entries sorted newest-first.
 */
function renderEntries(sorted) {
  body.innerHTML = "";
  if (!sorted.length) {
    body.innerHTML = `<tr><td colspan="8">No entries yet. Add one above or import your CSV.</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of sorted.slice(0, 60)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${entry.date ? new Date(entry.date + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : ""}</td>
      <td>${safe(entry.fatigue)}</td>
      <td>${safe(entry.sleepQuality)}</td>
      <td>${safe(entry.exerciseMins)} ${safe(entry.exerciseType)}</td>
      <td>${safe(entry.mood)}</td>
      <td>${safe(entry.focus)}</td>
      <td>${safe(entry.notes)}</td>
      <td>
        <button class="btn-table" data-action="edit" data-id="${entry.id}" aria-label="Edit entry for ${safe(entry.date)}">Edit</button>
        <button class="btn-table" data-action="delete" data-id="${entry.id}" aria-label="Delete entry for ${safe(entry.date)}">Delete</button>
      </td>
    `;
    fragment.appendChild(tr);
  }
  body.appendChild(fragment);
}

body.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === "delete") {
    const target = entries.find((entry) => entry.id === id);
    const label = target?.date ? new Date(target.date + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : "this entry";
    if (!confirm(`Delete the entry for ${label}? This cannot be undone.`)) return;
    entries = entries.filter((entry) => entry.id !== id);
    saveEntries(entries);
    renderAll();
    setStatus("Entry deleted.");
    return;
  }

  if (action === "edit") {
    const found = entries.find((entry) => entry.id === id);
    if (!found) {
      return;
    }
    editId = id;
    writeForm(found);
    refreshSliderDisplays();
    setStatus("Editing entry. Save to update.");
  }
});

/**
 * Builds and renders insight cards and the narrative paragraph
 * from the provided sorted entry list.
 * @param {object[]} sorted - Entries sorted newest-first.
 */
function renderInsights(sorted) {
  const insights = buildInsights(sorted);
  cardsEl.innerHTML = "";
  for (const card of insights.cards) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<h3>${card.label}</h3><p>${card.value}</p>`;
    cardsEl.appendChild(div);
  }
  narrativeEl.innerHTML = insights.narrative;
}

/**
 * Reads and normalises all form field values into a plain entry object.
 * Numeric fields are coerced via toNumberOrNull; Y/N fields via normalizeYN;
 * date strings are normalised via isoDate.
 * @returns {object} Partial entry record ready to persist.
 */
function readForm() {
  const data = new FormData(form);
  return {
    date: isoDate(data.get("date")),
    sleepQuality: toNumberOrNull(data.get("sleepQuality")),
    fatigue: toNumberOrNull(data.get("fatigue")),
    exerciseMins: toNumberOrNull(data.get("exerciseMins")),
    exerciseType: String(data.get("exerciseType") || "").trim(),
    steps: toNumberOrNull(data.get("steps")),
    dayNap: normalizeYN(data.get("dayNap")),
    moodAwareness: toNumberOrNull(data.get("moodAwareness")),
    mood: String(data.get("mood") || "").trim(),
    focus: toNumberOrNull(data.get("focus")),
    play: toNumberOrNull(data.get("play")),
    connecting: toNumberOrNull(data.get("connecting")),
    physical: toNumberOrNull(data.get("physical")),
    reflect: toNumberOrNull(data.get("reflect")),
    down: toNumberOrNull(data.get("down")),
    nutrition: toNumberOrNull(data.get("nutrition")),
    notes: String(data.get("notes") || "").trim()
  };
}

/**
 * Populates every form field with values from the given entry object.
 * Fields not present in the form are silently skipped.
 * @param {object} entry - The entry record to write into the form.
 */
function writeForm(entry) {
  for (const [key, value] of Object.entries(entry)) {
    const el = form.elements.namedItem(key);
    if (!el) {
      continue;
    }
    el.value = value ?? "";
  }
}

/**
 * Merges two entry arrays, deduplicating by id and keeping whichever
 * copy has the more-recent updatedAt timestamp. Entries without an id
 * are assigned a temporary id derived from their date.
 * @param {object[]} base - Existing local entries.
 * @param {object[]} incoming - Entries to merge in (e.g. from CSV or OneDrive).
 * @returns {object[]} Merged array with no duplicate ids.
 */
function mergeEntries(base, incoming) {
  const byId = new Map();
  for (const item of [...base, ...incoming]) {
    const id = item.id || `${item.date}-${Math.random().toString(16).slice(2, 6)}`;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { ...item, id });
      continue;
    }
    const existingStamp = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const incomingStamp = item.updatedAt ? Date.parse(item.updatedAt) : 0;
    if (incomingStamp >= existingStamp) {
      byId.set(id, { ...existing, ...item, id });
    }
  }
  return [...byId.values()];
}

/**
 * Displays a status message in the sync-status bar.
 * @param {string} text - The message to display.
 * @param {boolean} [isError=false] - When true, styles the message as an error.
 */
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--warn)" : "var(--ok)";
}

/**
 * Pre-fills the date field with today's ISO date if it is currently empty.
 */
function hydrateDateDefault() {
  const dateInput = form.elements.namedItem("date");
  if (!dateInput.value) {
    const now = new Date();
    dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
}

/**
 * Resets all slider fields to their default values as defined in sliderDefaults.
 * Called after form reset so sliders show sensible starting positions.
 */
function hydrateSliderDefaults() {
  for (const [name, value] of Object.entries(sliderDefaults)) {
    const input = form.elements.namedItem(name);
    if (!input) {
      continue;
    }
    input.value = value;
  }
}

/**
 * Attaches 'input' event listeners to all range sliders so the
 * adjacent value badge updates in real time as the user drags.
 */
function bindSliderUpdates() {
  for (const slider of sliderInputs) {
    slider.addEventListener("input", refreshSliderDisplayFor);
    // On mobile, blur any focused text input when touching a slider so the
    // browser doesn't scroll back to the text field mid-drag.
    slider.addEventListener("touchstart", () => {
      const active = document.activeElement;
      if (active && active !== slider && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        active.blur();
      }
    }, { passive: true });
  }
}

/**
 * Triggers a display refresh for every slider on the page,
 * ensuring the value badges are in sync with the slider positions.
 */
function refreshSliderDisplays() {
  for (const slider of sliderInputs) {
    refreshSliderDisplayFor({ target: slider });
  }
}

/**
 * Updates the value badge next to a single slider element.
 * Called on 'input' events and when manually refreshing all sliders.
 * @param {{target: HTMLInputElement}} event - Input event or synthetic object with a target slider.
 */
function refreshSliderDisplayFor(event) {
  const slider = event.target;
  const valueTag = slider.closest(".slider-row")?.querySelector(".slider-value");
  if (valueTag) {
    valueTag.textContent = slider.value;
  }
}

/**
 * Safely converts a value to a string for use in table cell innerHTML,
 * returning an empty string for null or undefined.
 * @param {*} value - Any value to render.
 * @returns {string} The string representation, or '' for null/undefined.
 */
function safe(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Date duplicate check ─────────────────────────────────────────
/**
 * Checks if the given date has an existing entry. If so, loads that
 * entry into the form for editing and shows the inline warning.
 * Clears the warning for dates with no matching entry.
 * @param {string} chosenDate - ISO date string "YYYY-MM-DD" to check.
 */
function checkDateForExisting(chosenDate) {
  if (!chosenDate) {
    dateWarningEl.classList.remove("visible");
    return;
  }
  const existing = entries.find((e) => e.date === chosenDate);
  if (existing) {
    dateWarningEl.classList.add("visible");
    editId = existing.id;
    writeForm(existing);
    refreshSliderDisplays();
  } else {
    dateWarningEl.classList.remove("visible");
  }
}

/**
 * Wires a 'change' listener to the date field so that selecting a date
 * that already has an entry loads it into the form for editing.
 * Also performs the check immediately for the pre-filled date value
 * (e.g. today's date set by hydrateDateDefault on page load).
 */
function bindDateDuplicateCheck() {
  dateInput.addEventListener("change", () => {
    checkDateForExisting(dateInput.value);
  });
  // Run immediately so today's pre-filled date is checked on load.
  checkDateForExisting(dateInput.value);
}

// ── Missing days indicator (last 7 days) ─────────────────────────
/**
 * Computes the dates in the last 7 days that have no entry and renders
 * them as clickable orange badges above the history table. Clicking a
 * badge pre-fills the date field and scrolls to the form. The badge
 * strip is hidden when all 7 days have entries.
 * @param {object[]} sorted - Entries sorted newest-first, used to build the date set.
 */
function renderMissingDays(sorted) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const entryDates = new Set(sorted.map((e) => e.date));
  const missing = [];

  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!entryDates.has(iso)) {
      missing.push(iso);
    }
  }

  if (!missing.length) {
    missingDaysWrap.hidden = true;
    return;
  }

  missingDaysWrap.hidden = false;
  missingDaysEl.innerHTML = "";
  for (const iso of missing) {
    const badge = document.createElement("span");
    badge.className = "missing-badge";
    // Format as "Mon 28 Apr"
    const d = new Date(iso + "T00:00:00");
    badge.textContent = d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
    badge.title = iso;
    badge.addEventListener("click", () => {
      dateInput.value = iso;
      dateWarningEl.classList.remove("visible");
      editId = null;
      hydrateSliderDefaults();
      refreshSliderDisplays();
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    missingDaysEl.appendChild(badge);
  }
}
