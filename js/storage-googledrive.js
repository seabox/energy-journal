import { googleDriveConfig } from "./config.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FILE_NAME = "energy-journal.json";
const GD_DISPLAY_KEY = "ej-gd-display";

let tokenClient = null;
let accessToken = null;
let cachedFileId = null;

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(s);
  });
}

async function buildTokenClient() {
  if (tokenClient) return tokenClient;
  await loadGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: googleDriveConfig.clientId,
    scope: googleDriveConfig.scopes,
    callback: () => {},
  });
  return tokenClient;
}

function requestToken(extraParams = {}) {
  return new Promise(async (resolve, reject) => {
    const client = await buildTokenClient();
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error));
        return;
      }
      accessToken = resp.access_token;
      resolve(accessToken);
    };
    client.requestAccessToken(extraParams);
  });
}

export async function connectGoogleDrive() {
  if (googleDriveConfig.clientId === "REPLACE_WITH_GOOGLE_CLIENT_ID") {
    throw new Error("Set your Google client ID in js/config.js before connecting Google Drive.");
  }
  const token = await requestToken({ prompt: "select_account" });
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const info = await res.json();
      const display = info.email || info.name || null;
      if (display) localStorage.setItem(GD_DISPLAY_KEY, display);
    }
  } catch { /* non-fatal */ }
  return true;
}

// GIS tokens are in-memory only; call this each session to get a fresh token.
export async function reconnectGoogleDrive() {
  if (googleDriveConfig.clientId === "REPLACE_WITH_GOOGLE_CLIENT_ID") {
    throw new Error("Set your Google client ID in js/config.js before connecting Google Drive.");
  }
  await requestToken({});
  return true;
}

export function isGDConnected() {
  return Boolean(accessToken);
}

export function getGDDisplayName() {
  return localStorage.getItem(GD_DISPLAY_KEY);
}

async function authedFetch(url, init = {}) {
  if (!accessToken) throw new Error("Not connected to Google Drive.");
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) }
  });
  return res;
}

async function resolveFileId() {
  if (cachedFileId) return cachedFileId;
  const q = encodeURIComponent(`name = '${FILE_NAME}'`);
  const res = await authedFetch(
    `${DRIVE_API}?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=1`
  );
  if (!res.ok) throw new Error("Google Drive file search failed.");
  const { files } = await res.json();
  cachedFileId = files?.[0]?.id ?? null;
  return cachedFileId;
}

export async function syncToGoogleDrive(payload) {
  const content = JSON.stringify(payload.json, null, 2);
  const existingId = await resolveFileId();

  if (existingId) {
    const res = await authedFetch(`${UPLOAD_API}/${existingId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: content
    });
    if (!res.ok) throw new Error("Google Drive update failed.");
  } else {
    const metadata = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] });
    const boundary = "ejboundary";
    const body = [
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      metadata,
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      content,
      `--${boundary}--`
    ].join("\r\n");
    const res = await authedFetch(`${UPLOAD_API}?uploadType=multipart`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    if (!res.ok) throw new Error("Google Drive create failed.");
    const created = await res.json();
    cachedFileId = created.id;
  }
}

export async function pullFromGoogleDrive() {
  const fileId = await resolveFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/${fileId}?alt=media`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Google Drive download failed.");
  return res.json();
}
