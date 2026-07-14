import MiniSearch from "minisearch";
import { MODULE_ID, REQUIRED_SYSTEM_ID } from "./constants.js";
import { MagicItemFinderApp } from "./apps/search-app.js";
import { loadTagMap, warnOnSystemVersionMismatch, type TagMap } from "./data/tag-map.js";
import { computeCoverage, logCoverage, type CoverageReport } from "./data/coverage.js";
import {
  buildItemIndex,
  fetchItemDescription,
  logIndexSpotCheck,
  logItemIndex,
  type ItemIndex,
} from "./data/item-index.js";
import { createSearchEngine, type SearchEngine } from "./search/query-engine.js";
import { registerPresetSetting } from "./data/presets.js";

/** Public API hung off the module entry so macros/other code can open the app. */
interface ModuleApi {
  open: () => MagicItemFinderApp;
  MiniSearch: typeof MiniSearch;
  /** The parsed tag map (uuid → tags/snippets/method + category dictionary). */
  tagMap: TagMap | null;
  /** The last coverage report computed at `ready` (null until then / on failure). */
  coverage: CoverageReport | null;
  /** The in-memory item index (compendium data + joined tags); null until built. */
  itemIndex: ItemIndex | null;
  /**
   * The Phase 4 search/filter engine bound to the current index (null until the
   * index is built). Rebuilt alongside the index. Phase 5's UI binds to
   * `searchEngine.query(filterState)` and renders controls from
   * `searchEngine.options`.
   */
  searchEngine: SearchEngine | null;
  /** Rebuild the item index from the live pack (world/system change or manual refresh). */
  rebuildIndex: () => Promise<ItemIndex | null>;
  /** Lazily fetch an item's description HTML by uuid (deferred out of the index). */
  fetchDescription: (uuid: string) => Promise<string | null>;
}

let appInstance: MagicItemFinderApp | null = null;

/** Populated at `ready`; also mirrored onto the module API for the index to join on. */
let tagMap: TagMap | null = null;

/** The built item index, cached and reused across the session. */
let itemIndex: ItemIndex | null = null;

/** The search engine bound to {@link itemIndex}; rebuilt whenever it is. */
let searchEngine: SearchEngine | null = null;

/** Resolve the module API object (created at init), or null if not ready yet. */
function moduleApi(): ModuleApi | undefined {
  return (game.modules?.get(MODULE_ID) as unknown as { api?: ModuleApi } | undefined)?.api;
}

/** Set the module API's `tagMap`/`coverage` fields (the object is created at init). */
function publishData(map: TagMap | null, coverage: CoverageReport | null): void {
  const api = moduleApi();
  if (!api) return;
  api.tagMap = map;
  api.coverage = coverage;
}

