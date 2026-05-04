import { oneDriveConfig } from "./config.js";
import { ONEDRIVE_FILES } from "./constants.js";

let msalClient;
let account = null;
let initPromise = null;
let eventCallbackId = null;
let redirectLogin = false; // true only when account came from a fresh loginRedirect response

const msalDebug = {
  enabled: true,
  maxEntries: 300
};

function getMsalLogStore() {
  if (!Array.isArray(window.__energyJournalMsalLog)) {
    window.__energyJournalMsalLog = [];
  }
  return window.__energyJournalMsalLog;
}

function recordMsalLog(entry) {
  if (!msalDebug.enabled) {
    return;
  }
  const store = getMsalLogStore();
  store.push({ at: new Date().toISOString(), ...entry });
  if (store.length > msalDebug.maxEntries) {
    store.splice(0, store.length - msalDebug.maxEntries);
  }
}

function setupMsalDebugHooks(client) {
  if (!msalDebug.enabled || eventCallbackId) {
    return;
  }

  const logLevelMap = window.msal.LogLevel;
  const logger = new window.msal.Logger({
    logLevel: logLevelMap.Verbose,
    piiLoggingEnabled: false,
    loggerCallback(level, message, containsPii) {
      if (containsPii) {
        return;
      }
      const levelName = Object.keys(logLevelMap).find((key) => logLevelMap[key] === level) || String(level);
      recordMsalLog({ type: "logger", level: levelName, message });
      console.debug("[MSAL]", levelName, message);
    }
  });

  client.setLogger(logger);
  eventCallbackId = client.addEventCallback((event) => {
    recordMsalLog({
      type: "event",
      eventType: event.eventType,
      interactionType: event.interactionType || null,
      correlationId: event.correlationId || null,
      errorCode: event.error?.errorCode || event.errorCode || null,
      errorMessage: event.error?.message || null
    });
    console.debug("[MSAL EVENT]", event.eventType, {
      interactionType: event.interactionType || null,
      correlationId: event.correlationId || null,
      errorCode: event.error?.errorCode || event.errorCode || null,
      errorMessage: event.error?.message || null
    });
  });
}

function ensureMsal() {
  if (!window.msal || !window.msal.PublicClientApplication) {
    throw new Error("MSAL script not loaded.");
  }
  if (oneDriveConfig.clientId === "REPLACE_WITH_AZURE_CLIENT_ID") {
    throw new Error("Set your Azure client ID in js/config.js first.");
  }
  if (!msalClient) {
    msalClient = new window.msal.PublicClientApplication({
      auth: {
        clientId: oneDriveConfig.clientId,
        authority: `https://login.microsoftonline.com/${oneDriveConfig.tenant}`,
        redirectUri: oneDriveConfig.redirectUri
      },
      cache: {
        cacheLocation: "localStorage"
      }
    });
    setupMsalDebugHooks(msalClient);
  }
  return msalClient;
}

async function ensureMsalReady() {
  const client = ensureMsal();
  if (!initPromise) {
    initPromise = (async () => {
      await client.initialize();
      // Process any pending redirect response (e.g. returning from loginRedirect).
      const redirectResponse = await client.handleRedirectPromise();
      if (redirectResponse?.account) {
        account = redirectResponse.account;
        redirectLogin = true;
      }
      // Restore previously signed-in account from cache.
      if (!account) {
        const accounts = client.getAllAccounts();
        if (accounts.length) {
          account = accounts[0];
        }
      }
    })();
  }
  await initPromise;
  return client;
}

async function getAccessToken() {
  const client = await ensureMsalReady();
  if (!account) {
    const accounts = client.getAllAccounts();
    account = accounts[0] || null;
  }
  if (!account) {
    throw new Error("Not signed in to OneDrive yet.");
  }
  const token = await client.acquireTokenSilent({ scopes: oneDriveConfig.scopes, account });
  return token.accessToken;
}

// Initiate login. The page will navigate away to Microsoft login and return.
// Call initOneDrive() on every page load to pick up the redirect response.
export async function connectOneDrive() {
  const client = await ensureMsalReady();
  // loginRedirect navigates the page — this promise resolves just before navigation.
  await client.loginRedirect({
    scopes: oneDriveConfig.scopes,
    prompt: "select_account",
    redirectUri: oneDriveConfig.redirectUri
  });
}

// Call this on every page load so redirect responses are processed automatically.
export async function initOneDrive() {
  try {
    await ensureMsalReady();
  } catch {
    // Non-fatal — app still works without OneDrive.
  }
  return isODConnected();
}

export function isODConnected() {
  return Boolean(account);
}

/** True only when the account was established from a fresh loginRedirect response this page load. */
export function wasODRedirectLogin() {
  return redirectLogin;
}

export function getODDisplayName() {
  return account ? (account.username || account.name || null) : null;
}

export async function syncToOneDrive(payload) {
  const token = await getAccessToken();
  await uploadFile(ONEDRIVE_FILES.json, JSON.stringify(payload.json, null, 2), "application/json", token);
}

export async function pullFromOneDrive() {
  const token = await getAccessToken();
  const json = await downloadFile(ONEDRIVE_FILES.json, token);
  if (!json) {
    return null;
  }
  return JSON.parse(json);
}

async function uploadFile(fileName, content, contentType, token) {
  const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${fileName}:/content`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType
    },
    body: content
  });
  if (!response.ok) {
    throw new Error(`OneDrive upload failed for ${fileName}.`);
  }
}

async function downloadFile(fileName, token) {
  const metadataUrl = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${fileName}`;
  const metadataRes = await fetch(metadataUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (metadataRes.status === 404) {
    return null;
  }

  if (!metadataRes.ok) {
    throw new Error(`Failed to check ${fileName} in OneDrive.`);
  }

  const meta = await metadataRes.json();
  const downloadRes = await fetch(meta["@microsoft.graph.downloadUrl"]);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download ${fileName} from OneDrive.`);
  }

  return downloadRes.text();
}
