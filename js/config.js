// Replace with your Azure app registration values.
export const oneDriveConfig = {
  clientId: "00d7c601-603d-4be0-9a66-4bf48e25d223",
  tenant: "consumers",
  redirectUri: window.location.origin + window.location.pathname,
  scopes: ["Files.ReadWrite.AppFolder", "offline_access", "openid", "profile"]
};
