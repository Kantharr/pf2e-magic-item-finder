import MiniSearch from "minisearch";
import type { IndexedItem, ItemIndex } from "../data/item-index.js";

/**
 * Phase 4 — the pure, UI-agnostic search/filter engine over the Phase 3 item
 * model. It combines the headline ability-tag filter with the supporting
 * structured filters and MiniSearch full-text, with these
 * combination semantics: **AND across categories, OR within a multi-select**,
 * with the free-text candidate set AND-intersected onto the structured result.
 *
 * No Foundry/DOM dependencies: {@link createSearchEngine} takes a plain
 * {@link ItemIndex} (and optional description text) and is fully unit-testable
 * in a headless runner. Phase 5 binds UI controls to {@link SearchEngine.query}
 * and renders selectors from {@link SearchEngine.options}.
 */

/** Sortable result orderings. `relevance` is only meaningful when text is present. */
export type SortField = "name" | "level" | "price" | "relevance";
export type SortDir = "asc" | "desc";

/** The composed filter state for a single query. Every field is optional; an
 * all-empty state matches the full magical list. */
export interface FilterState {
  /** Free-text query (name + description). Blank = no text filter. */
  text?: string;
  /** Selected ability-tag names (OR within). Empty = any tags. */
  tags?: readonly string[];
  /** Inclusive level bounds; null/undefined = unbounded on that side. */
  minLevel?: number | null;
  maxLevel?: number | null;
  /** Selected rarity values (OR within). Empty = any rarity. */
  rarities?: readonly string[];
  /** Selected trait slugs (OR within). Empty = any traits. */
  traits?: readonly string[];
  /**
   * Selected weapon groups (sword, firearm…) and armor categories (light/medium/
   * heavy). These two form a single "item type" axis: an item is kept if it
   * matches *any* selected weapon group **or** *any* selected armor category
   * (OR across both lists), so picking "firearm" + "light" shows firearms and
   * light armor together. Empty on both sides = no type filter.
   */
  weaponGroups?: readonly string[];
  armorCategories?: readonly string[];
  /** Inclusive gp-equivalent price bounds; null/undefined = unbounded. */
  minPriceGp?: number | null;
  maxPriceGp?: number | null;
  /**
   * When a price bound is set, priceless (null-price) items are excluded by
   * default. Set this to
   * keep them in the result regardless of the numeric bounds.
   */
  includePriceless?: boolean;
  /** Result ordering. Defaults to `relevance` when text is present, else `name`. */
  sort?: SortField;
  /** Ascending (default) or descending. */
  sortDir?: SortDir;
}

/** Options for a single {@link SearchEngine.query} call. */
export interface QueryOptions {
  /**
   * Cap on returned rows (a page size). Omit for no cap. {@link QueryResult.total}
   * always reflects the uncapped match count so callers can show "showing N of
   * M" or compute a page count.
   */
  limit?: number;
  /**
   * Rows to skip before collecting up to {@link limit} — pairs with `limit` for
   * pagination (`offset = pageIndex * pageSize`). Defaults to 0.
   */
  offset?: number;
}

/** The outcome of a query: the (optionally capped) sorted rows + the full count. */
export interface QueryResult {
  items: IndexedItem[];
  /** Total matches before any {@link QueryOptions.limit} was applied. */
  total: number;
}

/** A tag option for the UI: the category name + how many corpus items carry it. */
export interface TagOption {
  name: string;
  count: number;
}

/** The option lists the UI renders filter controls against (handed to Phase 5). */
export interface FilterOptionLists {
  /** Ability-tag categories (full dictionary when provided, else those present). */
  tags: TagOption[];
  /** Distinct trait slugs present in the corpus, A→Z. */
  traits: string[];
  /** Distinct weapon groups present among weapons, A→Z. */
  weaponGroups: string[];
  /** Distinct armor categories present among armor, in size order (light→heavy). */
  armorCategories: string[];
  /** Distinct rarities present, in canonical order (common→uncommon→rare→unique). */
  rarities: string[];
  /** Observed level range across the corpus (for slider bounds). */
  levelRange: { min: number; max: number };
  /** Observed gp price range across priced items (priceless excluded). */
  priceRange: { min: number; max: number } | null;
}

