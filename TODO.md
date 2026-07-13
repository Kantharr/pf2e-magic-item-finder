# PF2e Magic Item Finder — FoundryVTT Module Build TODO

A Foundry VTT module (PF2e system) that opens a **standalone window** for searching
magic items by the **ability-tag dictionary + tagging logic** first built in the
C# desktop app. It lives **alongside** the desktop app, not as a replacement:

- The **C# tool remains the tag-authoring pipeline** — its `AbilityTaggingService`
  ([../src/Pf2eItemFinder.Core/Data/AbilityTaggingService.cs](../src/Pf2eItemFinder.Core/Data/AbilityTaggingService.cs))
  and dictionary ([../src/Pf2eItemFinder.Core/Tagging/ability-tags.json](../src/Pf2eItemFinder.Core/Tagging/ability-tags.json))
  produce the tag data.
- The **module is the Foundry-native consumer** — it reads the live PF2e
  compendia for item data and joins them to a bundled, pre-computed tag map.

This sidesteps every distribution problem the desktop app hit: no installer, no
code signing, no bundled database, no .NET runtime, no resync — Foundry supplies
parsed data and one-click, auto-updating installs.

**Scope note:** the PF2e system already has a Compendium Browser with
level/rarity/trait/price filters. This module's reason to exist is the
**ability-tag search** (e.g. "items that let you fly / heal / teleport") plus
full-text description search — things the native browser can't do. Supporting
filters exist only to refine an ability-tag search, not to re-clone the browser.

## Working decisions (locked)

- **Standalone window** (its own `ApplicationV2`), opened from a control button —
  not an extension of the native Compendium Browser.
- **Lives alongside** the desktop app in this repo, under `foundry-module/`.
- **Ability-tag search is the headline feature.**

## Decisions (resolved in Phase 0 — see [docs/recon.md](docs/recon.md))

- **Versions:** ~~Foundry min `13` / verified `14`; PF2e min `8.0.0` / verified `8.3.0`~~ → **retargeted in Phase 1 to the live machine: Foundry min `12` / verified `12`; PF2e min `6.0.0` / verified `6.9.0`.** (Recon assumed v14/8.3.0 from a git clone; the installed system is v6.9.0. Tag-map join needs re-validation against v6.9.0 in Phase 2/3.)
- **Tag-map key:** compendium **UUID by `_id`** (`Compendium.pf2e.equipment-srd.Item.<_id>`)
  primary, **slug fallback**. (`system.slug` is null in source JSON; seed DB keys by `foundry_id`.)
- **Tooling:** TypeScript + Vite (`fvtt-types` for API types).
- **Search library:** MiniSearch (structured filters done outside it).
- **Module id / name:** `pf2e-magic-item-finder` / "PF2e Magic Item Finder".
- **Compendium:** one pack — `pf2e.equipment-srd` (folder is `equipment`; **`pf2e.equipment` does not exist**).

## Phases

- [x] **Phase 0 — Recon & decisions** — [phases/phase-0-recon.md](phases/phase-0-recon.md) ✅
  Confirmed target Foundry/PF2e versions; enumerated the equipment compendium
  (single pack `pf2e.equipment-srd`) and field paths; verified the magical set
  matches the desktop app's 3,328; **chose the tag-map key** (UUID by `_id`, slug
  fallback); picked tooling (TS + Vite) + search lib (MiniSearch); reserved the
  module id/name. Deliverable: [docs/recon.md](docs/recon.md).
  *Exit:* every "open decision" above is resolved and written down. ✅

