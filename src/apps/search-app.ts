import { MODULE_ID } from "../constants.js";
import { fetchItemDescription, type IndexedItem } from "../data/item-index.js";
import {
  coerceAppliedState,
  deletePreset,
  getPreset,
  listPresets,
  renamePreset,
  savePreset,
} from "../data/presets.js";
import { buildExportRows, downloadCsv, downloadJson } from "../data/export.js";
import type {
  FilterState,
  FilterOptionLists,
  QueryResult,
  SearchEngine,
  SortField,
} from "../search/query-engine.js";

// Foundry's ApplicationV2 + Handlebars mixin live on the global `foundry`
// namespace at runtime (v12+). Grab them lazily inside the class factory so the
// reference resolves after Foundry has booted.
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Rows-per-page choices offered in the pagination bar. */
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

/** Default page size, applied until the user picks another option. */
const DEFAULT_PAGE_SIZE = 50;

/** Search-input debounce (ms) — one query per typing burst (recon/Phase 5). */
const SEARCH_DEBOUNCE_MS = 250;

/** Canonical PF2e rarity order for the rarity chip row. */
const RARITY_ORDER = ["common", "uncommon", "rare", "unique"] as const;

/** Resolve the module's live search engine, or null before the index is built. */
function currentEngine(): SearchEngine | null {
  const api = (game.modules?.get(MODULE_ID) as unknown as { api?: { searchEngine?: SearchEngine | null } } | undefined)
    ?.api;
  return api?.searchEngine ?? null;
}

/** Enrich description HTML (inline links, etc.). Falls back to the raw HTML. */
async function enrichDescription(html: string): Promise<string> {
  try {
    const TE =
      (foundry as unknown as { applications?: { ux?: { TextEditor?: { implementation?: unknown } } } })
        .applications?.ux?.TextEditor?.implementation ??
      (globalThis as unknown as { TextEditor?: unknown }).TextEditor;
    const enrich = (TE as { enrichHTML?: (h: string, o?: object) => Promise<string> } | undefined)?.enrichHTML;
    if (enrich) return await enrich.call(TE, html, { async: true });
  } catch (err) {
    console.warn(`${MODULE_ID} | description enrich failed`, err);
  }
  return html;
}

/** Format a gp-equivalent price for display. Priceless (null) → an em dash. */
function formatPrice(gp: number | null): string {
  if (gp == null) return "—";
  // Trim to at most 2 decimals, drop trailing zeros, then group thousands.
  const rounded = Math.round(gp * 100) / 100;
  const [intPart, fracPart] = rounded.toString().split(".");
  const grouped = Number(intPart).toLocaleString("en-US");
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  return `${body} gp`;
}

/** Title-case a rarity slug for display ("uncommon" → "Uncommon"). */
function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Minimal HTML escape for values interpolated into dialog markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Localize with an inline English fallback (keeps the app usable pre-i18n). */
function t(key: string, fallback: string, data?: Record<string, string | number>): string {
  const i18n = game.i18n;
  if (!i18n) return fallback;
  if (!data) return i18n.localize(key);
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) stringData[k] = String(v);
  return i18n.format(key, stringData);
}

/**
 * Prompt for a single line of text via a Foundry {@link Dialog} (v12+). Resolves
 * to the entered string, or null if the user cancels / closes the dialog. Falls
 * back to `window.prompt` if the Dialog class is unavailable.
 */
async function promptForText(title: string, okLabel: string, initial: string): Promise<string | null> {
  const DialogCtor = (globalThis as unknown as {
    Dialog?: new (opts: object) => { render: (force: boolean) => void };
  }).Dialog;
  if (!DialogCtor) {
    const v = globalThis.prompt?.(title, initial);
    return v ?? null;
  }
  const content =
    `<form class="pf2e-mif-dialog-form" autocomplete="off">` +
    `<input type="text" name="value" value="${escapeHtml(initial)}" autofocus ` +
    `placeholder="${escapeHtml(title)}" /></form>`;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (v: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    new DialogCtor({
      title,
      content,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: okLabel,
          callback: (html: unknown) => {
            const root = html instanceof HTMLElement ? html : (html as { 0?: HTMLElement })[0];
            const input = root?.querySelector?.("input[name='value']") as HTMLInputElement | null;
            done(input?.value ?? null);
          },
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: t("PF2E_MAGIC_ITEM_FINDER.Preset.Cancel", "Cancel"),
          callback: () => done(null),
        },
      },
      default: "ok",
      close: () => done(null),
    }).render(true);
  });
}

