# Phase 1 — Module Scaffold & Dev Loop

**Goal:** A minimal but real PF2e module that enables cleanly in a v14 test world,
registers itself, and opens an empty `ApplicationV2` window from a control — plus
the TypeScript + Vite build and a symlinked dev loop into Foundry. No search or
data yet; this is the skeleton every later phase hangs off.

**Depends on:** Phase 0 decisions ([../docs/recon.md](../docs/recon.md)) — id,
versions, tooling.

## Manifest (`module.json`)

- [x] `id: "pf2e-magic-item-finder"`, `title: "PF2e Magic Item Finder"`, `version`, `description`, `authors`.
- [x] `compatibility: { minimum: "13", verified: "14" }`.
- [x] `relationships.systems: [{ id: "pf2e", type: "system", compatibility: { minimum: "8.0.0", verified: "8.3.0" } }]`.
- [x] `esmodules: ["scripts/module.js"]`, `styles: ["styles/module.css"]`.
- [x] `url` / `manifest` / `download` placeholders (finalized in Phase 7).

## Build & tooling (TypeScript + Vite)

- [x] `package.json` + `tsconfig.json`; add `fvtt-types` (dev) for Foundry API types. (`fvtt-types@13.346.0-beta` from npm; `npm run typecheck` = `tsc --noEmit`, green. Build uses esbuild so it never gates on types.)
- [x] `vite.config.ts` → single ESM bundle to `dist/scripts/module.js`, sourcemaps on; copy `module.json`, `styles/`, `lang/`, `templates/`, and the bundled-data folder (`data/`) into `dist/` (via `vite-plugin-static-copy`).
- [x] Add MiniSearch as a dependency (bundled, not CDN). (`minisearch@^7`; confirmed in the output bundle, imported + exposed on the module API so it isn't tree-shaken.)
- [x] `npm run build` / `npm run watch` scripts. (Plus `npm run deploy` = build + copy into Foundry, the no-admin dev-loop fallback.)

## Dev loop

- [x] Install `dist/` into `C:\Users\Owner\AppData\Local\FoundryVTT\Data\modules\pf2e-magic-item-finder` (via copy — symlink doesn't work here; see note below). Original symlink plan (admin PowerShell):
  `New-Item -ItemType SymbolicLink -Path "C:\Users\Owner\AppData\Local\FoundryVTT\Data\modules\pf2e-magic-item-finder" -Target "C:\Users\Owner\source\repos\PF2EMagicItemFinder\foundry-module\dist"`
  (or `mklink /D` from an elevated `cmd`). If symlinks are blocked without admin, enable Windows Developer Mode or fall back to a `npm run build` copy step.
  → **Symlink abandoned — it does not work on this machine's Foundry build:** the module scanner keeps only real directories and skips directory symlinks, so a `dist/` symlink installs but never appears in Manage Modules (verified against the live server). Using the sanctioned copy fallback instead: `npm run deploy` (build + copy) installs it, and `npm run watch` now auto-copies `dist/` into the modules folder after each rebuild (watch-only vite plugin). `npm run build` stays pure. A newly-installed module needs a **full server restart** to be re-scanned; Foundry v13/v14 also drops any module whose manifest references a missing file (logged to the error log only).
- [x] `.gitignore` the clone, `node_modules/`, and `dist/`. (`foundry-module/.gitignore` ignores `node_modules/` + `dist/`; the `foundry-data/` clone is already ignored at the repo root.)
- [x] Document the loop in the module README: `npm run watch` → reload the world (F5) to pick up changes. (Also documents the `npm run deploy` copy fallback.)

## Runtime entry

- [x] ESM entry with `Hooks.once("init")` and `Hooks.once("ready")`. ([../src/module.ts](../src/module.ts))
- [x] Register the settings namespace (`pf2e-magic-item-finder`) with a placeholder client-scoped setting (`debugLogging`; presets land in Phase 6).
- [x] A control to open the window: a **button injected into the Compendium sidebar header** (next to PF2e's filter funnel), via `renderSidebarTab` filtered to the compendium tab (idempotent; robust to PF2e's `CompendiumDirectoryPF2e` subclass) **and** a public API (`game.modules.get("pf2e-magic-item-finder").api.open()`) for a one-line macro. Guarded on `game.system.id === "pf2e"`. *(Original scene-control-button approach was dropped: the wand didn't surface reliably in v12's Token controls, and the compendium header is where the user wanted it.)*
- [x] Minimal `ApplicationV2` (+ `HandlebarsApplicationMixin`) window that renders "hello world". ([../src/apps/search-app.ts](../src/apps/search-app.ts) + [../templates/search-app.hbs](../templates/search-app.hbs)) — open/close verified live in Foundry v12.

## Verification

Static checks: `npm run build` + `npm run typecheck` green; built `dist/scripts/module.js` passes `node --check` and contains MiniSearch; `module.json` valid; entry touches `game`/`ui` only inside post-boot callbacks.

Live checks (confirmed by the user in a running **Foundry v12 + PF2e v6.9.0** world):

- [x] Module appears in Manage Modules and enables with **no console errors**. *(Required retargeting the manifest to the live env — see note in Dev loop / recon addendum. A v13-min manifest was silently hidden by v12.)*
- [x] The control/macro opens the window; it renders and closes. *(Compendium-header button + `.api.open()` both open it; fixed a `this`-binding bug where hoisting `Hooks.on` to a local var threw `Cannot read properties of undefined (reading '#id')`.)*
- [x] Editing source + `npm run watch` + world reload reflects the change (dev loop works end-to-end, via the copy/auto-deploy path — symlinks aren't discovered by this Foundry build).

## Exit Criteria

- [x] Window opens in a PF2e test world; module enables cleanly with no console errors. **Met** (Foundry v12 / PF2e v6.9.0).

## Handed to Phase 2

- The bundled-data folder location in `dist/` (where `ability-tags.json` will land).
- The settings namespace, for the runtime loader's schema/version check.
