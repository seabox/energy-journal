import { oneDriveConfig } from "./config.js";
import { ONEDRIVE_FILES } from "./constants.js";

let msalClient;
let account = null;

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
  }
  return msalClient;
}

async function getAccessToken() {
  const client = ensureMsal();
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

export async function connectOneDrive() {
  const client = ensureMsal();
  const response = await client.loginPopup({ scopes: oneDriveConfig.scopes, prompt: "select_account" });
  account = response.account;
  return account;
}

export function isConnected() {
  return Boolean(account);
}

export async function syncToOneDrive(payload) {
  const token = await getAccessToken();
  await uploadFile(ONEDRIVE_FILES.json, JSON.stringify(payload.json, null, 2), "application/json", token);
  await uploadFile(ONEDRIVE_FILES.csv, payload.csv, "text/csv", token);
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
