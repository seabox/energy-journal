// Replace with your Azure app registration values.
export const oneDriveConfig = {
  clientId: "00d7c601-603d-4be0-9a66-4bf48e25d223",
  tenant: "consumers",
  redirectUri: window.location.origin + window.location.pathname,
  scopes: ["Files.ReadWrite.AppFolder", "offline_access", "openid", "profile"]
};

// Replace clientId with your Google Cloud OAuth2 client ID.
// Create one at https://console.cloud.google.com/ → APIs & Services → Credentials.
// Authorised JavaScript origin must include this app's origin.
export const googleDriveConfig = {
  clientId: "230155349007-vo3l03vuigfjlr8rnhnf7sj82i9jeq4q.apps.googleusercontent.com",
  scopes: "https://www.googleapis.com/auth/drive.appdata"
};
