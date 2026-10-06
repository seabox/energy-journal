const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

async function loadModule(name, globals = {}) {
  const context = vm.createContext({
    console, Date, crypto: webcrypto,
    window: { location: { origin: "http://localhost", pathname: "/" } },
    ...globals
  });
  const modules = new Map();
  function getModule(file) {
    if (!modules.has(file)) {
      modules.set(file, new vm.SourceTextModule(readFileSync(file, "utf8"), { context, identifier: file }));
    }
    return modules.get(file);
  }
  const module = getModule(path.resolve(__dirname, "..", "js", name));
  await module.link((specifier, parent) => getModule(path.resolve(path.dirname(parent.identifier), specifier)));
  await module.evaluate();
  return module.namespace;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const entries = [
  { id: "old", date: "2026-09-30", fatigue: 3, notes: 'A comma, a "quote"\nand a newline' },
  { id: "boundary", date: "2026-10-01", fatigue: 4 },
  { id: "new", date: "2026-10-02", fatigue: 5 }
];

test("CSV exports neutralize formula-like text without changing numeric cells or source data", async () => {
  const { entriesToCsv, parseCsv } = await loadModule("csv.js");
  const { escapeCsvValue } = await loadModule("utils.js");
  const formulaText = ["=1+1", "+1+1", "-1+1", "@SUM(1)", "  =1+1", "\t=1+1", "\r=1+1", "\n=1+1", "\uFEFF=1+1", "\tplain"];
  for (const notes of formulaText) {
    const entry = { date: "2026-10-06", fatigue: 3, notes, mood: notes, exerciseType: notes };
    const restored = parseCsv(entriesToCsv([entry]))[0];
    assert.equal(restored.notes, "'" + notes);
    assert.equal(restored.mood, "'" + notes);
    assert.equal(restored.exerciseType, "'" + notes);
    assert.equal(entry.notes, notes);
  }
  assert.equal(escapeCsvValue(-3), "-3");
  assert.equal(escapeCsvValue(0), "0");
  assert.equal(escapeCsvValue(null), "");
  assert.equal(escapeCsvValue("ordinary text"), "ordinary text");
  assert.equal(escapeCsvValue("'=1+1"), "'=1+1");
  const notes = 'Normal text, with "quotes"\nand a new line';
  assert.equal(parseCsv(entriesToCsv([{ date: "2026-10-06", notes }]))[0].notes, notes);
});

test("archive CSV neutralizes formulas while archive JSON remains lossless", async () => {
  const { archiveJournal } = await loadModule("journal.js");
  const { parseCsv } = await loadModule("csv.js");
  const entry = { id: "formula", date: "2026-09-30", notes: "=1+1" };
  await archiveJournal({ entries: [entry] }, "2026-10-01", {
    archive: async (_name, payload) => {
      assert.equal(payload.json.entries[0].notes, "=1+1");
      assert.equal(parseCsv(payload.csv)[0].notes, "'=1+1");
    },
    push: async () => {}
  });
  assert.equal(entry.notes, "=1+1");
});

test("history assigns untrusted IDs as DOM data, never as HTML", () => {
  const source = readFileSync(path.resolve(__dirname, "..", "js", "app.js"), "utf8");
  const start = source.indexOf("function renderEntries(sorted) {");
  const end = source.indexOf('\nbody.addEventListener("click"', start);
  const created = [];
  const body = { appendChild() {} };
  const document = {
    createDocumentFragment: () => ({ appendChild() {} }),
    createElement: (tag) => {
      const element = { tag, dataset: {}, attributes: {}, children: [],
        appendChild(child) { this.children.push(child); },
        setAttribute(key, value) { this.attributes[key] = value; }
      };
      if (tag === "tr") element.lastElementChild = { appendChild() {} };
      created.push(element);
      return element;
    }
  };
  const id = 'id"><span data-untrusted="true">synthetic</span>';
  const context = vm.createContext({ body, document, recentEntries: (rows) => rows,
    safe: (value) => value ?? "", entries: [{ id, date: "2026-10-06" }]
  });
  vm.runInContext(source.slice(start, end) + "\nrenderEntries(entries);", context);
  assert.ok(!created.find((element) => element.tag === "tr").innerHTML.includes(id));
  const buttons = created.filter((element) => element.tag === "button");
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((button) => button.dataset.action), ["edit", "delete"]);
  for (const button of buttons) {
    assert.equal(button.dataset.id, id);
    assert.equal(button.type, "button");
    assert.match(button.attributes["aria-label"], /entry for 2026-10-06$/);
  }
});

