export function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeYN(value) {
  if (!value) {
    return "";
  }
  const normalized = String(value).trim().toUpperCase();
  return normalized === "Y" || normalized === "YES" ? "Y" : normalized === "N" || normalized === "NO" ? "N" : "";
}

export function isoDate(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return parseLooseDate(value);
  }
  return parsed.toISOString().slice(0, 10);
}

function parseLooseDate(value) {
  const cleaned = String(value).trim();
  const noWeekday = cleaned.includes(" ") ? cleaned.split(" ").slice(-1)[0] : cleaned;
  const direct = /^(\d{1,2})-([A-Za-z]{3})$/;
  const match = noWeekday.match(direct);
  if (!match) {
    return "";
  }

  const day = Number(match[1]);
  const monthText = match[2].toLowerCase();
  const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthText);
  if (monthIndex < 0 || day < 1 || day > 31) {
    return "";
  }

  const year = new Date().getFullYear();
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.toISOString().slice(0, 10);
}

export function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function sortEntriesByDateDesc(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export function recentEntries(entries, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 9);
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const firstDate = localDate(start);
  const lastDate = localDate(now);
  return entries.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    entry.date >= firstDate && entry.date <= lastDate);
}

export function average(values) {
  if (!values.length) {
    return null;
  }
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

export function escapeCsvValue(value) {
  let str = value === null || value === undefined ? "" : String(value);
  // CSV quoting does not prevent spreadsheet formulas; keep numeric cells numeric.
  if (typeof value !== "number" && (/^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(str) || /^[\t\r\n]/.test(str))) {
    str = "'" + str;
  }
  if (str.includes(",") || str.includes("\n") || str.includes("\r") || str.includes("\"")) {
    return `"${str.replaceAll("\"", "\"\"")}"`;
  }
  return str;
}