/** Construction-time options for {@link createSearchEngine}. */
export interface SearchEngineOptions {
  /**
   * The full ability-tag dictionary names (all 21 categories) so the UI can
   * offer every category even if some carry no corpus items. When omitted, the
   * tag option list is derived from the tags actually present in the index.
   */
  categories?: readonly string[];
  /**
   * uuid → plain-text description, folded into the full-text index alongside
   * name. Descriptions are fetched lazily in Foundry (large payloads), so they
   * are injected here rather than read by the engine. Absent entries index by
   * name only.
   */
  descriptions?: Record<string, string>;
}

/** Canonical PF2e rarity order (rarest last). */
const RARITY_ORDER = ["common", "uncommon", "rare", "unique"] as const;

/** Canonical armor-category order (lightest first); others trail alphabetically. */
const ARMOR_CATEGORY_ORDER = ["light", "medium", "heavy"] as const;

/** MiniSearch document shape (one per indexed item). */
interface TextDoc {
  id: string;
  name: string;
  description: string;
}

/**
 * Build a search engine bound to one {@link ItemIndex}. Precomputes the option
 * lists and the MiniSearch text index once; {@link SearchEngine.query} is then a
 * cheap, deterministic call. Rebuild the engine when the underlying index is
 * rebuilt (world/system change).
 */
export function createSearchEngine(
  index: ItemIndex,
  options: SearchEngineOptions = {},
): SearchEngine {
  return new SearchEngine(index, options);
}

export class SearchEngine {
  private readonly index: ItemIndex;
  private readonly mini: MiniSearch<TextDoc>;
  /** Precomputed option lists for the UI. */
  readonly options: FilterOptionLists;

  constructor(index: ItemIndex, opts: SearchEngineOptions = {}) {
    this.index = index;
    this.mini = buildTextIndex(index.items, opts.descriptions ?? {});
    this.options = buildOptionLists(index, opts.categories);
  }

  /**
   * Run a query and return the sorted rows plus the uncapped total. The pipeline:
   * 1. narrow to the ability-tag candidate set via the Phase 3 inverted index
   *    (OR within the selection); no tags selected → the full corpus;
   * 2. apply the structured predicates (level, rarity, traits, price) — AND
   *    across categories;
   * 3. when text is present, AND-intersect with the MiniSearch candidate set;
   * 4. sort (relevance when text is present and requested, else the chosen key).
   */
  query(state: FilterState, queryOptions: QueryOptions = {}): QueryResult {
    // 1 + 2: structured candidate set (Map preserves the index's item order).
    const structured = this.structuredMatches(state);

    // 3: intersect with the free-text candidate set, keeping relevance rank.
    const text = normalizeText(state.text);
    let rows: IndexedItem[];
    let rank: Map<string, number> | null = null;
    if (text) {
      const ranked = this.mini.search(text);
      rank = new Map<string, number>();
      const intersected: IndexedItem[] = [];
      for (const hit of ranked) {
        const item = structured.get(hit.id);
        if (item && !rank.has(hit.id)) {
          rank.set(hit.id, rank.size);
          intersected.push(item);
        }
      }
      rows = intersected;
    } else {
      rows = [...structured.values()];
    }

    // 4: order the surviving rows.
    const sorted = this.sortRows(rows, state, rank);

    const total = sorted.length;
    const offset = Math.max(0, queryOptions.offset ?? 0);
    const limited =
      queryOptions.limit !== undefined
        ? sorted.slice(offset, offset + queryOptions.limit)
        : sorted.slice(offset);
    return { items: limited, total };
  }

  /**
   * The structured (non-text) match set, keyed by uuid in the index's original
   * order. Uses the inverted tag index for the tag category, then filters that
   * subset by the remaining predicates.
   */
  private structuredMatches(state: FilterState): Map<string, IndexedItem> {
    const base = this.tagCandidates(state.tags);
    const result = new Map<string, IndexedItem>();
    for (const item of base) {
      if (matchesStructured(item, state)) result.set(item.uuid, item);
    }
    return result;
  }