/** Yes/no confirmation via {@link Dialog.confirm}, falling back to `window.confirm`. */
async function confirmDialog(title: string, content: string): Promise<boolean> {
  const DialogCtor = (globalThis as unknown as {
    Dialog?: { confirm?: (opts: object) => Promise<boolean> };
  }).Dialog;
  if (DialogCtor?.confirm) return await DialogCtor.confirm({ title, content });
  return globalThis.confirm?.(content) ?? false;
}

/** Sort state for one clickable results-column header. */
interface SortHeaderVM {
  active: boolean;
  asc: boolean;
  desc: boolean;
}

/** One results-row view model. */
interface RowVM {
  uuid: string;
  name: string;
  level: number;
  rarity: string;
  rarityLabel: string;
  price: string;
  traits: string;
  img: string | null;
  selected: boolean;
}

/** Detail-pane view model for the selected item. */
interface DetailVM {
  uuid: string;
  name: string;
  img: string | null;
  level: number;
  rarity: string;
  rarityLabel: string;
  price: string;
  meta: string;
  source: string | null;
  traits: string[];
  tags: { name: string; snippet: string | null; method: string | null }[];
  hasTags: boolean;
  descriptionHtml: string | null;
}

/**
 * Phase 5 — the real search window. An `ApplicationV2` with a filter **sidebar**
 * (ability-tag chips first), a **results** list, and a **detail** pane, wired to
 * the Phase 4 {@link SearchEngine}. Filter changes re-render only the results
 * part (keeping the search box focused); selecting a row re-renders only the
 * detail part. Rows open their item sheet and drag onto sheets/canvas.
 */
