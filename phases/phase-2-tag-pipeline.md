# Phase 2 — Ability-Tag Data Pipeline

**Goal:** Get the C#-authored tag data into the module as a bundled, versioned
JSON, and load + validate it at runtime against the live compendium. The C# tool
stays the tag-authoring pipeline; this phase builds the bridge that hands its
output to Foundry.

**Depends on:** Phase 0 key decision (UUID by `_id`, slug fallback) and Phase 1
(bundle location, settings namespace).

## C#-side exporter

- [x] Add an exporter to the desktop app (Core) that reads the tagged SQLite DB
  ([../../seed/items.db](../../seed/items.db)) and emits `ability-tags.json`.
  ([../../src/Pf2eItemFinder.Core/Data/AbilityTagExporter.cs](../../src/Pf2eItemFinder.Core/Data/AbilityTagExporter.cs))
  Runnable three ways: the WPF **"Export tags (JSON)…"** button, a headless CLI
  (`Pf2eItemFinder.App.exe --export-ability-tags <db> <out> [version]`, see
  [../../src/Pf2eItemFinder.App/HeadlessExport.cs](../../src/Pf2eItemFinder.App/HeadlessExport.cs)),
  or the `AbilityTagExporter` API directly.
- [x] Per-entry shape, keyed by the Phase 0 primary key:
  `{ "<uuid>": { "slug": "...", "name": "...", "tags": [...], "snippets": { tag → snippet }, "matchMethod": { tag → "structured"|"regex" } } }`
  where `<uuid>` = `Compendium.pf2e.equipment-srd.Item.<foundry_id>`. **One entry per
  evaluated item** — tag-less items get empty `tags`/`snippets`/`matchMethod`, so the
  map mirrors the full magical universe (3,328) and the coverage report can tell
  "known-but-untagged" from "unknown".
- [x] Emit both keys: **`uuid`** (map key, primary) and **`slug`** (fallback, per entry) — see recon §3. Slug is derived from `name` via a faithful C# port of PF2e's `sluggify` ([../../src/Pf2eItemFinder.Core/Tagging/Sluggify.cs](../../src/Pf2eItemFinder.Core/Tagging/Sluggify.cs)); the 9 unicode edge cases (typographic apostrophes, non-breaking hyphens) are covered by [SluggifyTests](../../tests/Pf2eItemFinder.Tests/SluggifyTests.cs).
- [x] Include the **tag-category dictionary** (the 21 tag names + descriptions). Descriptions were added to [ability-tags.json](../../src/Pf2eItemFinder.Core/Tagging/ability-tags.json) (`TagDefinition.Description`) and flow through as the export's `categories`.
- [x] Wrap with a header: `{ "schemaVersion": 1, "pf2eSystemVersion": "8.3.0", "generatedAt": "...", "itemCount": 3328, "tags": {...entries}, "categories": [...] }`. Generated file: [../data/ability-tags.json](../data/ability-tags.json) (3,328 items, 21 categories, 2,087 with ≥1 tag).

## Module-side loader

- [x] Bundle the exported JSON in the module (`data/` → vite-copied to `dist/data/ability-tags.json`), loaded via `fetch` of the module path at `ready`. ([../src/data/tag-map.ts](../src/data/tag-map.ts))
- [x] Runtime loader + **schema/version check**: hard-fails on a `schemaVersion` mismatch; warns (console + UI notice) when `pf2eSystemVersion` differs from the installed `game.system.version`.
- [x] Expose the parsed map through the module API: `game.modules.get("pf2e-magic-item-finder").api.tagMap` (and `.coverage`).

## Validation / coverage report

- [x] Resolve every key against the live `pf2e.equipment-srd` pack via `getIndex({ fields: ["system.slug", "system.traits.value"] })`. ([../src/data/coverage.ts](../src/data/coverage.ts))
- [x] Report **orphans** (map entry with no matching live item) and **untagged** live magical items (in-pack, `magical`, not covered by the map).
- [x] Try the **slug fallback** for any `uuid` miss; count how many were rescued by slug.
- [x] Surface counts to console: matched (by uuid / by slug), orphans, untagged, live magical total.

## Verification

Static (done): `dotnet build` + full `dotnet test` green (188 tests, incl. new
Sluggify + AbilityTagExporter suites); `npm run typecheck` + `npm run build` green;
exporter produced the 3,328-item map; module + map deployed into the live Foundry
modules folder via `npm run deploy`.

Live-in-world (confirmed by the user in the **Foundry v12 / PF2e v6.9.0** world):

- [x] Module loads the map at `ready` with no errors; `api.tagMap.itemCount` === 3328, `api.coverage` populated.
- [x] Coverage report prints sane numbers. **Actual (v8.3.0 map vs v6.9.0 world):**
  `2872 / 3328 matched (2872 by uuid, 0 rescued by slug), 456 orphans, 14 untagged`
  — **2872 / 2886 = 99.5%** of the live magical set covered. The `_id`→UUID join
  held across versions (contrary to the recon's fear), so the slug fallback wasn't
  needed. The 456 orphans are v8.3.0-only items absent from v6.9.0; the 14 untagged
  are pre-remaster school-named items (`Spellbreaking (Necromancy)`, etc.) renamed
  in the remaster.
- [x] Slug fallback verified *live-but-unused*: `liveWithIndexSlug === liveMagical === 2886`,
  so the index carries `system.slug` and `rescuedBySlug: 0` means "not needed," not
  "silently broken." Coverage also derives the live slug from the name as a guard so
  the join can never no-op if a future system version drops index slugs.
- [x] Version-mismatch path fires (8.3.0 map vs 6.9.0 system) — console warning + UI notice on load.

## Exit Criteria

- [x] Module loads the tag map at runtime and reports coverage stats against the live compendia. **Met** (Foundry v12 / PF2e v6.9.0; 99.5% coverage).

## Handed to Phase 3

- The in-memory tag map (uuid → tags/snippets/method) and the category dictionary,
  ready to join onto the compendium index.
