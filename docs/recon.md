# Recon — FoundryVTT Module (Phase 0)

Recon for the **PF2e Magic Item Finder** module, run against the same shallow
`foundryvtt/pf2e` clone the desktop app used (`../foundry-data/pf2e/`, PF2e system
**v8.3.0**) plus the desktop app's Core code and seed DB. Date: 2026-07-11.

Goal: resolve every "open decision" in [../TODO.md](../TODO.md) before scaffolding
(Phase 1). Each decision below is **locked** with its rationale.

---

> ## ⚠️ Phase 1 addendum (2026-07-12) — environment retarget
>
> This recon targeted **Foundry v13/v14 + PF2e v8.3.0**, derived from the git
> clone at `../foundry-data/pf2e`. The **actual installed Foundry on the build
> machine is v12 (Build 331) with PF2e system v6.9.0** — a v13-minimum manifest is
> silently hidden by v12 (filtered as incompatible before file validation). Phase 1
> therefore retargeted `module.json` to **core min `12` / verified `12`** and
> **pf2e min `6.0.0` / verified `6.9.0`**, and the module now enables and runs there.
>
> **Impact on the rest of this doc:** §1's version table is superseded. §2 (field
> paths, the `equipment-srd` pack) and §3 (the `_id`→UUID tag-map join) were
> validated against PF2e **v8.3.0**; the live system is **v6.9.0**, a different data
> generation whose item `_id`s may not match the v8.3.0-built tag map. **Phase 2/3
> must re-validate field paths, the pack collection name, and the key join against
> v6.9.0 before trusting the sections below.** If the project later moves to a v13/v14
> world, revert the manifest floors to the values in §1.

## 1. Target Foundry + PF2e versions

The clone's `system.pf2e.json` (v8.3.0) declares:

```json
"compatibility": { "minimum": "14.361", "verified": "14.364", "maximum": "14" }
```

So PF2e **v8.3.0 runs on Foundry v14** (v14.361+). `ApplicationV2` — the window
base class this module needs — is stable from Foundry v13 and is what PF2e's own
apps use.

**Decision — `module.json`:**

| Field | Value | Rationale |
|---|---|---|
| `compatibility.minimum` | `"13"` | First release with stable `ApplicationV2`; conservative floor. |
| `compatibility.verified` | `"14"` | Version the tag map and recon were validated against. |
| `relationships.systems[0].id` | `"pf2e"` | Hard dependency — reads PF2e compendia + data model. |
| `relationships.systems[0].compatibility.minimum` | `"8.0.0"` | Data-model paths below are stable across the v8 line. |
| `relationships.systems[0].compatibility.verified` | `"8.3.0"` | The version the bundled tag map is built from. |

> **Refresh rule (Phase 7):** the bundled tag map is version-specific. When PF2e
> ships a data update, re-run the C# exporter, bump `verified`, and re-release.

---

## 2. Equipment compendia + field paths

### Which compendium(s) to index — **one pack**

All 5,672 equipment documents (of which **3,328 are `magical`**) live in a single
PF2e pack. **Critical gotcha:** the on-disk folder is `packs/equipment`, but the
**registered collection name is `equipment-srd`** (`system.pf2e.json` → packs:
`{ "name": "equipment-srd", "label": "Equipment", "path": "packs/equipment", "type": "Item" }`).

- **Runtime collection id:** `pf2e.equipment-srd`
  (`game.packs.get("pf2e.equipment-srd")`).
- **Item UUID form:** `Compendium.pf2e.equipment-srd.Item.<_id>`.
- Do **not** hard-code `pf2e.equipment`; that pack id does not exist.

No other Item-type pack carries general equipment (the other Item packs are
actions, feats, spells, ancestries, effects, etc.). `equipment-effects` is
active-effect payloads, not items — exclude. `packs/sf2e/` (Starfinder) is out of
scope. **→ The module indexes exactly one pack: `pf2e.equipment-srd`.**

### Field paths (confirmed against the clone; mirror [../../docs/data-notes.md](../../docs/data-notes.md))

| Datum | Path (Foundry item doc) | Notes |
|---|---|---|
| id | `_id` | 16-char; always present, unique. Forms the UUID. |
| slug | `system.slug` | **Null in source JSON** (see §3); populated at runtime by PF2e. |
| name | `name` | Always present. |
| type | `type` (top-level) | equipment/consumable/weapon/ammo/armor/treasure/shield/backpack/kit. |
| level | `system.level.value` | Missing on 2 items — default 0/tolerate. |
| rarity | `system.traits.rarity` | common/uncommon/rare/unique — always present. |
| traits | `system.traits.value[]` | 244 distinct; `magical` is the magic-item filter. |
| price | `system.price.value.{pp,gp,sp,cp}` | 335 items priceless (no price object) → treat as null. |
| description | `system.description.value` | HTML + Foundry enrichers. |
| grants spell | `system.spell` | Present on 109 items; spell name at `system.spell.name`. |
| usage | `system.usage.value` | held/worn/etched… |
| bulk | `system.bulk.value` | present. |
| icon | `img` | present. |
| source book | `system.publication.title` | present. |

**Index vs. documents:** `pack.getIndex()` returns `_id`, `name`, `img`, `type`,
and `system.slug` by default; request the rest with
`getIndex({ fields: ["system.level.value", "system.traits.rarity",
"system.traits.value", "system.price.value", "system.publication.title"] })`.
`description.value` is large — pull it lazily via `fromUuid()` for the detail
view rather than indexing all 3,328 descriptions up front (Phase 3/5 decision).

### Price normalization (mirror desktop `PriceNormalizer`)

`price_gp = pp*10 + gp + sp/10 + cp/100`. Empty/absent `price.value` → `null`
(priceless, distinct from 0). Denominations present in data: gp 5059 · sp 423 ·
cp 212 · pp 182.

