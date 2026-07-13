# Phase 6 — Presets & Export (QoL Parity)

**Goal:** Match the desktop app's quality-of-life features: save/load named filter
presets (per user) and export the current result set to CSV/JSON. Small phase,
mostly plumbing the Phase 5 filter state through `game.settings` and a Blob
download.

**Depends on:** Phase 5 (filter-state object + current result set), Phase 1
(settings namespace).

## Presets

- [x] Save / load / rename / delete named filter presets via **client-scoped** `game.settings` (per-user, mirror the desktop `FilterPresetService`). → [src/data/presets.ts](../src/data/presets.ts) (`filterPresets` setting, registered in [module.ts](../src/module.ts)).
- [x] Serialize filter state **by name**: selected rarities, traits, ability tags, level range, price range (mirror the desktop preset design — store names, not internal ids, so presets survive re-index). Filter state already holds names/slugs; `sanitizeState` persists a compact snapshot.
- [x] UI: a small preset dropdown/menu in the sidebar (save current, apply, rename, delete) with a confirm on delete. → sidebar footer ([sidebar.hbs](../templates/parts/sidebar.hbs)); Foundry `Dialog` prompt for name + `Dialog.confirm` on delete.
- [x] Re-applying a preset whose trait/tag no longer exists degrades gracefully (ignore unknowns, keep the rest). → `coerceAppliedState` (validated by [presets.test.ts](../src/data/presets.test.ts)).

## Export

- [x] CSV export of the **current result set** via a `Blob` download (columns mirror the results list + matched tags): Name, Level, Rarity, Price (gp), Traits, Tags, Source. → [src/data/export.ts](../src/data/export.ts); the app exports `engine.query(filter)` **uncapped** (not the DOM-capped view).
- [x] Optional JSON export (same rows, structured).
- [x] Filename includes a timestamp; UTF-8 with BOM (CSV) so it opens cleanly in Excel. → `exportTimestamp`, `triggerDownload(withBom)`.

## Verification

- [x] Headless unit tests (Vitest): CSV columns/quoting/CRLF/priceless + JSON shape ([export.test.ts](../src/data/export.test.ts)); preset graceful-degradation ([presets.test.ts](../src/data/presets.test.ts)). `npm test`: 33 pass. `npm run typecheck` + `npm run build` clean; deployed to the live modules dir.
- [ ] **Live check (user, v6.9.0):** a preset **round-trips across a Foundry reload** (save → reload world → load → same filter state).
- [ ] **Live check (user):** rename/delete behave; deleting the active preset doesn't clear the current filters.
- [ ] **Live check (user):** CSV opens cleanly in a spreadsheet (correct columns, no mojibake, prices/levels intact); export reflects the *current* filtered set, not the whole index.

## Exit Criteria

- A preset round-trips across a Foundry reload; export opens cleanly in a spreadsheet. **Code complete + headless-tested; awaiting the user's live confirmation in the v6.9.0 world.**

## Handed to Phase 7

- Feature-complete module ready for packaging + docs (README should cover presets + export).
