# Phase 4 — Search & Filter Engine

**Goal:** A pure, UI-agnostic query engine over the Phase 3 item model: the
headline **ability-tag filter** plus supporting structured filters and full-text
search, combined with the desktop app's exact AND/OR semantics. Deterministic and
unit-tested before any UI binds to it.

**Depends on:** Phase 3 (item model, inverted tag index). Search lib: **MiniSearch**
(recon §5).

## Ability-tag filter (headline)

- [x] Multi-select over the 21 tag categories; **OR within** the selection (item matches if it has *any* selected tag).
- [x] Backed by the Phase 3 `tag → item ids` inverted index for speed.

## Supporting filters

- [x] Level range (min–max; tolerate null level).
- [x] Rarity multi-select (common/uncommon/rare/unique) — OR within.
- [x] Traits multi-select — OR within.
- [x] Price range (min–max gp); null-price items excluded from a numeric range, with an optional "include priceless" toggle (mirror desktop).

## Full-text search

- [x] MiniSearch index over `name` (+ description text, loaded lazily/once for the corpus or built on first text query).
- [x] Prefix + light fuzzy; return candidate item-id set.
- [x] Intersect the text candidates with the structured-filter result set.

## Combination semantics (mirror desktop)

- [x] **AND across categories, OR within a multi-select** (tags, rarity, traits).
- [x] Free-text set is AND-intersected with the structured result.
- [x] Empty filters → full magical list.

## Sort & result size

- [x] Sort by name / level / price / relevance (relevance = MiniSearch score when text is present).
- [x] Result cap or hooks for virtualization for large sets (UI does the virtualization in Phase 5).

## Verification

- [x] Deterministic unit tests over a **small fixture** (a handful of items with known tags/traits/levels/prices):
  - [x] each filter alone narrows correctly;
  - [x] AND-across / OR-within holds for a multi-category query;
  - [x] text ∩ structured intersection is correct;
  - [x] sorts are stable; priceless handling matches spec.
- [x] Engine has no Foundry/DOM dependencies (runs in the test runner headless).

## Exit Criteria

- Deterministic unit tests over a small fixture confirm each filter and the AND/OR semantics.

## Handed to Phase 5

- A `query(filterState) → sorted item[]` API + the option lists (tags, traits,
  rarities) for the UI to render controls against.