export class MagicItemFinderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static override DEFAULT_OPTIONS = {
    id: MODULE_ID,
    classes: [MODULE_ID],
    tag: "div",
    window: {
      title: "PF2E_MAGIC_ITEM_FINDER.App.Title",
      icon: "fa-solid fa-wand-magic-sparkles",
      resizable: true,
    },
    position: { width: 1040, height: 700 },
    actions: {
      toggleTag: MagicItemFinderApp.#onToggleTag,
      toggleRarity: MagicItemFinderApp.#onToggleRarity,
      toggleTrait: MagicItemFinderApp.#onToggleTrait,
      toggleWeaponGroup: MagicItemFinderApp.#onToggleWeaponGroup,
      toggleArmorCategory: MagicItemFinderApp.#onToggleArmorCategory,
      sortColumn: MagicItemFinderApp.#onSortColumn,
      clearFilters: MagicItemFinderApp.#onClearFilters,
      selectItem: MagicItemFinderApp.#onSelectItem,
      openItem: MagicItemFinderApp.#onOpenItem,
      firstPage: MagicItemFinderApp.#onFirstPage,
      prevPage: MagicItemFinderApp.#onPrevPage,
      nextPage: MagicItemFinderApp.#onNextPage,
      lastPage: MagicItemFinderApp.#onLastPage,
      savePreset: MagicItemFinderApp.#onSavePreset,
      renamePreset: MagicItemFinderApp.#onRenamePreset,
      deletePreset: MagicItemFinderApp.#onDeletePreset,
      exportCsv: MagicItemFinderApp.#onExportCsv,
      exportJson: MagicItemFinderApp.#onExportJson,
    },
  };

  static override PARTS = {
    sidebar: { template: `modules/${MODULE_ID}/templates/parts/sidebar.hbs` },
    results: { template: `modules/${MODULE_ID}/templates/parts/results.hbs` },
    detail: { template: `modules/${MODULE_ID}/templates/parts/detail.hbs` },
  };

  /** Current composed filter state. Mutated in place by the control handlers. */
  #filter: FilterState = {};

  /** The uuid of the selected row (detail pane), or null. */
  #selectedUuid: string | null = null;

  /** Name of the last applied/saved preset (the rename/delete target), or null.
   * Purely a UI marker — manual filter edits don't clear it, mirroring how a
   * preset dropdown keeps showing the loaded preset's name. */
  #activePreset: string | null = null;

  /** Cached last query result; recomputed when {@link #resultDirty}. */
  #lastResult: QueryResult = { items: [], total: 0 };

  /** 0-based current page within the filtered/sorted result set. */
  #page = 0;

  /** Rows per page; one of {@link PAGE_SIZE_OPTIONS}. */
  #pageSize: number = DEFAULT_PAGE_SIZE;

  /** uuids currently shown (result order), for keyboard navigation. */
  #shownUuids: string[] = [];

  /** Set when the filter changes so the next results render re-queries. */
  #resultDirty = true;

  /** uuid → enriched description HTML, memoized for the detail pane. */
  #descriptionCache = new Map<string, string | null>();

  /** Pending debounce timer for the search input. */
  #searchTimer: number | null = null;

  /** The root element the delegated (non-click) listeners are bound to, or null.
   * Foundry builds a *new* frame element (and re-binds only its `data-action`
   * clicks) whenever the app is rendered for the first time after a close, so a
   * plain "wired once" boolean would leave a reopened window with dead
   * change/input/keyboard/drag listeners. Tracking the actual element lets us
   * re-bind whenever the frame is a different node. */
  #wiredEl: HTMLElement | null = null;

  /** Drag-adjusted column widths (px), applied to `.window-content` as CSS vars
   * and re-applied after any full re-render. Null = use the CSS default. */
  #sidebarW: number | null = null;
  #detailW: number | null = null;

  // ---- context -------------------------------------------------------------

  override async _prepareContext(_options: unknown): Promise<object> {
    const engine = currentEngine();
    if (!engine) {
      return { ready: false };
    }
    const options = engine.options;
    const result = this.#result(engine);
    return {
      ready: true,
      filter: this.#filter,
      sidebar: this.#sidebarContext(options),
      results: this.#resultsContext(result),
      detail: await this.#detailContext(),
    };
  }

  /** Run (or reuse) the query for the current filter state, one page at a time. */
  #result(engine: SearchEngine): QueryResult {
    if (this.#resultDirty) {
      this.#lastResult = this.#queryPage(engine, this.#page);
      // Clamp to the last valid page once the true total is known — a filter
      // change or a live index rebuild can shrink the set out from under the
      // page the user was viewing.
      const maxPage = this.#maxPage(this.#lastResult.total);
      if (this.#page > maxPage) {
        this.#page = maxPage;
        this.#lastResult = this.#queryPage(engine, this.#page);
      }
      this.#shownUuids = this.#lastResult.items.map((i) => i.uuid);
      this.#resultDirty = false;
    }
    return this.#lastResult;
  }

  #queryPage(engine: SearchEngine, page: number): QueryResult {
    return engine.query(this.#filter, { limit: this.#pageSize, offset: page * this.#pageSize });
  }

  /** Last valid 0-based page index for a given total (0 when there are no results). */
  #maxPage(total: number): number {
    return total === 0 ? 0 : Math.floor((total - 1) / this.#pageSize);
  }

  /** Build the sidebar's option lists + active-selection flags. */
  #sidebarContext(options: FilterOptionLists): object {
    const selTags = new Set(this.#filter.tags ?? []);
    const selRarities = new Set(this.#filter.rarities ?? []);
    const selTraits = new Set(this.#filter.traits ?? []);
    const selWeaponGroups = new Set(this.#filter.weaponGroups ?? []);
    const selArmorCategories = new Set(this.#filter.armorCategories ?? []);
    const presets = listPresets();
    const hasActive = this.#activePreset != null && presets.some((p) => p.name === this.#activePreset);
    return {
      presets: presets.map((p) => ({ name: p.name, selected: p.name === this.#activePreset })),
      hasPresets: presets.length > 0,
      hasActivePreset: hasActive,
      tags: options.tags.map((t) => ({ ...t, active: selTags.has(t.name) })),
      rarities: RARITY_ORDER.filter((r) => options.rarities.includes(r)).map((r) => ({
        value: r,
        label: titleCase(r),
        active: selRarities.has(r),
      })),
      traits: options.traits.map((t) => ({ value: t, selected: selTraits.has(t) })),
      weaponGroups: options.weaponGroups.map((g) => ({
        value: g,
        label: titleCase(g),
        active: selWeaponGroups.has(g),
      })),
      hasWeaponGroups: options.weaponGroups.length > 0,
      armorCategories: options.armorCategories.map((c) => ({
        value: c,
        label: titleCase(c),
        active: selArmorCategories.has(c),
      })),
      hasArmorCategories: options.armorCategories.length > 0,
      levelRange: options.levelRange,
      priceRange: options.priceRange,
      minLevel: this.#filter.minLevel ?? "",
      maxLevel: this.#filter.maxLevel ?? "",
      minPriceGp: this.#filter.minPriceGp ?? "",
      maxPriceGp: this.#filter.maxPriceGp ?? "",
      includePriceless: this.#filter.includePriceless ?? false,
      text: this.#filter.text ?? "",
    };
  }

  /** Build the results rows + counts + pagination context. */
  #resultsContext(result: QueryResult): object {
    const rows: RowVM[] = result.items.map((item) => this.#rowVM(item));
    const totalPages = Math.max(1, Math.ceil(result.total / this.#pageSize));
    return {
      rows,
      total: result.total,
      empty: result.total === 0,
      page: this.#page + 1,
      totalPages,
      pageSizeOptions: PAGE_SIZE_OPTIONS.map((n) => ({ value: n, selected: n === this.#pageSize })),
      canPrev: this.#page > 0,
      canNext: this.#page < totalPages - 1,
      sort: this.#sortHeaders(),
    };
  }

  /** Per-column sort state for the clickable result headers. The effective field
   * mirrors the engine's default (relevance while searching, else name). */
  #sortHeaders(): { name: SortHeaderVM; level: SortHeaderVM; price: SortHeaderVM } {
    const active: SortField = this.#filter.sort ?? (this.#filter.text ? "relevance" : "name");
    const dir = this.#filter.sortDir ?? "asc";
    const header = (field: SortField): SortHeaderVM => ({
      active: field === active,
      asc: field === active && dir === "asc",
      desc: field === active && dir === "desc",
    });
    return { name: header("name"), level: header("level"), price: header("price") };
  }

  #rowVM(item: IndexedItem): RowVM {
    return {
      uuid: item.uuid,
      name: item.name,
      level: item.level,
      rarity: item.rarity,
      rarityLabel: titleCase(item.rarity),
      price: formatPrice(item.priceGp),
      traits: item.traits.join(", "),
      img: item.img,
      selected: item.uuid === this.#selectedUuid,
    };
  }

  /** Build the detail-pane VM for the selected item (null when none selected). */
  async #detailContext(): Promise<DetailVM | null> {
    if (!this.#selectedUuid) return null;
    const engine = currentEngine();
    const item = engine
      ? (this.#lastResult.items.find((i) => i.uuid === this.#selectedUuid) ??
        this.#lookup(this.#selectedUuid))
      : null;
    if (!item) return null;

    const descriptionHtml = await this.#description(item.uuid);
    const metaParts = [`Level ${item.level}`, titleCase(item.rarity)];
    const price = formatPrice(item.priceGp);
    if (price !== "—") metaParts.push(price);

    return {
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      level: item.level,
      rarity: item.rarity,
      rarityLabel: titleCase(item.rarity),
      price,
      meta: metaParts.join(" · "),
      source: item.source,
      traits: item.traits,
      tags: item.tags.map((name) => ({
        name,
        snippet: item.snippets[name] ?? null,
        method: item.matchMethod[name] ?? null,
      })),
      hasTags: item.tags.length > 0,
      descriptionHtml,
    };
  }

  /** Resolve an item by uuid from the live index (for out-of-page selection). */
  #lookup(uuid: string): IndexedItem | null {
    const api = (game.modules?.get(MODULE_ID) as unknown as {
      api?: { itemIndex?: { byUuid?: Map<string, IndexedItem> } | null };
    } | undefined)?.api;
    return api?.itemIndex?.byUuid?.get(uuid) ?? null;
  }

  /** Fetch + enrich (and memoize) an item's description HTML. */
  async #description(uuid: string): Promise<string | null> {
    if (this.#descriptionCache.has(uuid)) return this.#descriptionCache.get(uuid) ?? null;
    const raw = await fetchItemDescription(uuid);
    const html = raw ? await enrichDescription(raw) : null;
    this.#descriptionCache.set(uuid, html);
    return html;
  }

  // ---- render + listeners --------------------------------------------------

  override async _onRender(context: object, options: object): Promise<void> {
    await super._onRender?.(context as never, options as never);
    this.#wireDelegated();
    this.#applyWidths();
  }

  /** Re-apply drag-adjusted column widths to `.window-content` after a render. */
  #applyWidths(): void {
    const content = this.#contentEl();
    if (!content) return;
    if (this.#sidebarW != null) content.style.setProperty("--pf2e-mif-sidebar-w", `${this.#sidebarW}px`);
    if (this.#detailW != null) content.style.setProperty("--pf2e-mif-detail-w", `${this.#detailW}px`);
  }

  /** The grid container that carries the column-width CSS variables. */
  #contentEl(): HTMLElement | null {
    const root = this.element;
    return root instanceof HTMLElement ? root.querySelector<HTMLElement>(".window-content") : null;
  }

  /** Begin a splitter drag: track the pointer and resize the grabbed column. */
  #beginResize(kind: "sidebar" | "detail", ev: PointerEvent): void {
    const content = this.#contentEl();
    if (!content) return;
    ev.preventDefault();
    const rect = content.getBoundingClientRect();
    // Keep the middle (results) column at least this wide.
    const RESULTS_MIN = 320;
    const onMove = (e: PointerEvent) => {
      if (kind === "sidebar") {
        const max = Math.max(180, rect.width - RESULTS_MIN - (this.#detailW ?? 330));
        const w = Math.min(Math.max(e.clientX - rect.left, 180), max);
        this.#sidebarW = w;
        content.style.setProperty("--pf2e-mif-sidebar-w", `${w}px`);
      } else {
        const max = Math.max(220, rect.width - RESULTS_MIN - (this.#sidebarW ?? 250));
        const w = Math.min(Math.max(rect.right - e.clientX, 220), max);
        this.#detailW = w;
        content.style.setProperty("--pf2e-mif-detail-w", `${w}px`);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("pf2e-mif-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("pf2e-mif-resizing");
  }

  /** Attach the non-click listeners once to the stable root element. Click
   * interactions go through the framework `actions` map instead. */
  #wireDelegated(): void {
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    // Already bound to this exact frame — nothing to do. A reopened window has a
    // brand-new root element, so this correctly re-binds (the old element and
    // its listeners are discarded with the closed frame).
    if (this.#wiredEl === root) return;
    this.#wiredEl = root;

    // Debounced free-text search.
    root.addEventListener("input", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target?.dataset?.filter !== "text") return;
      const value = (target as HTMLInputElement).value;
      if (this.#searchTimer !== null) window.clearTimeout(this.#searchTimer);
      this.#searchTimer = window.setTimeout(() => {
        this.#searchTimer = null;
        this.#filter.text = value.trim() ? value : undefined;
        this.#markDirtyAndRenderResults();
      }, SEARCH_DEBOUNCE_MS);
    });

    // Committed changes on selects / number inputs / checkboxes.
    root.addEventListener("change", (ev) => {
      const target = ev.target as (HTMLInputElement | HTMLSelectElement) | null;
      // The preset dropdown applies a saved state rather than a single field.
      if (target?.dataset?.preset === "select") {
        this.#applyPreset((target as HTMLSelectElement).value);
        return;
      }
      // Page size isn't part of the filter state; it re-queries directly.
      if (target?.dataset?.pageSize === "select") {
        const n = Number((target as HTMLSelectElement).value);
        if (Number.isFinite(n) && n > 0) this.#pageSize = n;
        this.#markDirtyAndRenderResults();
        return;
      }
      const field = target?.dataset?.filter;
      if (!field) return;
      this.#applyFieldChange(field, target!);
      this.#markDirtyAndRenderResults();
    });

    // Drag a row onto a sheet/canvas (standard Foundry Item drop data).
    root.addEventListener("dragstart", (ev) => {
      const row = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-uuid]");
      if (!row || !ev.dataTransfer) return;
      const uuid = row.dataset.uuid!;
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      ev.dataTransfer.effectAllowed = "copy";
    });

    // Column-splitter drags (resize the sidebar / detail columns).
    root.addEventListener("pointerdown", (ev) => {
      const handle = (ev.target as HTMLElement | null)?.closest<HTMLElement>(".pf2e-mif-splitter");
      const kind = handle?.dataset.splitter;
      if (kind === "sidebar" || kind === "detail") this.#beginResize(kind, ev as PointerEvent);
    });

    // Double-click a row opens its sheet (single click selects → detail pane).
    root.addEventListener("dblclick", (ev) => {
      const row = (ev.target as HTMLElement | null)?.closest<HTMLElement>(".pf2e-mif-row");
      if (row?.dataset.uuid) void this.#openSheet(row.dataset.uuid);
    });

    // Keyboard navigation through the results list.
    root.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" && ev.key !== "Enter") return;
      // Ignore while typing in the search box, except Enter (which just blurs).
      const inList = (ev.target as HTMLElement | null)?.closest?.(".pf2e-mif-results");
      const inSearch = (ev.target as HTMLElement | null)?.dataset?.filter === "text";
      if (inSearch && ev.key !== "Enter") return;
      if (inSearch) return; // Enter in the search box: let the debounce handle it.
      if (!inList) return;
      this.#onListKey(ev);
    });
  }

  /** Apply a committed control change to the filter state. */
  #applyFieldChange(field: string, target: HTMLInputElement | HTMLSelectElement): void {
    switch (field) {
      case "minLevel":
      case "maxLevel":
      case "minPriceGp":
      case "maxPriceGp": {
        const raw = (target as HTMLInputElement).value.trim();
        const num = raw === "" ? undefined : Number(raw);
        // Ignore non-numeric input rather than filtering everything out on NaN.
        (this.#filter as Record<string, unknown>)[field] =
          num === undefined || Number.isNaN(num) ? undefined : num;
        break;
      }
      case "includePriceless":
        this.#filter.includePriceless = (target as HTMLInputElement).checked || undefined;
        break;
    }
  }

  /** Arrow/Enter handling within the results list. */
  #onListKey(ev: KeyboardEvent): void {
    ev.preventDefault();
    if (ev.key === "Enter") {
      if (this.#selectedUuid) void this.#openSheet(this.#selectedUuid);
      return;
    }
    const ids = this.#shownUuids;
    if (ids.length === 0) return;
    const cur = this.#selectedUuid ? ids.indexOf(this.#selectedUuid) : -1;
    const delta = ev.key === "ArrowDown" ? 1 : -1;
    const next = cur < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(Math.max(cur + delta, 0), ids.length - 1);
    this.#select(ids[next], /* scroll */ true);
  }

  /** Select a row: update highlight, scroll into view, render the detail pane. */
  #select(uuid: string, scroll = false): void {
    this.#selectedUuid = uuid;
    const root = this.element;
    if (root instanceof HTMLElement) {
      for (const row of root.querySelectorAll<HTMLElement>(".pf2e-mif-row")) {
        const on = row.dataset.uuid === uuid;
        row.classList.toggle("selected", on);
        if (on && scroll) row.scrollIntoView({ block: "nearest" });
      }
      // Keep focus on the list so arrow-key navigation continues after a click.
      const list = root.querySelector<HTMLElement>(".pf2e-mif-results");
      if (list && document.activeElement !== list) list.focus({ preventScroll: true });
    }
    void this.render({ parts: ["detail"] });
  }

  /** A filter/sort change invalidates the current page — snap back to page 1. */
  #markDirtyAndRenderResults(): void {
    this.#page = 0;
    this.#resultDirty = true;
    void this.render({ parts: ["results"] });
  }

  /** Jump to a page (clamped to 0) and re-render just the results part. */
  #goToPage(page: number): void {
    const clamped = Math.max(0, page);
    if (clamped === this.#page) return;
    this.#page = clamped;
    this.#resultDirty = true;
    void this.render({ parts: ["results"] });
  }

  /** Open an item's sheet from its uuid. */
  async #openSheet(uuid: string): Promise<void> {
    try {
      const doc = (await fromUuid(uuid)) as { sheet?: { render: (force: boolean) => unknown } } | null;
      doc?.sheet?.render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to open sheet for ${uuid}`, err);
    }
  }

  /** Called by the module when the item index (and engine) is rebuilt live. */
  onIndexRebuilt(): void {
    this.#page = 0;
    this.#resultDirty = true;
    this.#descriptionCache.clear();
    if (this.rendered) void this.render({ parts: ["sidebar", "results", "detail"] });
  }

  // ---- click actions (framework-delegated) ---------------------------------

  static #onToggleTag(this: MagicItemFinderApp, _event: Event, target: HTMLElement): void {
    const tag = target.dataset.tag;
    if (!tag) return;
    const set = new Set(this.#filter.tags ?? []);
    if (set.has(tag)) set.delete(tag);
    else set.add(tag);
    this.#filter.tags = set.size ? [...set] : undefined;
    target.classList.toggle("active", set.has(tag));
    target.setAttribute("aria-pressed", String(set.has(tag)));
    this.#markDirtyAndRenderResults();
  }

  static #onToggleRarity(this: MagicItemFinderApp, _event: Event, target: HTMLElement): void {
    const rarity = target.dataset.rarity;
    if (!rarity) return;
    const set = new Set(this.#filter.rarities ?? []);
    if (set.has(rarity)) set.delete(rarity);
    else set.add(rarity);
    this.#filter.rarities = set.size ? [...set] : undefined;
    target.classList.toggle("active", set.has(rarity));
    target.setAttribute("aria-pressed", String(set.has(rarity)));
    this.#markDirtyAndRenderResults();
  }

  static #onToggleTrait(this: MagicItemFinderApp, _event: Event, target: HTMLElement): void {
    const trait = target.dataset.trait;
    if (!trait) return;
    const set = new Set(this.#filter.traits ?? []);
    if (set.has(trait)) set.delete(trait);
    else set.add(trait);
    this.#filter.traits = set.size ? [...set] : undefined;
    target.classList.toggle("active", set.has(trait));
    target.setAttribute("aria-pressed", String(set.has(trait)));
    this.#markDirtyAndRenderResults();
  }

  static #onToggleWeaponGroup(this: MagicItemFinderApp, _event: Event, target: HTMLElement): void {
    const group = target.dataset.group;
    if (!group) return;
    const set = new Set(this.#filter.weaponGroups ?? []);
    if (set.has(group)) set.delete(group);
    else set.add(group);
    this.#filter.weaponGroups = set.size ? [...set] : undefined;
    target.classList.toggle("active", set.has(group));
    target.setAttribute("aria-pressed", String(set.has(group)));
    this.#markDirtyAndRenderResults();
  }

  static #onToggleArmorCategory(this: MagicItemFinderApp, _event: Event, target: HTMLElement): void {
    const category = target.dataset.category;
    if (!category) return;
    const set = new Set(this.#filter.armorCategories ?? []);
    if (set.has(category)) set.delete(category);
    else set.add(category);
    this.#filter.armorCategories = set.size ? [...set] : undefined;
    target.classList.toggle("active", set.has(category));
    target.setAttribute("aria-pressed", String(set.has(category)));
    this.#markDirtyAndRenderResults();
  }

  /** Click a results column header: sort by it (asc), or flip direction if it is
   * already the active sort field. */
  static #onSortColumn(this: MagicItemFinderApp, _event: Event, target: HTMLElement): void {
    const field = target.dataset.sort as SortField | undefined;
    if (field !== "name" && field !== "level" && field !== "price") return;
    const active: SortField = this.#filter.sort ?? (this.#filter.text ? "relevance" : "name");
    if (field === active) {
      this.#filter.sortDir = (this.#filter.sortDir ?? "asc") === "asc" ? "desc" : "asc";
    } else {
      this.#filter.sort = field;
      this.#filter.sortDir = "asc";
    }
    this.#markDirtyAndRenderResults();
  }

  static #onClearFilters(this: MagicItemFinderApp): void {
    this.#filter = {};
    this.#selectedUuid = null;
    this.#activePreset = null;
    this.#page = 0;
    this.#resultDirty = true;
    void this.render({ parts: ["sidebar", "results", "detail"] });
  }

  // ---- presets -------------------------------------------------------------

  /** Apply a saved preset by name (or deselect on the blank option). Unknown
   * tags/traits/rarities are dropped against the live option lists. */
  #applyPreset(name: string): void {
    if (!name) {
      // Blank "— Load a preset —" option: clear the filters (same as Clear).
      this.#filter = {};
      this.#selectedUuid = null;
      this.#activePreset = null;
      this.#page = 0;
      this.#resultDirty = true;
      void this.render({ parts: ["sidebar", "results", "detail"] });
      return;
    }
    const engine = currentEngine();
    const preset = getPreset(name);
    if (!engine || !preset) return;
    this.#filter = coerceAppliedState(preset.state, engine.options);
    this.#activePreset = preset.name;
    this.#selectedUuid = null;
    this.#page = 0;
    this.#resultDirty = true;
    void this.render({ parts: ["sidebar", "results", "detail"] });
  }

  static async #onSavePreset(this: MagicItemFinderApp): Promise<void> {
    const name = await promptForText(
      t("PF2E_MAGIC_ITEM_FINDER.Preset.SaveTitle", "Save preset"),
      t("PF2E_MAGIC_ITEM_FINDER.Preset.Save", "Save"),
      this.#activePreset ?? "",
    );
    if (name == null) return;
    try {
      const saved = await savePreset(name, this.#filter);
      this.#activePreset = saved.name;
      ui.notifications?.info(
        t("PF2E_MAGIC_ITEM_FINDER.Preset.Saved", `Preset "${saved.name}" saved.`, { name: saved.name }),
      );
      void this.render({ parts: ["sidebar"] });
    } catch (err) {
      ui.notifications?.error((err as Error).message);
    }
  }

  static async #onRenamePreset(this: MagicItemFinderApp): Promise<void> {
    if (!this.#activePreset) {
      ui.notifications?.warn(t("PF2E_MAGIC_ITEM_FINDER.Preset.SelectFirst", "Select a preset first."));
      return;
    }
    const from = this.#activePreset;
    const name = await promptForText(
      t("PF2E_MAGIC_ITEM_FINDER.Preset.RenameTitle", "Rename preset"),
      t("PF2E_MAGIC_ITEM_FINDER.Preset.Rename", "Rename"),
      from,
    );
    if (name == null) return;
    try {
      await renamePreset(from, name);
      this.#activePreset = name.trim();
      void this.render({ parts: ["sidebar"] });
    } catch (err) {
      ui.notifications?.error((err as Error).message);
    }
  }

  static async #onDeletePreset(this: MagicItemFinderApp): Promise<void> {
    if (!this.#activePreset) {
      ui.notifications?.warn(t("PF2E_MAGIC_ITEM_FINDER.Preset.SelectFirst", "Select a preset first."));
      return;
    }
    const name = this.#activePreset;
    const ok = await confirmDialog(
      t("PF2E_MAGIC_ITEM_FINDER.Preset.DeleteTitle", "Delete preset"),
      t("PF2E_MAGIC_ITEM_FINDER.Preset.DeleteConfirm", `Delete the preset "${name}"?`, { name }),
    );
    if (!ok) return;
    await deletePreset(name);
    // Deleting the active preset must NOT clear the current filters — only the
    // dropdown selection is reset.
    this.#activePreset = null;
    void this.render({ parts: ["sidebar"] });
  }

  // ---- export --------------------------------------------------------------

  static #onExportCsv(this: MagicItemFinderApp): void {
    this.#export("csv");
  }

  static #onExportJson(this: MagicItemFinderApp): void {
    this.#export("json");
  }

  /** Export the *current filtered set* (uncapped, in sort order) to CSV or JSON. */
  #export(kind: "csv" | "json"): void {
    const engine = currentEngine();
    if (!engine) return;
    // No limit: the full filtered set, not the DOM-capped view.
    const items = engine.query(this.#filter).items;
    if (items.length === 0) {
      ui.notifications?.warn(t("PF2E_MAGIC_ITEM_FINDER.Export.Empty", "Nothing to export."));
      return;
    }
    const rows = buildExportRows(items);
    if (kind === "csv") downloadCsv(rows);
    else downloadJson(rows);
    ui.notifications?.info(
      t("PF2E_MAGIC_ITEM_FINDER.Export.Done", `Exported ${rows.length} items.`, { count: rows.length }),
    );
  }

  static #onSelectItem(this: MagicItemFinderApp, _event: Event, target: HTMLElement): void {
    const uuid = target.closest<HTMLElement>("[data-uuid]")?.dataset.uuid;
    if (uuid) this.#select(uuid);
  }

  static #onOpenItem(this: MagicItemFinderApp, event: Event, target: HTMLElement): void {
    event.stopPropagation();
    const uuid = target.closest<HTMLElement>("[data-uuid]")?.dataset.uuid;
    if (uuid) void this.#openSheet(uuid);
  }

  // ---- pagination ------------------------------------------------------------

  static #onFirstPage(this: MagicItemFinderApp): void {
    this.#goToPage(0);
  }

  static #onPrevPage(this: MagicItemFinderApp): void {
    this.#goToPage(this.#page - 1);
  }

  static #onNextPage(this: MagicItemFinderApp): void {
    this.#goToPage(this.#page + 1);
  }

  static #onLastPage(this: MagicItemFinderApp): void {
    this.#goToPage(this.#maxPage(this.#lastResult.total));
  }
}
