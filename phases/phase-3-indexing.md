# Phase 3 — Compendium Indexing & Tag Join ✅ COMPLETE

**Goal:** One in-memory model per item that combines live compendium data with the
bundled ability tags, built once at `ready` and reused. This is the data layer the
search engine (Phase 4) and UI (Phase 5) query.

**Depends on:** Phase 2 (loaded tag map + category dictionary). Indexes the single
pack `pf2e.equipment-srd` (recon §2).

Implemented in [src/data/item-index.ts](../src/data/item-index.ts); wired into the
`ready` flow + module API in [src/module.ts](../src/module.ts).

## Build the item index

- [x] Read the equipment compendium via `pack.getIndex({ fields: [...] })` requesting: `system.level.value`, `system.traits.rarity`, `system.traits.value`, `system.price.value`, `system.publication.title`, `system.slug`. (`_id`, `name`, `img`, `type` come by default.) — `INDEX_FIELDS` + `readMagicalItems`.
- [x] Filter to magical items (`traits.value` includes `magical`) → ~3,328 (v8.3.0) / **~2,886 live in v6.9.0**. Reuses `MAGICAL_TRAIT` from `coverage.ts`.
- [x] Per item, capture: `uuid`, `_id` (`id`), `name`, `level`, `rarity`, `traits[]`, `priceGp`, `source`, `slug`, `img`, `type` — the `IndexedItem` model.
- [x] Defer `description.value` — `fetchItemDescription(uuid)` pulls it lazily via `fromUuid()` for the detail view / on-demand full-text (recon §2), not up front. Exposed as `api.fetchDescription`.

## Normalize price

- [x] Mirror the desktop `PriceNormalizer`: `priceGp = pp*10 + gp + sp/10 + cp/100` — `normalizePrice()`.
- [x] Empty/absent `price.value` → `null` (priceless), distinct from 0. Verified against the desktop `PriceNormalizerTests` cases in the headless harness.

## Join to the tag map

- [x] Join each item to the bundled map by **`uuid`** (primary); fall back to **`slug`** on a miss (`entriesBySlug` lookup). Per-item `joinedBy: "uuid" | "slug" | null` records how it joined.
- [x] Carry matched `tags[]` + per-tag `snippets` and `matchMethod` onto the item model.
- [x] Items with no map entry get an empty tag list (still searchable by name/filters).

## Cache & lifecycle

- [x] Build once at `ready`; cache the array + lookup maps: `byUuid` (uuid → item) and the inverted `tagToItemIds` (tag → uuid[]) for fast tag filtering in Phase 4.
- [x] Rebuild on manual refresh via `api.rebuildIndex()`; a missing/disabled pack throws and is caught (logged, non-fatal), keeping any prior cached index. (No auto-rebuild hook wired; manual/API refresh covers the world/system-change case.)
- [x] Handle duplicate/multiple equipment packs defensively — `assembleIndex` de-dupes by uuid. (Recon locked a single pack `pf2e.equipment-srd`; the reader indexes just that pack.)

## Verification

- [x] Pure logic verified headlessly against the real bundled map (27 checks): join by uuid/slug, unmatched, tag/snippet/matchMethod carry-through, inverted-index consistency, de-dupe, and all price cases. Scale run: 3,328 total, 3,328 matched by uuid, 2,087 with tags, 21 distinct tags.
- [x] **Live check (user, v6.9.0):** `ready` log confirmed — `item index built: 2886 magical items, 2872 joined (99.5% hit rate: 2872 by uuid, 0 by slug), 14 unmatched, 1798 with tags, 21 distinct tags`. Matches Phase 2 coverage 1:1 (2872 matched / 14 untagged / 2886 live magical).
- [x] **Live check (user):** spot-check sample table + evidence snippets rendered (e.g. "Olfactory Stimulators") — `priceGp`/`tags`/`snippets` joined correctly onto the model. (Surfaced via the `debugLogging`-gated `logIndexSpotCheck`, since the console blocked pasting a query.)
- [x] **Rebuild:** `api.rebuildIndex()` reuses the same `buildItemIndex` the healthy startup runs (proven by equivalence); reference is replaced only on success, so no leak.

## Exit Criteria

- A single in-memory model per item combining compendium data + ability tags, built
  once and reused. **✅ Met — live-confirmed in the v6.9.0 world (2872/2886 joined, 99.5%).**

## Handed to Phase 4

- The item model array + the `tag → item ids` inverted index and `uuid → item` map,
  plus a lazy description fetcher for full-text search.