/** Open (or focus) the search window. */
function openSearchApp(): MagicItemFinderApp {
  if (game.system?.id !== REQUIRED_SYSTEM_ID) {
    ui.notifications?.warn(
      game.i18n?.localize("PF2E_MAGIC_ITEM_FINDER.Notify.WrongSystem") ?? "",
    );
  }
  appInstance ??= new MagicItemFinderApp();
  void appInstance.render({ force: true });
  return appInstance;
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  // Placeholder client-scoped setting; presets (Phase 6) extend this namespace.
  game.settings?.register(MODULE_ID, "debugLogging", {
    name: "PF2E_MAGIC_ITEM_FINDER.Settings.DebugLogging.Name",
    hint: "PF2E_MAGIC_ITEM_FINDER.Settings.DebugLogging.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  // Phase 6: per-user named filter presets (client-scoped, hidden from config).
  registerPresetSetting();

  // Expose the API on the module entry (game.modules.get(id).api). The data
  // fields are filled in at `ready` once the tag map is fetched.
  const api: ModuleApi = {
    open: openSearchApp,
    MiniSearch,
    tagMap: null,
    coverage: null,
    itemIndex: null,
    searchEngine: null,
    rebuildIndex: buildAndPublishIndex,
    fetchDescription: fetchItemDescription,
  };
  const mod = game.modules?.get(MODULE_ID);
  if (mod) (mod as unknown as { api: ModuleApi }).api = api;
});

Hooks.once("ready", () => {
  if (game.system?.id !== REQUIRED_SYSTEM_ID) {
    console.warn(
      `${MODULE_ID} | active system is "${game.system?.id}", expected "${REQUIRED_SYSTEM_ID}"; controls disabled.`,
    );
    return;
  }
  console.log(`${MODULE_ID} | ready (MiniSearch v${(MiniSearch as unknown as { version?: string }).version ?? "bundled"})`);

  // Fire-and-forget: load the bundled tag map, then report coverage against the
  // live compendium. Failures are logged, never fatal to module startup.
  void initTagData();
});

/**
 * Load + validate the bundled tag map, warn on a PF2e version mismatch, publish
 * it on the module API, and log a coverage report against the live pack. Any
 * failure is isolated (logged, non-fatal) so the module still enables.
 */
async function initTagData(): Promise<void> {
  try {
    tagMap = await loadTagMap();
    warnOnSystemVersionMismatch(tagMap, game.system?.version, /* notify */ true);
    publishData(tagMap, null);
    console.log(
      `${MODULE_ID} | tag map loaded: ${tagMap.itemCount} items, ` +
        `${tagMap.categories.length} categories (built for PF2e ${tagMap.pf2eSystemVersion})`,
    );
  } catch (err) {
    console.error(`${MODULE_ID} | tag map failed to load`, err);
    return;
  }

  try {
    const coverage = await computeCoverage(tagMap);
    publishData(tagMap, coverage);
    logCoverage(coverage, tagMap);
  } catch (err) {
    console.error(`${MODULE_ID} | coverage report failed`, err);
  }

  // Build the item index (Phase 3): the data layer Phase 4/5 query.
  await buildAndPublishIndex();
}

/**
 * Build the item index from the loaded tag map + live pack, cache it, publish it
 * on the API, and log its size/hit rate. Isolated (logged, non-fatal). Also the
 * `api.rebuildIndex` entry point: on failure the previously cached index is kept
 * (the reference is only replaced on a successful build, so nothing leaks).
 */
async function buildAndPublishIndex(): Promise<ItemIndex | null> {
  if (!tagMap) {
    console.warn(`${MODULE_ID} | cannot build item index: tag map not loaded`);
    return null;
  }
  try {
    itemIndex = await buildItemIndex(tagMap);
    // Bind the Phase 4 engine to the fresh index. Categories come from the tag
    // dictionary so the UI can offer all 21 even if some carry no items;
    // descriptions stay lazy (Phase 5 folds them into full-text on demand).
    searchEngine = createSearchEngine(itemIndex, {
      categories: tagMap.categories.map((c) => c.name),
    });
    const api = moduleApi();
    if (api) {
      api.itemIndex = itemIndex;
      api.searchEngine = searchEngine;
    }
    logItemIndex(itemIndex);
    // Opt-in spot-check table (module settings → "Debug logging"), so the join
    // can be verified from the console log without typing any query.
    if (game.settings?.get(MODULE_ID, "debugLogging")) logIndexSpotCheck(itemIndex);
    // Live-update an already-open window so its option lists/results reflect the
    // rebuilt index (Phase 5: "live-update tag/trait/rarity option lists").
    appInstance?.onIndexRebuilt();
    return itemIndex;
  } catch (err) {
    console.error(`${MODULE_ID} | item index build failed`, err);
    return null;
  }
}

/** Resolve a render-hook `html` payload (jQuery in v12, HTMLElement in v13+). */
function rootElement(html: unknown): HTMLElement | null {
  if (html instanceof HTMLElement) return html;
  const jq = html as { 0?: unknown } | null | undefined;
  if (jq && jq[0] instanceof HTMLElement) return jq[0];
  return null;
}

/**
 * Inject a button into the Compendium sidebar's header, next to PF2e's filter
 * control. Shared by both the v12 and v13+ render hooks below.
 */
function injectCompendiumButton(app: unknown, html: unknown): void {
  try {
    if (game.system?.id !== REQUIRED_SYSTEM_ID) return;
    const a = app as { tabName?: string; id?: string } | null;
    if (a?.tabName !== "compendium" && a?.id !== "compendium") return;

    const root = rootElement(html);
    if (!root) return;
    // Idempotent: both render hooks fire on every re-render. Match by class
    // only (not tag) — the button is an <a> on v12 but a <button> on v13+.
    if (root.querySelector(`.${MODULE_ID}-open`)) return;

    // Locate the search-control container. v12 (ApplicationV1) wraps the
    // controls in `.directory-header .header-search`; v13+ (ApplicationV2)
    // rebuilt it as a bare `<search>` element with no class.
    const headerSearch = root.querySelector<HTMLElement>(
      ".directory-header .header-search, .directory-header search",
    );
    if (!headerSearch) return;

    // The filter control is an `<i class="filter">` funnel on v12 but an
    // `<button class="inline-control filter …">` on v13+.
    const filterCtrl = headerSearch.querySelector<HTMLElement>("i.filter, button.filter");
    const tooltip =
      game.i18n?.localize("PF2E_MAGIC_ITEM_FINDER.Control.Open") ?? "Magic Item Finder";

    let btn: HTMLElement;
    if (filterCtrl?.tagName === "BUTTON") {
      // v13+ ApplicationV2: mirror the sibling `inline-control` buttons, whose
      // icon comes from Font Awesome classes on the button itself (no child <i>).
      btn = document.createElement("button");
      (btn as HTMLButtonElement).type = "button";
      btn.className = `inline-control icon fa-solid fa-wand-magic-sparkles ${MODULE_ID}-open`;
      btn.setAttribute("aria-label", tooltip);
    } else {
      // v12 ApplicationV1 markup.
      btn = document.createElement("a");
      btn.className = `header-control ${MODULE_ID}-open`;
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i>`;
    }
    btn.setAttribute("data-tooltip", tooltip);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      openSearchApp();
    });

    // Place it immediately after the filter control.
    if (filterCtrl) filterCtrl.insertAdjacentElement("afterend", btn);
    else headerSearch.prepend(btn);
  } catch (err) {
    console.error(`${MODULE_ID} | failed to add compendium button`, err);
  }
}

// `renderSidebarTab` is the v12 (ApplicationV1) sidebar-tab render hook; PF2e's
// CompendiumDirectory subclass fires it via the base SidebarTab class. v13+
// rebuilt the sidebar on ApplicationV2, which does not fire `renderSidebarTab`
// at all — instead every ApplicationV2 instance (regardless of subclass name,
// which PF2e changes across versions) fires the generic `renderApplicationV2`
// hook. Registering on both covers v12 through v14 without depending on a
// specific subclass name. fvtt-types models render hooks per app-class rather
// than these generic ones, so cast inline (kept bound to Hooks).
(Hooks.on as (hook: string, fn: (app: unknown, html: unknown) => void) => number)(
  "renderSidebarTab",
  injectCompendiumButton,
);
(Hooks.on as (hook: string, fn: (app: unknown, html: unknown) => void) => number)(
  "renderApplicationV2",
  injectCompendiumButton,
);