test("recent entries include today and nine prior local days, not the latest ten records", async () => {
  const { recentEntries } = await loadModule("utils.js");
  const records = ["2026-10-07", "2026-10-06", "2026-09-27", "2026-09-26", "", "bad"]
    .map((date) => ({ date }));
  const result = recentEntries(records, new Date(2026, 9, 6, 0, 5));
  assert.deepEqual(plain(result).map((entry) => entry.date), ["2026-10-06", "2026-09-27"]);
  assert.equal(records.length, 6);
  assert.equal(recentEntries(Array.from({ length: 65 }, () => ({ date: "2026-10-06" })),
    new Date(2026, 9, 6)).length, 65);
});

test("recent entries handle year and leap-year boundaries using local calendar dates", async () => {
  const { recentEntries } = await loadModule("utils.js");
  assert.deepEqual(plain(recentEntries([
    { date: "2025-12-26" }, { date: "2025-12-27" }, { date: "2026-01-05" }
  ], new Date(2026, 0, 5))).map((entry) => entry.date), ["2025-12-27", "2026-01-05"]);
  assert.deepEqual(plain(recentEntries([
    { date: "2024-02-20" }, { date: "2024-02-21" }, { date: "2024-02-29" }, { date: "2024-03-01" }
  ], new Date(2024, 2, 1))).map((entry) => entry.date), ["2024-02-21", "2024-02-29", "2024-03-01"]);
});

test("cutoff is exclusive, preserves invalid dates, and validates actual calendar dates", async () => {
  const { splitArchive } = await loadModule("journal.js");
  const result = splitArchive([...entries, { id: "undated", date: "" }, { id: "invalid", date: "2026-02-30" }], "2026-10-01");
  assert.deepEqual(plain(result.archived), [entries[0]]);
  assert.deepEqual(plain(result.retained).map((entry) => entry.id), ["boundary", "new", "undated", "invalid"]);
  for (const cutoff of ["", "bad", "2026-02-30", "2026-13-01"]) {
    assert.throws(() => splitArchive(entries, cutoff), /valid archive cutoff/);
  }
  assert.equal(splitArchive(entries, "2026-09-01").archived.length, 0);
  assert.equal(splitArchive(entries, "2026-11-01").retained.length, 0);
});

test("archive writes recoverable JSON and CSV before trimming and does not mutate input", async () => {
  const { archiveJournal } = await loadModule("journal.js");
  const { parseCsv } = await loadModule("csv.js");
  const journal = { entries, archivedEntryIds: ["previous"] };
  const before = plain(journal);
  const calls = [];
  const result = await archiveJournal(journal, "2026-10-01", {
    archive: async (name, payload) => {
      calls.push("archive");
      assert.match(name, /^energy-journal-archive-[\w-]+$/);
      assert.deepEqual(plain(payload.json.entries), [entries[0]]);
      assert.equal(payload.json.beforeDate, "2026-10-01");
      assert.equal(parseCsv(payload.csv)[0].notes, entries[0].notes);
    },
    push: async ({ json }) => {
      calls.push("active");
      assert.deepEqual(plain(json.entries).map((entry) => entry.id), ["new", "boundary"]);
      assert.deepEqual(plain(json.archivedEntryIds), ["previous", "old"]);
    }
  });
  assert.deepEqual(calls, ["archive", "active"]);
  assert.equal(result.count, 1);
  assert.deepEqual(plain(result.journal.entries), entries.slice(1));
  assert.deepEqual(journal, before);
});