  /**
   * Items carrying *any* of the selected tags (OR within), resolved through the
   * inverted `tag → uuids` index for speed. No selection → the full corpus in
   * index order. De-dupes items that carry several selected tags.
   */
  private tagCandidates(tags: readonly string[] | undefined): IndexedItem[] {
    if (!tags || tags.length === 0) return this.index.items;
    // Union the selected tags' posting lists (OR within), de-duping items that
    // carry several selected tags.
    const union = new Set<string>();
    for (const tag of tags) {
      const ids = this.index.tagToItemIds.get(tag);
      if (ids) for (const id of ids) union.add(id);
    }
    // Walk the corpus once (already unique by uuid) to preserve index order.
    return this.index.items.filter((item) => union.has(item.uuid));
  }

  /** Order rows per the filter state. Falls back to name when relevance is
   * requested without text, and always breaks ties stably (name, then uuid). */
  private sortRows(
    rows: IndexedItem[],
    state: FilterState,
    rank: Map<string, number> | null,
  ): IndexedItem[] {
    const field: SortField = state.sort ?? (rank ? "relevance" : "name");
    const dir = state.sortDir ?? "asc";
    const sign = dir === "desc" ? -1 : 1;

    // Relevance ordering only applies when we actually have a rank map (text
    // present). Otherwise it degrades to name.
    if (field === "relevance" && rank) {
      // `rows` is already in relevance order; apply direction + keep it stable.
      const withIdx = rows.map((item, i) => ({ item, i }));
      withIdx.sort((a, b) => sign * (a.i - b.i));
      return withIdx.map((x) => x.item);
    }

    const cmp = comparatorFor(field === "relevance" ? "name" : field);
    // Decorate-sort-undecorate for a stable order across engines.
    const decorated = rows.map((item, i) => ({ item, i }));
    decorated.sort((a, b) => {
      const primary = sign * cmp(a.item, b.item);
      if (primary !== 0) return primary;
      // Stable tie-break: original order (independent of sort direction).
      return a.i - b.i;
    });
    return decorated.map((x) => x.item);
  }
}

