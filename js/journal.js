import { entriesToCsv } from "./csv.js";
import { sortEntriesByDateDesc, uid } from "./utils.js";

function entryId(entry) {
  if (entry.id) return entry.id;
  // Stable legacy IDs let other devices recognise archived entries without retaining their contents.
  let hash = 14695981039346656037n;
  for (const char of JSON.stringify(entry)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0))) * 1099511628211n);
  }
  return `legacy-${hash.toString(16)}`;
}

export function normalizeJournal(value) {
  if (value === null) return { entries: [], archivedEntryIds: [] };
  const journal = Array.isArray(value) ? { entries: value } : value;
  if (!journal || !Array.isArray(journal.entries) ||
      !journal.entries.every((entry) => entry && typeof entry.date === "string" &&
        (entry.id === undefined || typeof entry.id === "string")) ||
      (journal.archivedEntryIds !== undefined &&
        (!Array.isArray(journal.archivedEntryIds) ||
          !journal.archivedEntryIds.every((id) => typeof id === "string")))) {
    throw new Error("Invalid journal data. No cloud files were changed.");
  }
  const archivedEntryIds = [...new Set(journal.archivedEntryIds || [])];
  const archived = new Set(archivedEntryIds);
  return {
    entries: journal.entries
      .map((entry) => ({ ...entry, id: entryId(entry) }))
      .filter((entry) => !archived.has(entry.id)),
    archivedEntryIds
  };
}

export function mergeEntries(base, incoming) {
  const byId = new Map();
  for (const item of [...base, ...incoming]) {
    const id = entryId(item);
    const existing = byId.get(id);
    const existingStamp = existing?.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const incomingStamp = item.updatedAt ? Date.parse(item.updatedAt) : 0;
    if (!existing || incomingStamp >= existingStamp) {
      byId.set(id, { ...existing, ...item, id });
    }
  }
  return [...byId.values()];
}

export function mergeJournals(local, remote) {
  const base = normalizeJournal(local);
  const incoming = normalizeJournal(remote);
  return normalizeJournal({
    entries: mergeEntries(base.entries, incoming.entries),
    archivedEntryIds: [...base.archivedEntryIds, ...incoming.archivedEntryIds]
  });
}

export function journalPayload(journal) {
  return {
    json: {
      updatedAt: new Date().toISOString(),
      entries: sortEntriesByDateDesc(journal.entries),
      archivedEntryIds: journal.archivedEntryIds
    }
  };
}

export function splitArchive(entries, cutoff) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) ||
      !Number.isFinite(Date.parse(cutoff)) ||
      new Date(cutoff).toISOString().slice(0, 10) !== cutoff) {
    throw new Error("Choose a valid archive cutoff date.");
  }
  const archived = [];
  const retained = [];
  for (const entry of entries) {
    // Undated or malformed imported dates stay active rather than being removed.
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
      Number.isFinite(Date.parse(entry.date)) &&
      new Date(entry.date).toISOString().slice(0, 10) === entry.date;
    (validDate && entry.date < cutoff ? archived : retained).push(entry);
  }
  return { archived, retained };
}

export async function archiveJournal(journal, cutoff, provider) {
  const current = normalizeJournal(journal);
  const { archived, retained } = splitArchive(current.entries, cutoff);
  if (!archived.length) throw new Error("No entries before the selected date to archive.");

  const archivedAt = new Date().toISOString();
  const fileBase = `energy-journal-archive-${archivedAt.replace(/[:.]/g, "-")}-${uid()}`;
  const sorted = sortEntriesByDateDesc(archived);
  try {
    await provider.archive(fileBase, {
      json: { archivedAt, beforeDate: cutoff, entries: sorted },
      csv: entriesToCsv(sorted)
    });
  } catch (error) {
    throw new Error(`Archive upload failed. Active entries were not removed; partial archive files may exist (${fileBase}). ${error.message}`);
  }

  const next = {
    entries: retained,
    archivedEntryIds: [...current.archivedEntryIds, ...archived.map((entry) => entry.id)]
  };
  try {
    await provider.push(journalPayload(next));
  } catch (error) {
    throw new Error(`Archive saved as ${fileBase}, but updating the active cloud journal failed. Local entries were not removed. Reconnect to check cloud state before retrying. ${error.message}`);
  }
  return { journal: next, fileBase, count: archived.length };
}