test("archive failures never clear local input and upload failure never trims cloud", async () => {
  const { archiveJournal } = await loadModule("journal.js");
  const journal = { entries, archivedEntryIds: [] };
  let pushes = 0;
  await assert.rejects(archiveJournal(journal, "2026-10-01", {
    archive: async () => { throw new Error("quota exceeded"); },
    push: async () => { pushes++; }
  }), /Active entries were not removed.*quota exceeded/);
  assert.equal(pushes, 0);
  await assert.rejects(archiveJournal(journal, "2026-10-01", {
    archive: async () => {},
    push: async () => { throw new Error("offline"); }
  }), /Archive saved.*Local entries were not removed.*offline/);
  assert.equal(journal.entries.length, 3);
  await assert.rejects(archiveJournal(journal, "2026-09-01", {
    archive: async () => assert.fail("empty archive must not upload"),
    push: async () => assert.fail("empty archive must not truncate")
  }), /No entries before/);
});

test("successive archives have distinct names and support archiving every entry", async () => {
  const { archiveJournal } = await loadModule("journal.js");
  const names = [];
  const provider = { archive: async (name) => names.push(name), push: async () => {} };
  const first = await archiveJournal({ entries }, "2026-10-01", provider);
  const second = await archiveJournal(first.journal, "2026-11-01", provider);
  assert.notEqual(names[0], names[1]);
  assert.equal(second.journal.entries.length, 0);
  assert.deepEqual(plain(second.journal.archivedEntryIds), ["old", "boundary", "new"]);
});

test("sync removes archived IDs from stale devices and preserves metadata in both directions", async () => {
  const { mergeJournals, journalPayload } = await loadModule("journal.js");
  const stale = { entries, archivedEntryIds: ["earlier"] };
  const remote = { entries: entries.slice(1), archivedEntryIds: ["old"] };
  for (const [local, cloud] of [[stale, remote], [remote, stale]]) {
    const merged = mergeJournals(local, cloud);
    assert.deepEqual(plain(merged.entries).map((entry) => entry.id), ["boundary", "new"]);
    assert.deepEqual(new Set(merged.archivedEntryIds), new Set(["earlier", "old"]));
    assert.deepEqual(plain(journalPayload(merged).json.archivedEntryIds), plain(merged.archivedEntryIds));
  }
  const restored = { ...entries[0], id: "deliberately-imported" };
  assert.equal(mergeJournals(remote, { entries: [restored] }).entries.length, 3);
});

test("legacy journals and merge conflict resolution remain supported; malformed remote data fails closed", async () => {
  const { normalizeJournal, mergeJournals } = await loadModule("journal.js");
  assert.deepEqual(plain(normalizeJournal(entries).entries), entries);
  const legacy = [{ date: "2026-09-30", notes: '"quoted"' }];
  assert.equal(normalizeJournal(legacy).entries[0].id, normalizeJournal(legacy).entries[0].id);
  assert.ok(!normalizeJournal(legacy).entries[0].id.includes('"'));
  assert.ok(!normalizeJournal(legacy).entries[0].id.includes("quoted"));
  assert.equal(mergeJournals({ entries: legacy }, {
    entries: [], archivedEntryIds: [normalizeJournal(legacy).entries[0].id]
  }).entries.length, 0);
  const merged = mergeJournals({ entries: [{ ...entries[0], updatedAt: "2026-10-02" }] }, {
    entries: [{ ...entries[0], fatigue: 9, updatedAt: "2026-10-03" }, entries[1]]
  });
  assert.equal(merged.entries[0].fatigue, 9);
  assert.equal(merged.entries.length, 2);
  for (const value of [{}, { entries: null }, { entries: [null] }, { entries, archivedEntryIds: "bad" }]) {
    assert.throws(() => mergeJournals({ entries }, value), /Invalid journal data/);
  }
});

test("local storage migrates legacy arrays and atomically persists entries with archive metadata", async () => {
  let raw = JSON.stringify(entries);
  const storage = await loadModule("storage-local.js", {
    localStorage: { getItem: () => raw, setItem: (_key, value) => { raw = value; } }
  });
  assert.deepEqual(plain(storage.loadJournal()), { entries, archivedEntryIds: [] });
  storage.saveJournal({ entries: entries.slice(1), archivedEntryIds: ["old"] });
  assert.deepEqual(plain(storage.loadJournal()), { entries: entries.slice(1), archivedEntryIds: ["old"] });
  raw = "broken";
  assert.throws(() => storage.loadJournal());
});