---

## 3. Tag-map key — **UUID (by `_id`), with slug as fallback**

### Findings

- The seed DB (`../../seed/items.db`, 3,328 magical items) keys items by
  **`foundry_id`** (= the doc `_id`) and `name`. It stores **no slug column**.
- `system.slug` is **null in 100% of the source pack JSON** (5,672/5,672) — PF2e
  computes slugs at pack-build/import time from the name. At runtime in a live
  world, `system.slug` *is* populated, but it is not available in the raw source
  the exporter reads.
- The pack **filename equals the sluggified name for 5,663/5,672 items** (9
  unicode edge cases: non-breaking hyphens, special apostrophes). So a slug is
  reliably derivable from `name`, but with a small lossy tail.
- `_id` is unique across all 5,672 files (0 collisions) and is authored directly
  in the source repo, making it stable within a system version.

### Decision

**Primary key = the compendium UUID built from `_id`:**
`Compendium.pf2e.equipment-srd.Item.<_id>`.

- Directly resolvable at runtime via `fromUuid()`; also present verbatim in
  `getIndex()` results, giving a **zero-derivation, guaranteed-unique join**.
- Already stored in the seed DB (`foundry_id`) — the Phase 2 exporter emits it
  with no extra work.

**Secondary/fallback key = `slug`** (derived from `name` via PF2e's sluggify),
emitted alongside each entry. Used to (a) re-join any entry whose `_id` misses
after a system update, and (b) make the map human-auditable. Slug survives an
`_id` change; `_id` survives a name/slug change — carrying both makes the join
resilient to either kind of edit.

> Why not slug-primary? The map is **re-exported on every PF2e version bump**
> (the documented refresh workflow), so cross-version key stability matters less
> than a clean within-version join. `_id`→UUID is the most robust within-version
> join and needs no runtime slug population. Slug rides along as insurance.

**Key derivation from a live Foundry item (document Phase 2/3):**
`uuid = item.uuid` (already `Compendium.pf2e.equipment-srd.Item.<_id>`), or build
from index entry: `` `Compendium.pf2e.equipment-srd.Item.${entry._id}` ``.
Fallback: `item.system.slug` (or `game.pf2e.system.sluggify(item.name)`).

---

## 4. Language / tooling — **TypeScript + Vite**

- **TypeScript** for the `ApplicationV2` window, the tag/index model, and the
  search engine — 3,300 items, structured filters, and a bundled JSON schema all
  benefit from types. Foundry API types via the community `fvtt-types` package
  (dev-only).
- **Vite** as bundler/dev server: it's the PF2e system's own toolchain (the clone
  ships `vite.config.ts`), gives fast rebuilds + sourcemaps, and outputs a single
  ESM bundle for `module.json`'s `esmodules`.
- Dev loop: Vite build → output into `Data/modules/pf2e-magic-item-finder/`, via
  a **symlink** from the repo `dist/` into Foundry's modules dir (Phase 1).

Rejected: plain ESM (no build) — workable but loses types and bundling for the
search lib + JSON; not worth it at this size.

---

## 5. Search library — **MiniSearch**

~3,300 items with name + (lazily loaded) description text. **MiniSearch**:
small (~10 KB), zero-dep, inverted-index full-text with prefix + fuzzy, simple
`addAll`/`search` API, easy to intersect with structured filters.

- Ability-tag filtering, level/rarity/trait/price filters are **exact structured
  filters** done outside the text index (Set intersections) — the text lib only
  serves name/description search.
- Rejected: Fuse.js (fuzzy-scoring oriented, weaker as a true inverted index at
  this scale); hand-rolled index (MiniSearch already is one, tested).

---

## 6. Module id + display name — reserved

| Field | Value |
|---|---|
| `id` | `pf2e-magic-item-finder` |
| `title` | `PF2e Magic Item Finder` |
| settings namespace | `pf2e-magic-item-finder` (matches id) |
| install path | `Data/modules/pf2e-magic-item-finder/` |
| UUID prefix consumed | `Compendium.pf2e.equipment-srd.Item.<_id>` |

---

## 7. Coverage check — module set == desktop set

`traits.value` contains `magical` → **3,328 of 5,672** in the clone, **exactly
matching** the desktop seed DB row count (3,328). The module's magical universe
is identical to the desktop app's, so the bundled tag map (one entry per DB item)
covers the live compendium 1:1, modulo per-version drift the coverage report
(Phase 2) will surface as orphans/untagged.

---

## Open decisions — all resolved

| Decision | Resolution |
|---|---|
| Target Foundry + PF2e versions | Foundry min **13** / verified **14**; PF2e min **8.0.0** / verified **8.3.0** (§1). |
| Tag-map key | **UUID by `_id`** (`Compendium.pf2e.equipment-srd.Item.<_id>`), **slug fallback** (§3). |
| Language / tooling | **TypeScript + Vite** (§4). |
| Search library | **MiniSearch** (§5). |
| Module id / name | **`pf2e-magic-item-finder`** / "PF2e Magic Item Finder" (§6). |

## Handed to Phase 1 (scaffold)

1. `module.json`: id `pf2e-magic-item-finder`, `compatibility {min:"13", verified:"14"}`,
   `relationships.systems` pf2e `{min:"8.0.0", verified:"8.3.0"}`, `esmodules`,
   `styles`, settings namespace = id.
2. Index **one** pack: `pf2e.equipment-srd` (not `pf2e.equipment`).
3. TS + Vite; `fvtt-types` dev dep; symlink `dist/` → `Data/modules/<id>/`.
4. Bundle MiniSearch.
5. Exporter (Phase 2) emits both `uuid` (primary) and `slug` (fallback) per entry.