- [x] **Phase 1 — Module scaffold & dev loop** — [phases/phase-1-scaffold.md](phases/phase-1-scaffold.md) ✅
  - [x] `module.json` manifest: id, title, version, `compatibility`, `relationships.systems` (pf2e), `esmodules`, `styles`, `url`/`manifest`/`download`.
  - [x] ESM entry with `init`/`ready` hooks; register module settings namespace (`debugLogging` placeholder).
  - [x] A control to open the window: **button in the Compendium sidebar header** (next to PF2e's filter) **+** `.api.open()` for a one-line macro.
  - [x] Minimal `ApplicationV2` window that renders "hello world".
  - [x] Build/bundle setup (TS + Vite, MiniSearch bundled, `fvtt-types` dev) + dev loop (`npm run watch` auto-copies into Foundry; symlinks aren't discovered by this Foundry build).
  *Exit:* ✅ verified live — module enables with no console errors and the window opens/closes in a **Foundry v12 + PF2e v6.9.0** world.
  > **Env retarget:** live machine runs Foundry **v12** / PF2e **v6.9.0**, not the v14 / PF2e 8.3.0 the recon assumed. Manifest floors lowered to `core min "12"` / `pf2e min "6.0.0"`. **Phase 2/3 must re-validate** field paths, the `equipment-srd` pack, and the `_id`→UUID tag-map join against v6.9.0 (tag data was built from v8.3.0). See [docs/recon.md](docs/recon.md) addendum.

- [x] **Phase 2 — Ability-tag data pipeline** — [phases/phase-2-tag-pipeline.md](phases/phase-2-tag-pipeline.md) — *done: live-confirmed 99.5% coverage (2872/2886) in the v6.9.0 world.*
  - [x] C# exporter (`AbilityTagExporter`) reads the tagged DB and emits `ability-tags.json`: `{ uuid → { slug, name, tags, snippets, matchMethod } }` + header + tag-category dictionary. Run via the WPF "Export tags (JSON)…" button, the `--export-ability-tags` headless CLI, or the API.
  - [x] Keyed by compendium UUID (`Compendium.pf2e.equipment-srd.Item.<_id>`), slug fallback per entry via a faithful C# `sluggify` port. Derivation documented in [phase file](phases/phase-2-tag-pipeline.md) + recon §3.
  - [x] Bundled the exported JSON (`data/` → `dist/data/`), runtime loader + schema/version check ([src/data/tag-map.ts](src/data/tag-map.ts)); parsed map exposed on `api.tagMap`.
  - [x] Coverage report ([src/data/coverage.ts](src/data/coverage.ts)): resolves keys against the live `pf2e.equipment-srd`, reports orphans / untagged / slug-rescues / matched to console.
  - [x] **Live check (user):** v6.9.0 world confirmed — map loads at `ready`, coverage = 2872/3328 matched (all by uuid), 456 orphans, 14 untagged; slug index present (`liveWithIndexSlug` 2886). The v8.3.0 `_id`s matched v6.9.0 far better than the recon feared.
  *Exit:* module loads the tag map at runtime and reports coverage stats against the live compendia. **Met.**

- [x] **Phase 3 — Compendium indexing & tag join** — [phases/phase-3-indexing.md](phases/phase-3-indexing.md) ✅ — *live-confirmed in v6.9.0: 2872/2886 magical items joined (99.5%), 1798 with tags.*
  - [x] Build an in-memory item index from `pf2e.equipment-srd` (`getIndex` with the needed fields): id/uuid, name, level, rarity, traits, price→gp, source, slug, img, type. → [src/data/item-index.ts](src/data/item-index.ts) (`IndexedItem`, `buildItemIndex`).
  - [x] Normalize price to a gp-equivalent (mirror the desktop `PriceNormalizer`: 1pp=10gp, 1gp=10sp=100cp; empty→null). → `normalizePrice`.
  - [x] Join items to the bundled tag map by uuid (slug fallback); carry matched tags + snippets + matchMethod per item; inverted `tag → uuids` index for Phase 4.
  - [x] Cache the index (built at `ready`, on `api.itemIndex`); `api.rebuildIndex()` refresh path; de-dupe by uuid; missing pack handled gracefully. Lazy description via `api.fetchDescription`.
  - [x] **Live check (user, v6.9.0):** `ready` log confirmed — 2886 magical items, 2872 joined (99.5%, all by uuid), 14 unmatched, 1798 with tags, 21 tags; spot-check table + snippets rendered (via `debugLogging`).
  *Exit:* a single in-memory model per item combining compendium data + ability tags, built once and reused. **Met.**

- [x] **Phase 4 — Search & filter engine** — [phases/phase-4-search.md](phases/phase-4-search.md) ✅ — *pure, headless engine; 22 unit tests green.*
  - [x] **Ability-tag filter** (multi-select, OR within) — the core feature; backed by the Phase 3 `tag → uuids` inverted index.
  - [x] Supporting filters: level range, rarity, traits, price range (priceless excluded from a numeric range, with an `includePriceless` toggle).
  - [x] Full-text name/description search via MiniSearch (prefix + light fuzzy, name-boosted), intersected with the structured filters. Descriptions injected (lazy in Foundry), so the engine stays Foundry-free.
  - [x] Combination semantics mirror the desktop app: **AND across categories, OR within a multi-select**; free-text AND-intersected; empty state → full list.
  - [x] Sort (name / level / price / relevance); stable tie-breaks; optional result cap with an uncapped `total` for virtualization.
  - [x] Engine ([src/search/query-engine.ts](src/search/query-engine.ts)) has no Foundry/DOM deps; wired onto `api.searchEngine` (`query(filterState)` + `options` lists). Vitest added as the headless runner.
  *Exit:* deterministic unit tests over a small fixture confirm each filter and the AND/OR semantics. **Met** — `npm test`: 22 pass.

- [x] **Phase 5 — Standalone window UI** — [phases/phase-5-ui.md](phases/phase-5-ui.md) ✅ — *live-confirmed by the user in the v6.9.0 world; no console errors.*
  - [x] `ApplicationV2` + Handlebars: filter sidebar (ability-tag chips first), results list (Name | Level | Rarity | Price | Traits), and a detail view — three drag-resizable columns. → [src/apps/search-app.ts](src/apps/search-app.ts), [templates/parts/](templates/parts/)
  - [x] Rarity color-coding (Common neutral / Uncommon green / Rare blue / Unique pink) — left accent + translucent row tint + dot, matching the desktop app.
  - [x] Detail view shows matched ability tags + their snippets (the tagging payload) + enriched description (`TextEditor.enrichHTML`).
  - [x] Foundry integrations: select a result → detail pane; double-click / Enter / open icon / detail button → item sheet; drag-to-sheet/canvas (`{ type: "Item", uuid }`).
  - [x] Theme-aware styling (`color-mix` off `currentColor`); 250 ms debounced search; keyboard navigation; live-updated option lists; ability-tag + trait chips in bounded scroll boxes.
  *Exit:* a GM can open the window, filter by ability tag, and act on a result (open/drag) end-to-end. **Met.**

- [~] **Phase 6 — Presets & export (QoL parity)** — [phases/phase-6-presets-export.md](phases/phase-6-presets-export.md) — *code complete + 33 headless tests green; deployed. Awaiting the user's live round-trip check in the v6.9.0 world.*
  - [x] Save/load/rename/delete filter presets via client-scoped `game.settings` (per-user). → [src/data/presets.ts](src/data/presets.ts)
  - [x] Serialize filter state by name (rarities/traits/tags), mirroring the desktop preset design; unknown names dropped on load (`coerceAppliedState`).
  - [x] CSV export of the current result set (Blob download, UTF-8+BOM, timestamped) + JSON. → [src/data/export.ts](src/data/export.ts)
  - [x] Preset dropdown + Save/Rename/Delete (confirm) in the sidebar; CSV/JSON buttons in the results toolbar.
  *Exit:* a preset round-trips across a Foundry reload; export opens cleanly in a spreadsheet. *(Awaiting live confirmation.)*

- [~] **Phase 7 — Packaging, release & docs** — [phases/phase-7-release.md](phases/phase-7-release.md) — *prep complete; awaiting the user's GitHub publish + clean-world verification.*
  - [x] Versioned to **v1.0.0** (`module.json` + `package.json`); manifest URLs final (`manifest` → latest, `download` → `v1.0.0/module.zip`); `verified` Foundry `12` / PF2e `6.9.0`.
  - [x] Release CI [.github/workflows/release.yml](.github/workflows/release.yml): `v*` tag → build, patch version + download URL, zip `dist/`, publish release with `module.zip` + `module.json`. Ready-to-attach `release/` artifacts staged as a manual fallback.
  - [x] README rewritten for release (install + usage + releasing); tag-refresh workflow + desktop-app relationship documented.
  - [ ] **(User)** Create the `pf2e-magic-item-finder` GitHub repo, push, tag `v1.0.0` (CI cuts the release). Optionally submit to the Foundry package registry.
  - [ ] **(User)** Verify install from the manifest URL in a clean Foundry v12 + PF2e v6.9.0 world — also closes the Phase 6 live round-trip.
  *Exit:* the module installs from its manifest URL in a clean Foundry, tags load, search works.

## Legend

- `[ ]` not started · `[~]` in progress · `[x]` complete
- Phase detail files live in [`phases/`](phases/) (create per phase as work begins,
  mirroring the desktop app's structure under [`../phases/`](../phases/)).
