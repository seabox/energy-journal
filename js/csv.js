import { CSV_HEADERS, FIELD_MAP } from "./constants.js";
import { normalizeYN, toNumberOrNull, isoDate } from "./utils.js";

const NUMERIC_FIELDS = new Set([
  "sleepQuality",
  "fatigue",
  "exerciseMins",
  "focus",
  "play",
  "connecting",
  "physical",
  "reflect",
  "down"
]);

const YN_FIELDS = new Set(["dayNap", "sleepFlag"]);

export function entriesToCsv(entries) {
  const lines = [CSV_HEADERS.join(",")];
  for (const entry of entries) {
    const row = CSV_HEADERS.map((header) => {
      const key = Object.keys(FIELD_MAP).find((fieldKey) => FIELD_MAP[fieldKey] === header);
      const value = key ? entry[key] : "";
      return escapeValue(value);
    });
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export function parseCsv(text) {
  const rows = parseRows(text);
  if (rows.length < 2) {
    return [];
  }
  const headers = rows[0].map((h) => h.trim());
  const entries = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.every((cell) => String(cell).trim() === "")) {
      continue;
    }
    const record = {};
    for (const [key, header] of Object.entries(FIELD_MAP)) {
      const idx = headers.indexOf(header);
      const rawValue = idx >= 0 ? row[idx] : "";
      if (NUMERIC_FIELDS.has(key)) {
        record[key] = toNumberOrNull(rawValue);
      } else if (YN_FIELDS.has(key)) {
        record[key] = normalizeYN(rawValue);
      } else if (key === "date") {
        record[key] = isoDate(rawValue);
      } else {
        record[key] = rawValue ? String(rawValue).trim() : "";
      }
    }
    record.id = `${record.date || "import"}-${i}-${Math.random().toString(16).slice(2, 7)}`;
    record.updatedAt = new Date().toISOString();
    entries.push(record);
  }

  return entries;
}

function escapeValue(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes("\n") || str.includes("\"")) {
    return `"${str.replaceAll("\"", "\"\"")}"`;
  }
  return str;
}

function parseRows(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      i += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}
