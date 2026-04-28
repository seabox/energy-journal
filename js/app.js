import { loadEntries, saveEntries } from "./storage-local.js";
import { entriesToCsv, parseCsv } from "./csv.js";
import { buildInsights } from "./insights.js";
import { connectOneDrive, isConnected, pullFromOneDrive, syncToOneDrive } from "./onedrive.js";
import { isoDate, normalizeYN, sortEntriesByDateDesc, toNumberOrNull, uid } from "./utils.js";

const form = document.querySelector("#entry-form");
const clearButton = document.querySelector("#clear-form");
const body = document.querySelector("#entries-body");
const cardsEl = document.querySelector("#insights-cards");
const narrativeEl = document.querySelector("#insights-narrative");
const importInput = document.querySelector("#import-csv");
const statusEl = document.querySelector("#sync-status");
const connectBtn = document.querySelector("#connect-onedrive");
const syncBtn = document.querySelector("#sync-now");
const exportCsvBtn = document.querySelector("#export-csv");
const sliderInputs = [...document.querySelectorAll("input[data-slider]")];

const sliderDefaults = {
  sleepQuality: "9",
  fatigue: "1",
  focus: "1",
  play: "1",
  connecting: "1",
  physical: "1",
  reflect: "1",
  down: "1"
};

let entries = loadEntries();
let editId = null;

hydrateDateDefault();
hydrateSliderDefaults();
bindSliderUpdates();
refreshSliderDisplays();
renderAll();
refreshSyncState();

form.addEventListener("submit", (event) => {
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
    editId = null;
  } else {
    entries.push({ ...record, id: uid(), updatedAt: new Date().toISOString() });
  }

  saveEntries(entries);
  form.reset();
  hydrateDateDefault();
  hydrateSliderDefaults();
  refreshSliderDisplays();
  renderAll();
  setStatus("Entry saved locally.");
});

clearButton.addEventListener("click", () => {
  editId = null;
  form.reset();
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
    await connectOneDrive();
    refreshSyncState();
    setStatus("Connected to OneDrive.");
  } catch (error) {
    setStatus(error.message || "OneDrive connection failed.", true);
  }
});

syncBtn.addEventListener("click", async () => {
  if (!isConnected()) {
    setStatus("Connect OneDrive first.", true);
    return;
  }
  try {
    const remote = await pullFromOneDrive();
    if (remote?.entries) {
      entries = mergeEntries(entries, remote.entries);
      saveEntries(entries);
    }
    const sorted = sortEntriesByDateDesc(entries);
    await syncToOneDrive({
      json: { updatedAt: new Date().toISOString(), entries: sorted },
      csv: entriesToCsv(sorted)
    });
    setStatus("Synced JSON + CSV to OneDrive app folder.");
    renderAll();
  } catch (error) {
    setStatus(error.message || "Sync failed.", true);
  }
});

exportCsvBtn.addEventListener("click", () => {
  const csv = entriesToCsv(sortEntriesByDateDesc(entries));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `energy-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

function renderAll() {
  const sorted = sortEntriesByDateDesc(entries);
  renderEntries(sorted);
  renderInsights(sorted);
}

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
      <td>${entry.date || ""}</td>
      <td>${safe(entry.fatigue)}</td>
      <td>${safe(entry.sleepQuality)}</td>
      <td>${safe(entry.exerciseMins)} ${safe(entry.exerciseType)}</td>
      <td>${safe(entry.mood)}</td>
      <td>${safe(entry.focus)}</td>
      <td>${safe(entry.notes)}</td>
      <td>
        <button class="small-btn" data-action="edit" data-id="${entry.id}">Edit</button>
        <button class="small-btn" data-action="delete" data-id="${entry.id}">Delete</button>
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

function renderInsights(sorted) {
  const insights = buildInsights(sorted);
  cardsEl.innerHTML = "";
  for (const card of insights.cards) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<h3>${card.label}</h3><p>${card.value}</p>`;
    cardsEl.appendChild(div);
  }
  narrativeEl.textContent = insights.narrative;
}

function readForm() {
  const data = new FormData(form);
  return {
    date: isoDate(data.get("date")),
    sleepQuality: toNumberOrNull(data.get("sleepQuality")),
    fatigue: toNumberOrNull(data.get("fatigue")),
    exerciseMins: toNumberOrNull(data.get("exerciseMins")),
    exerciseType: String(data.get("exerciseType") || "").trim(),
    dayNap: normalizeYN(data.get("dayNap")),
    moodAwareness: String(data.get("moodAwareness") || "").trim(),
    mood: String(data.get("mood") || "").trim(),
    focus: toNumberOrNull(data.get("focus")),
    play: toNumberOrNull(data.get("play")),
    connecting: toNumberOrNull(data.get("connecting")),
    physical: toNumberOrNull(data.get("physical")),
    reflect: toNumberOrNull(data.get("reflect")),
    down: toNumberOrNull(data.get("down")),
    notes: String(data.get("notes") || "").trim()
  };
}

function writeForm(entry) {
  for (const [key, value] of Object.entries(entry)) {
    const el = form.elements.namedItem(key);
    if (!el) {
      continue;
    }
    el.value = value ?? "";
  }
}

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

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#9a3f12" : "#1f5f53";
}

function refreshSyncState() {
  syncBtn.disabled = !isConnected();
}

function hydrateDateDefault() {
  const dateInput = form.elements.namedItem("date");
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

function hydrateSliderDefaults() {
  for (const [name, value] of Object.entries(sliderDefaults)) {
    const input = form.elements.namedItem(name);
    if (!input) {
      continue;
    }
    input.value = value;
  }
}

function bindSliderUpdates() {
  for (const slider of sliderInputs) {
    slider.addEventListener("input", refreshSliderDisplayFor);
  }
}

function refreshSliderDisplays() {
  for (const slider of sliderInputs) {
    refreshSliderDisplayFor({ target: slider });
  }
}

function refreshSliderDisplayFor(event) {
  const slider = event.target;
  const valueTag = slider.closest(".slider-row")?.querySelector(".slider-value");
  if (valueTag) {
    valueTag.textContent = slider.value;
  }
}

function safe(value) {
  return value === null || value === undefined ? "" : String(value);
}
