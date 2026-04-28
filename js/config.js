// Replace with your Azure app registration values.
export const oneDriveConfig = {
  clientId: "REPLACE_WITH_AZURE_CLIENT_ID",
  tenant: "consumers",
  redirectUri: window.location.origin + window.location.pathname,
  scopes: ["Files.ReadWrite.AppFolder", "offline_access", "openid", "profile"]
};
