// No-admin dev-loop fallback: copy dist/ into Foundry's modules folder.
// Preferred loop is the one-time symlink (see README); use this when symlinks
// are blocked without admin. Re-run after each build to publish changes.
import { cpSync, existsSync, lstatSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ID = "pf2e-magic-item-finder";
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");

// Override with `FOUNDRY_MODULES_DIR` for other machines/installs.
const modulesDir =
  process.env.FOUNDRY_MODULES_DIR ??
  resolve(process.env.LOCALAPPDATA ?? "", "FoundryVTT", "Data", "modules");
const target = resolve(modulesDir, MODULE_ID);

if (!existsSync(dist)) {
  console.error(`deploy: ${dist} not found — run "npm run build" first.`);
  process.exit(1);
}

// If the user already set up the preferred symlink, dist is already live.
if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
  console.log(`deploy: ${target} is a symlink — build output is already live, nothing to copy.`);
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
console.log(`deploy: copied dist/ -> ${target}`);
