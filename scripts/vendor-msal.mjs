import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = resolve(__dirname, "..");
const source = resolve(root, "node_modules", "@azure", "msal-browser", "lib", "msal-browser.min.js");
const targetDir = resolve(root, "js", "vendor");
const target = resolve(targetDir, "msal-browser.min.js");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log("Vendored MSAL bundle:", target);