async function oneDrive(fetch) {
  class Client {
    setLogger() {}
    addEventCallback() { return "callback"; }
    async initialize() {}
    async handleRedirectPromise() { return null; }
    getAllAccounts() { return [{ username: "test@example.invalid" }]; }
    async acquireTokenSilent() { return { accessToken: "test-token" }; }
  }
  return loadModule("storage-onedrive.js", {
    fetch,
    window: {
      location: { origin: "http://localhost", pathname: "/" },
      msal: { PublicClientApplication: Client, Logger: class {}, LogLevel: {} }
    }
  });
}

test("OneDrive saves both archive formats in approot without overwriting active JSON", async () => {
  const requests = [];
  const provider = await oneDrive(async (url, init) => {
    requests.push({ url, ...init });
    return new Response(null, { status: 200 });
  });
  await provider.archiveToOneDrive("energy-journal-archive-test", { json: { entries }, csv: "Date\n2026-09-30" });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.method, "PUT");
    assert.match(request.url, /special\/approot:\/energy-journal-archive-test\.(json|csv):\/content$/);
  }
  assert.deepEqual(JSON.parse(requests[0].body).entries, entries);
  assert.equal(requests[1].headers["Content-Type"], "text/csv;charset=utf-8");
});

test("a second OneDrive archive upload failure propagates before active truncation", async () => {
  let requests = 0;
  const provider = await oneDrive(async () => new Response(null, { status: ++requests === 2 ? 507 : 200 }));
  const { archiveJournal } = await loadModule("journal.js");
  await assert.rejects(archiveJournal({ entries }, "2026-10-01", {
    archive: provider.archiveToOneDrive,
    push: async () => assert.fail("must not trim after CSV failure")
  }), /Archive upload failed/);
  assert.equal(requests, 2);
});

async function googleDrive(fetch) {
  const provider = await loadModule("storage-googledrive.js", {
    fetch,
    window: {
      location: { origin: "http://localhost", pathname: "/" },
      google: { accounts: { oauth2: { initTokenClient: () => ({
        requestAccessToken() { this.callback({ access_token: "test-token" }); }
      }) } } }
    }
  });
  await provider.reconnectGoogleDrive();
  return provider;
}

test("Google Drive archives use appDataFolder and never replace the cached active file ID", async () => {
  const requests = [];
  const provider = await googleDrive(async (url, init = {}) => {
    requests.push({ url, ...init });
    if (url.includes("spaces=")) return Response.json({ files: [{ id: "active-id" }] });
    return Response.json({ id: "archive-id" });
  });
  await provider.syncToGoogleDrive({ json: { entries } });
  await provider.archiveToGoogleDrive("energy-journal-archive-test", { json: { entries }, csv: "Date\n2026-09-30" });
  await provider.syncToGoogleDrive({ json: { entries: [] } });
  const creates = requests.filter((request) => request.method === "POST");
  assert.equal(creates.length, 2);
  for (const request of creates) {
    assert.match(request.url, /uploadType=multipart$/);
    assert.match(request.body, /"parents":\["appDataFolder"\]/);
    assert.match(request.body, /"name":"energy-journal-archive-test\.(json|csv)"/);
  }
  const updates = requests.filter((request) => request.method === "PATCH");
  assert.equal(updates.length, 2);
  assert.ok(updates.every((request) => request.url.includes("/active-id?")));
  assert.equal(requests.filter((request) => request.url.includes("spaces=")).length, 1);
});

test("Google Drive create failures propagate; new active files still use the shared creator", async () => {
  const failed = await googleDrive(async () => new Response(null, { status: 403 }));
  await assert.rejects(failed.archiveToGoogleDrive("archive-test", { json: { entries }, csv: "" }), /HTTP 403/);
  const requests = [];
  const fresh = await googleDrive(async (url, init = {}) => {
    requests.push({ url, ...init });
    return Response.json(url.includes("spaces=") ? { files: [] } : { id: "new-active" });
  });
  await fresh.syncToGoogleDrive({ json: { entries } });
  await fresh.syncToGoogleDrive({ json: { entries } });
  assert.match(requests.find((request) => request.method === "POST").body, /"name":"energy-journal.json"/);
  assert.match(requests.at(-1).url, /\/new-active\?uploadType=media$/);
});
