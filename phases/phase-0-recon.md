# Phase 0 — Recon & Decisions ✅ COMPLETE

**Goal:** Confirm target Foundry/PF2e versions, enumerate the equipment compendia
and field paths, verify the magical set matches the desktop app's 3,328, **choose
the tag-map key**, pick tooling + search lib, and reserve the module id/name —
before any scaffolding.

**Result:** Full findings in [docs/recon.md](../docs/recon.md). All five open
decisions resolved and locked. Recon run against the existing clone at
[../../foundry-data/pf2e/](../../foundry-data/pf2e/) (PF2e **v8.3.0**), the
desktop Core code, and the seed DB ([../../seed/items.db](../../seed/items.db)).

## Tasks

- [x] Confirm target Foundry + PF2e versions — PF2e **v8.3.0** on Foundry **v14**
  (`compatibility.minimum 14.361 / verified 14.364`); `ApplicationV2` stable from
  v13. Module targets Foundry min **13** / verified **14**, PF2e min **8.0.0** /
  verified **8.3.0**.
- [x] Enumerate equipment compendia — **single pack**. Folder `packs/equipment`
  but registered collection name is **`equipment-srd`** → runtime id
  **`pf2e.equipment-srd`**, UUID `Compendium.pf2e.equipment-srd.Item.<_id>`.
  (`pf2e.equipment` does **not** exist — key gotcha.) `equipment-effects` is
  effects, not items; `sf2e` out of scope.
- [x] Confirm field paths for level, price, rarity, traits, description, `slug`,
  source UUID — all confirmed (see recon §2); paths mirror
  [../../docs/data-notes.md](../../docs/data-notes.md).
- [x] Verify magical set == desktop's 3,328 — `traits.value` contains `magical` →
  **3,328 / 5,672**, exactly matching the seed DB row count.
- [x] **Choose the tag-map key** — **UUID by `_id`**
  (`Compendium.pf2e.equipment-srd.Item.<_id>`) primary, **slug fallback** (derived
  from name). Rationale in recon §3. Notable: `system.slug` is **null in 100% of
  source JSON** (computed at runtime); seed DB keys by `foundry_id`, stores no
  slug; filename == sluggified name for 5,663/5,672.
- [x] Pick tooling — **TypeScript + Vite** (matches PF2e's toolchain; `fvtt-types`
  for API types).
- [x] Pick search lib — **MiniSearch** (small inverted-index full-text; structured
  filters done outside it as Set intersections).
- [x] Reserve module id/name — **`pf2e-magic-item-finder`** / "PF2e Ability-Tag
  Search"; settings namespace = id.

## Deliverables

- [x] [docs/recon.md](../docs/recon.md) — versions, the single-pack + field-path
  map, tag-map key decision + derivation, tooling/search-lib choices, id/name, and
  the coverage check. Includes a "Handed to Phase 1" list.

## Exit Criteria

- [x] Every "open decision" in [../TODO.md](../TODO.md) is resolved and written
  down. No unknowns block Phase 1 scaffolding.

## Key Decisions Handed to Phase 1

1. **Index one pack:** `pf2e.equipment-srd` (never `pf2e.equipment`).
2. **Tag-map key:** UUID from `_id` primary, `slug` fallback — exporter emits both.
3. **`module.json`:** Foundry `{min:"13", verified:"14"}`; `relationships.systems`
   pf2e `{min:"8.0.0", verified:"8.3.0"}`; id/namespace `pf2e-magic-item-finder`.
4. **Tooling:** TypeScript + Vite; `fvtt-types` dev dep; symlink `dist/` →
   Foundry `Data/modules/<id>/`.
5. **Search:** bundle MiniSearch; text index serves name/description only.
6. **Price:** `pp*10 + gp + sp/10 + cp/100`; empty price → null (mirror desktop).
