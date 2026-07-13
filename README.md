# PF2e Magic Item Finder (FoundryVTT module)

A standalone FoundryVTT window (Pathfinder Second Edition system) for searching
magic items by **ability tag** — *fly, heal, teleport, invisibility…* — plus
full-text description search, level/rarity/trait/price filters, saved presets, and
CSV/JSON export.

It reads the **live** `pf2e.equipment-srd` compendium for item data and joins it to
a **bundled, pre-computed ability-tag map** authored by the C# desktop tool in the
parent repo. The result is the one thing the PF2e system's native Compendium
Browser can't do: *"show me every item that lets a character fly / heal an ally /
teleport."*

## Requirements

- FoundryVTT **v12+** (verified on v12)
- Pathfinder Second Edition system **v6.0.0+** (verified on v6.9.0)

No .NET runtime, installer, or bundled database — Foundry supplies the parsed item
data and one-click, auto-updating installs.

## Install

**In Foundry:** *Add-on Modules → Install Module → Manifest URL*, paste:

```
https://github.com/Kantharr/pf2e-magic-item-finder/releases/latest/download/module.json
```

Then enable **PF2e Magic Item Finder** in your PF2e world (*Game Settings →
Manage Modules*). If the module doesn't appear immediately after install, fully
restart the Foundry server so it re-scans the modules folder.

*(Once accepted into the Foundry package registry it will also be installable by
name from the in-app browser.)*

## Usage

Open the window in an enabled PF2e world via either:

- the **wand** button in the **Token** scene controls (left toolbar), or
- a macro:

  ```js
  game.modules.get("pf2e-magic-item-finder").api.open();
  ```

Then:

- **Filter by ability tag** — pick one or more tag chips in the sidebar (OR within
  the group). This is the headline feature.
- **Refine** with the supporting filters: free-text name/description search, level
  range, rarity, traits, price range (`AND` across categories, `OR` within a
  multi-select). An `includePriceless` toggle brings priceless items back into a
  numeric price range.
- **Act on a result** — click to see the detail pane (matched tags + the snippets
  that earned them + enriched description); double-click / Enter / the open icon
  opens the item sheet; **drag** a result onto a sheet or the canvas to place it.
- **Presets** — save the current filter set by name and reload it later (per-user,
  survives a world reload); rename/delete from the sidebar dropdown.
- **Export** — CSV or JSON of the current result set from the results toolbar
  (UTF-8 + BOM, timestamped — opens cleanly in a spreadsheet).

## Compatibility & data provenance

Two version numbers describe this module and they mean different things:

| Where | Field | Value | Meaning |
| --- | --- | --- | --- |
| `module.json` | `compatibility.verified` | `12` | Foundry core version tested |
| `module.json` | `relationships.systems` pf2e `verified` | `6.9.0` | PF2e system version tested |
| `data/ability-tags.json` | `pf2eSystemVersion` | `8.3.0` | PF2e data the **tag map** was authored against |

The bundled tag map was exported from a PF2e **8.3.0** clone but keys items by
compendium `_id` (slug fallback), and those `_id`s resolve **99.5%** against the
live **6.9.0** compendium (2872 / 2886 magical items joined; see the coverage
report logged at `ready`). So `pf2eSystemVersion` records the data's origin, not a
system requirement — it is expected to differ from the `verified` fields until the
tag map is re-exported (see below).

## Refreshing the tag map (maintainer workflow)

When the PF2e system ships item changes and the bundled tags drift, re-export:

1. Update the PF2e system clone / seed data the desktop tool reads.
2. Re-run the C# exporter (`AbilityTagExporter`) against the refreshed data — via
   the WPF **"Export tags (JSON)…"** button, the `--export-ability-tags` headless
   CLI, or the Core API. It emits `ability-tags.json`
   (`{ uuid → { slug, name, tags, snippets, matchMethod } }` + header + tag
   dictionary).
3. Replace [`data/ability-tags.json`](data/ability-tags.json) with the new export.
4. Bump the header's `pf2eSystemVersion` to the system version you exported from,
   and — if the item set changed enough to re-test — bump `module.json`'s
   `version`, `compatibility.verified`, and `relationships.systems` pf2e `verified`.
5. Cut a new release (below). Re-check the coverage report in a live world.

## Relationship to the desktop app

This module is the **Foundry-native consumer**; it is *not* a rewrite of the C#
desktop app. The two split responsibilities:

- **C# desktop tool = the tag-authoring pipeline.** Its `AbilityTaggingService`
  and the `ability-tags.json` dictionary produce the tag data. That's where tagging
  logic is maintained.
- **This module = the consumer.** It ships the pre-computed tag map and joins it to
  the live PF2e compendium at runtime, sidestepping every distribution problem the
  desktop app hit (no installer, no code signing, no bundled DB, no resync).

## Build

```powershell
npm install
npm run build      # one-off build -> dist/
npm run watch      # rebuild on change (auto-copies dist/ into Foundry)
npm run typecheck  # tsc --noEmit (optional; build does not depend on it)
npm test           # Vitest — headless search/engine/preset/export unit tests
```

`dist/` is the installable module: `vite build` bundles `src/module.ts` (with
MiniSearch) to `dist/scripts/module.js` and copies `module.json`, `styles/`,
`lang/`, `templates/`, and `data/` alongside it. `npm run build` is pure (writes
only `dist/`) so it's safe for CI/release.

### Dev loop

Foundry loads modules from `<dataPath>/Data/modules/<id>/`. **Symlinks don't work
on this build** — the module scanner skips directory symlinks — so the dev loop
copies a real `dist/` in:

```powershell
npm run watch    # rebuilds on save AND copies dist/ into the Foundry modules folder
npm run deploy   # one-off build + copy, without the watcher
```

Then edit → save → **reload the world (F5)** for JS/CSS/template changes; a
`module.json` change needs the world relaunched from Setup.
`FOUNDRY_MODULES_DIR` overrides the copy destination.

## Releasing

Tag-driven: pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds `dist/`, patches `module.json`'s `version` + `download` URL to the
tag, zips the built module, and publishes a GitHub release with `module.zip` (the
`download` asset) and `module.json` (the `manifest` asset) attached.

```powershell
git tag v1.0.0
git push origin v1.0.0
```

## Layout

```
foundry-module/            # = the module repo root
  module.json              # manifest (copied into dist/)
  src/                     # TypeScript source (module.ts entry, apps/, data/, search/)
  templates/  styles/  lang/   # copied into dist/
  data/ability-tags.json   # bundled pre-computed tag map (from the C# exporter)
  .github/workflows/       # release CI
  vite.config.ts  tsconfig.json  vitest.config.ts  package.json
  dist/                    # build output = the installable module (gitignored)
```
