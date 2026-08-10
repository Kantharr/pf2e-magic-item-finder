# PF2e Item Finder (FoundryVTT module)

A standalone FoundryVTT window (Pathfinder Second Edition system) for searching
equipment by **ability tag** — *fly, heal, teleport, invisibility…* — plus
full-text description search, level/rarity/trait/price filters, saved presets, and
CSV/JSON export.

It reads the **live** `pf2e.equipment-srd` compendium for item data and joins it to
a **bundled, pre-computed ability-tag map**. The result is the one thing the PF2e
system's native Compendium Browser can't do: *"show me every item that lets a
character fly / heal an ally / teleport."*

**Magical and mundane items are both searchable**, and the window shows both by
default. A **Magic** filter narrows to one or the other when you want just the
enchanted gear, or just the ordinary kind. An item counts as magical if it carries
a marker trait (`magical`, `arcane`, `divine`, `occult`, `primal`, `artifact`) **or**
any etched rune — the remaster strips the `magical` trait from *specific* magic
items like *Iris of the Sky*, which are recognizable only by their runes. Only
magical items carry ability tags, so picking any tag narrows to them on its own.

## Requirements

- FoundryVTT **v12+** (verified on v14)
- Pathfinder Second Edition system **v6.0.0+** (verified on v8.4.0)

No installer, runtime, or bundled database to manage — Foundry supplies the parsed
item data and one-click, auto-updating installs.

## Install

**In Foundry:** *Add-on Modules → Install Module → Manifest URL*, paste:

```
https://github.com/Kantharr/pf2e-magic-item-finder/releases/latest/download/module.json
```

Then enable **PF2e Item Finder** in your PF2e world (*Game Settings →
Manage Modules*). If the module doesn't appear immediately after install, fully
restart the Foundry server so it re-scans the modules folder.

*(Once accepted into the Foundry package registry it will also be installable by
name from the in-app browser.)*

## Usage

Open the window in an enabled PF2e world via either:

- the **wand** button in the **Compendium sidebar** header (right-hand sidebar →
  Compendium Packs tab, next to the search/filter), or
- a macro:

  ```js
  game.modules.get("pf2e-magic-item-finder").api.open();
  ```

Then:

- **Filter by ability tag** — pick one or more tag chips in the sidebar (OR within
  the group). This is the headline feature.
- **Refine** with the supporting filters: free-text search, level range, rarity,
  traits, price range, weapon group / armor category, and weapon hands — 1, 1+,
  or 2 (`AND` across categories, `OR` within a multi-select). An
  `includePriceless` toggle brings priceless items back into a numeric price
  range. Weapon group and armor category share one "item type" axis (picking
  *firearm* + *light* shows both); hands is its own axis, so *2 hands* + *sword*
  means two-handed swords.
- **Free-text search covers names *and* description bodies**, so you can find
  "the item that grants fast healing" without knowing its name; name matches
  still rank first. Description text is pulled from the compendium once, when
  the window is first opened — it takes a few seconds, and until it lands the
  box matches names only (results widen automatically when it does).
- **Exclude with `-`** — prefix a term with a dash to hide anything whose name or
  description contains it: `flight -staff` finds flight items that never mention
  a staff, and a query of *only* exclusions (`-staff`) filters the whole list
  instead of searching it. Exclusions are literal, case-insensitive substrings —
  `-staff` also hides *Quarterstaff* — because the prefix/fuzzy matching that
  helps you *find* things is a liability when it silently *hides* them. A dash
  mid-word (`fatal-aim`) is just part of the term.
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
| `module.json` | `compatibility.verified` | `14` | Foundry core version tested |
| `module.json` | `relationships.systems` pf2e `verified` | `8.4.0` | PF2e system version tested |
| `data/ability-tags.json` | `pf2eSystemVersion` | `8.4.0` | PF2e data the **tag map** was authored against |

The bundled tag map keys items by compendium `_id` (slug fallback). Against a live
PF2e **8.4.0** compendium all **3488** map entries resolve — 100%, no orphans — and
they cover **89%** of the 3915 magical items the module indexes. `pf2eSystemVersion`
records the data's origin rather than a system requirement, so it is expected to
drift from the `verified` fields until the map is re-exported (see below).

The **427 untagged** items are searchable by name, description, and every
structured filter; they simply carry no ability tags yet. Most are *specific magic
items* — the remaster stamps them with runes instead of the `magical` trait, so the
offline tagging pipeline (which still keys on that trait) hasn't seen them. They
pick up tags on the next map re-export.

## Refreshing the tag map (maintainer workflow)

The bundled `data/ability-tags.json` is a pre-computed map generated offline by a
separate tagging pipeline (not part of this repo). When the PF2e system ships item
changes and the bundled tags drift:

1. Regenerate `ability-tags.json` from the refreshed PF2e data. It maps each item
   UUID → `{ slug, name, tags, snippets, matchMethod }`, plus a header and the
   tag-category dictionary (`schemaVersion` + `pf2eSystemVersion`).
2. Replace [`data/ability-tags.json`](data/ability-tags.json) with the new export.
3. Bump the header's `pf2eSystemVersion` to the system version you exported from,
   and — if the item set changed enough to re-test — bump `module.json`'s
   `version`, `compatibility.verified`, and `relationships.systems` pf2e `verified`.
4. Cut a new release (below). Re-check the coverage report in a live world.

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
  data/ability-tags.json   # bundled pre-computed tag map (generated offline)
  .github/workflows/       # release CI
  vite.config.ts  tsconfig.json  vitest.config.ts  package.json
  dist/                    # build output = the installable module (gitignored)
```
