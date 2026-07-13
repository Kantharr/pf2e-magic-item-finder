# Phase 5 — Standalone Window UI

**Goal:** The real window: an `ApplicationV2` with a filter sidebar (ability-tag
chips first), a results list, and a detail view — wired to the Phase 4 engine and
integrated with Foundry (open sheet, drag to sheet/canvas). This is where a GM
actually uses the module end-to-end.

**Depends on:** Phase 4 (query API + option lists), Phase 1 (window shell).

## Window & layout

- [x] `ApplicationV2` + `HandlebarsApplicationMixin`: filter **sidebar** + **results** split, resizable. Three-part layout (sidebar/results/detail) via `PARTS`; CSS grid on `.window-content`. ([src/apps/search-app.ts](../src/apps/search-app.ts))
- [x] Filter sidebar, ability-tag chips **first/most prominent**, then rarity, level range, price range, traits, and a "Clear filters" button. ([templates/parts/sidebar.hbs](../templates/parts/sidebar.hbs))
- [x] Results list columns: **Name | Level | Rarity | Price | Traits** (sticky header, tabular numerics). ([templates/parts/results.hbs](../templates/parts/results.hbs))
- [x] Detail pane/section for the selected item. ([templates/parts/detail.hbs](../templates/parts/detail.hbs))

## Rendering & styling

- [x] Rarity color-coding matching the desktop app: Common neutral / Uncommon green / Rare blue / Unique pink — left-accent + translucent row tint + rarity dot.
- [x] Detail view shows the item's **matched ability tags + their snippets** (the tagging payload from Phase 2/3), plus level/price/traits/source and enriched description (`TextEditor.enrichHTML`).
- [x] Theme-aware styling: surfaces/borders derived from `currentColor` via `color-mix`, text inherited from Foundry's window content — no hard-coded page bg/text. ([styles/module.css](../styles/module.css))
- [x] Cap the results list at 500 rendered rows with an uncapped "showing N of M" footer (smooth scroll over the full ~3,300-item set without a virtualizer).

## Interaction

- [x] Debounced search input (250 ms) → Phase 4 query → re-render **results** part only (keeps the search box focused).
- [x] Click a result → **select** (detail pane); double-click / Enter / per-row open icon / detail "Open sheet" button → open its **item sheet** (`fromUuid` → `sheet.render(true)`). *(Single-click selects rather than opens so the detail pane stays useful; opening has four explicit affordances.)*
- [x] **Drag** a result onto a character sheet / canvas (standard Foundry drag-data `{ type: "Item", uuid }`).
- [x] Keyboard navigation (arrow up/down through results, Enter to open); list focused on click so arrows work immediately.
- [x] Live-update tag/trait/rarity option lists from the index (`onIndexRebuilt` re-renders an open window after `api.rebuildIndex`).

## Verification

Static verification: `npm run typecheck` clean, `npm test` 22/22, `npm run build` OK, deployed to the live modules folder. **Live-confirmed by the user** in the running Foundry v12 / PF2e v6.9.0 world (*Strength of Thousands*):

- [x] Open window in a PF2e world; filter by an ability tag → results narrow correctly.
- [x] Detail view shows matched tags + snippets for a selected item.
- [x] Click opens the sheet; drag creates the item on a sheet/canvas.
- [x] Dark and light themes both render legibly; rarity colors correct.
- [x] Actually launch and exercise the UI (not just build) — verify no binding/render errors in console.

### Post-verification tweaks (user-requested)

- Ability tags + traits both render as **toggle-chip buttons** in bounded, drag-resizable scroll boxes (traits converted from a `<select multiple>`; `toggleTrait` action mirrors `toggleTag`/`toggleRarity`).
- Ability-tag chips show the tag name only (counts removed; zero-item tags still dimmed via `data-empty`).
- Draggable **column splitters** between sidebar/results/detail (custom-property widths on `.window-content`, re-applied after re-render). Outer window keeps Foundry's native bottom-right resize.

## Exit Criteria

- A GM can open the window, filter by ability tag, and act on a result (open/drag) end-to-end.

## Handed to Phase 6

- The live filter-state object (rarities/traits/tags/ranges) to serialize as presets,
  and the current result set to export.