/** Trim + collapse a free-text query; empty/whitespace → null (no text filter). */
function normalizeText(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Predicate for the structured (non-tag, non-text) filters. */
function matchesStructured(item: IndexedItem, state: FilterState): boolean {
  if (state.minLevel != null && item.level < state.minLevel) return false;
  if (state.maxLevel != null && item.level > state.maxLevel) return false;

  if (state.rarities && state.rarities.length > 0 && !state.rarities.includes(item.rarity)) {
    return false;
  }

  if (state.traits && state.traits.length > 0) {
    // OR within: keep the item if it has any of the selected traits.
    if (!state.traits.some((t) => item.traits.includes(t))) return false;
  }

  // Weapon group + armor category form one OR-combined "item type" axis.
  const weaponGroups = state.weaponGroups ?? [];
  const armorCategories = state.armorCategories ?? [];
  if (weaponGroups.length > 0 || armorCategories.length > 0) {
    const matchesWeapon =
      item.type === "weapon" && item.group != null && weaponGroups.includes(item.group);
    const matchesArmor =
      item.type === "armor" && item.category != null && armorCategories.includes(item.category);
    if (!matchesWeapon && !matchesArmor) return false;
  }

  const hasPriceBound = state.minPriceGp != null || state.maxPriceGp != null;
  if (hasPriceBound) {
    if (item.priceGp == null) {
      // Priceless: excluded from a numeric range unless explicitly included.
      if (!state.includePriceless) return false;
    } else {
      if (state.minPriceGp != null && item.priceGp < state.minPriceGp) return false;
      if (state.maxPriceGp != null && item.priceGp > state.maxPriceGp) return false;
    }
  }

  return true;
}

/** Build a comparator for a concrete sort key. Nulls (priceless) sort last. */
function comparatorFor(field: "name" | "level" | "price"): (a: IndexedItem, b: IndexedItem) => number {
  switch (field) {
    case "level":
      return (a, b) => a.level - b.level;
    case "price":
      return (a, b) => {
        // Priceless (null) always sorts after priced items, in both directions
        // the caller flips overall — so keep nulls "large" here and let the tie
        // break by index. We compare on the raw value with null → +Infinity.
        const av = a.priceGp ?? Number.POSITIVE_INFINITY;
        const bv = b.priceGp ?? Number.POSITIVE_INFINITY;
        return av - bv;
      };
    case "name":
    default:
      return (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  }
}

/** Construct the MiniSearch index over name + (optional) description text. */
function buildTextIndex(
  items: readonly IndexedItem[],
  descriptions: Record<string, string>,
): MiniSearch<TextDoc> {
  const mini = new MiniSearch<TextDoc>({
    idField: "id",
    fields: ["name", "description"],
    // Weight name hits far above description body (BM25 column
    // weights: name 10, description 1).
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { name: 10 },
      combineWith: "AND",
    },
  });
  const docs: TextDoc[] = items.map((item) => ({
    id: item.uuid,
    name: item.name,
    description: descriptions[item.uuid] ?? "",
  }));
  mini.addAll(docs);
  return mini;
}

/** Precompute the tag/trait/rarity option lists + observed numeric ranges. */
function buildOptionLists(index: ItemIndex, categories?: readonly string[]): FilterOptionLists {
  // Tags: prefer the supplied full dictionary (all 21), else those present.
  const tagNames = categories && categories.length > 0
    ? [...categories]
    : [...index.tagToItemIds.keys()].sort((a, b) => a.localeCompare(b));
  const tags: TagOption[] = tagNames.map((name) => ({
    name,
    count: index.tagToItemIds.get(name)?.length ?? 0,
  }));

  // Traits: distinct across the corpus, A→Z.
  const traitSet = new Set<string>();
  for (const item of index.items) for (const t of item.traits) traitSet.add(t);
  const traits = [...traitSet].sort((a, b) => a.localeCompare(b));

  // Weapon groups (from weapons) and armor categories (from armor), each
  // distinct across the corpus. Armor categories follow the canonical
  // light→heavy order; anything unexpected trails alphabetically.
  const weaponGroupSet = new Set<string>();
  const armorCategorySet = new Set<string>();
  for (const item of index.items) {
    if (item.type === "weapon" && item.group) weaponGroupSet.add(item.group);
    if (item.type === "armor" && item.category) armorCategorySet.add(item.category);
  }
  const weaponGroups = [...weaponGroupSet].sort((a, b) => a.localeCompare(b));
  const armorCategories: string[] = [];
  for (const c of ARMOR_CATEGORY_ORDER) if (armorCategorySet.delete(c)) armorCategories.push(c);
  armorCategories.push(...[...armorCategorySet].sort((a, b) => a.localeCompare(b)));

  // Rarities: canonical order, then any unexpected values alphabetically.
  const raritySet = new Set<string>();
  for (const item of index.items) raritySet.add(item.rarity);
  const rarities: string[] = [];
  for (const r of RARITY_ORDER) if (raritySet.delete(r)) rarities.push(r);
  rarities.push(...[...raritySet].sort((a, b) => a.localeCompare(b)));

  // Numeric ranges for slider bounds.
  let minLevel = Number.POSITIVE_INFINITY;
  let maxLevel = Number.NEGATIVE_INFINITY;
  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = Number.NEGATIVE_INFINITY;
  let anyPriced = false;
  for (const item of index.items) {
    if (item.level < minLevel) minLevel = item.level;
    if (item.level > maxLevel) maxLevel = item.level;
    if (item.priceGp != null) {
      anyPriced = true;
      if (item.priceGp < minPrice) minPrice = item.priceGp;
      if (item.priceGp > maxPrice) maxPrice = item.priceGp;
    }
  }
  const levelRange = index.items.length > 0
    ? { min: minLevel, max: maxLevel }
    : { min: 0, max: 0 };
  const priceRange = anyPriced ? { min: minPrice, max: maxPrice } : null;

  return { tags, traits, weaponGroups, armorCategories, rarities, levelRange, priceRange };
}
