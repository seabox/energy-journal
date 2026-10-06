import { STORAGE_KEY } from "./constants.js";
import { normalizeJournal } from "./journal.js";

export function loadJournal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return normalizeJournal(raw ? JSON.parse(raw) : null);
}

export function saveJournal(journal) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
}
