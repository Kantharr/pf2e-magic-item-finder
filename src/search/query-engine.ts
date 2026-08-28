import MiniSearch from "minisearch";
import { WEAPON_HANDS_ORDER, type IndexedItem, type ItemIndex, type WeaponHands } from "../data/item-index.js";
import { RUNE_KIND_ORDER, type RuneKind } from "../data/runes.js";

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
 * all-empty state matches the full corpus, magical and mundane alike. */
export interface FilterState {
  /**
   * Free-text query, matched against item names **and** description bodies
   * (name hits rank far higher). Description matching additionally requires the
   * text to have been loaded into the engine
   * ({@link SearchEngine.setDescriptions}); until then this matches names only.
   * Blank = no text filter.
   *
   * A term prefixed with `-` is an **exclusion**: `staff -wand` finds staves that
   * never mention a wand. See {@link parseQueryText} for the exact syntax.
   */
  text?: string;
  /** Selected ability-tag names (OR within). Empty = any tags. */
  tags?: readonly string[];
  /** Inclusive level bounds; null/undefined = unbounded on that side. */
  minLevel?: number | null;
  maxLevel?: number | null;
  /**
   * Whether to keep magical items, mundane ones, or both — `"magical"` and/or
   * `"mundane"` (OR within, like every other multi-select here). Empty or absent
   * = both, which is the default view; selecting one value filters the other kind
   * out, and selecting both is the same as selecting neither.
   *
   * Note that only magical items carry ability tags, so any {@link tags}
   * selection already excludes mundane items on its own.
   */
  magic?: readonly string[];
  /** Selected rarity values (OR within). Empty = any rarity. */
  rarities?: readonly string[];
  /** Selected trait slugs (OR within). Empty = any traits. */
  traits?: readonly string[];
  /**
   * Selected weapon groups (sword, firearm…), armor categories (light/medium/
   * heavy), and rune families (see {@link import("../data/runes.js").RuneKind}).
   * These three form a single "item type" axis: an item is kept if it matches
   * *any* selected weapon group, *any* selected armor category, **or** *any*
   * selected rune family (OR across all three lists), so picking "firearm" +
   * "light" + "weapon-property" shows firearms, light armor, and weapon property
   * runes together. Empty on all three = no type filter.
   */
  weaponGroups?: readonly string[];
  armorCategories?: readonly string[];
  runeKinds?: readonly string[];
  /**
   * Selected weapon hand counts ("1", "1+", "2"; OR within). Its own AND axis,
   * *not* part of the weapon-group/armor OR axis: "two-handed swords" should
   * mean both, not either. Only weapons carry a hand count, so any selection
   * here narrows the result to weapons. Empty = no hands filter.
   */
  hands?: readonly string[];
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
  /** Which of `magical` / `mundane` the corpus actually contains, in that order. */
  magic: string[];
  /** Distinct trait slugs present in the corpus, A→Z. */
  traits: string[];
  /** Distinct weapon groups present among weapons, A→Z. */
  weaponGroups: string[];
  /** Distinct armor categories present among armor, in size order (light→heavy). */
  armorCategories: string[];
  /** Rune families present in the corpus, in {@link RUNE_KIND_ORDER}. */
  runeKinds: RuneKind[];
  /** Distinct weapon hand counts present, in canonical order (1 → 1+ → 2). */
  hands: WeaponHands[];
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
   * name only. Omit this to start name-only and supply them later via
   * {@link SearchEngine.setDescriptions}.
   */
  descriptions?: Record<string, string>;
}

/**
 * One shared collator for name ordering. `String.prototype.localeCompare` builds
 * a collator per *call*, which dominates every large query — sorting the corpus
 * cost ~260ms that way versus ~10ms here (measured at ~3.9k items; the corpus is
 * ~5.9k now that mundane items are indexed, so the gap is wider still). Same
 * locale and sensitivity, so the ordering is unchanged.
 */
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: "base" });

/** Canonical PF2e rarity order (rarest last). */
const RARITY_ORDER = ["common", "uncommon", "rare", "unique"] as const;

/** The two values of the magic axis, in the order the UI offers them. */
export const MAGIC_VALUES = ["magical", "mundane"] as const;

/** Canonical armor-category order (lightest first); others trail alphabetically. */
const ARMOR_CATEGORY_ORDER = ["light", "medium", "heavy"] as const;

/** MiniSearch document shape (one per indexed item). */
interface TextDoc {
  id: string;
  name: string;
  description: string;
}

/**
 * Documents per chunk when folding descriptions in asynchronously.
 *
 * `addAllAsync` yields to the event loop (a `setTimeout(0)`) between chunks, so
 * this trades total wall-clock for responsiveness: the rebuild costs ~0.12ms per
 * item (~460ms over the ~3.9k magical-only corpus this was tuned against, ~700ms
 * over the ~5.9k items indexed since mundane ones were included), and 100 keeps
 * each chunk near a single 60fps frame instead of one long block that freezes
 * typing. Do not use MiniSearch's default of 10 — that would be ~590 yields, and
 * the timer clamp alone would cost more than the work.
 */
const TEXT_INDEX_CHUNK_SIZE = 100;

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
  private mini: MiniSearch<TextDoc>;
  /** True once non-empty description text has been indexed (at construction or
   * via {@link setDescriptions}) — description-scoped queries are meaningless
   * before that. */
  private descriptionsLoaded: boolean;
  /** The raw description text last handed to {@link buildTextIndex}, kept so the
   * exclusion haystacks can be (re)built from it. */
  private descriptions: Record<string, string>;
  /**
   * uuid → lower-cased "name + description", the substring haystack behind `-term`
   * exclusions. Built on first use and dropped whenever the text index is rebuilt:
   * it is a second full copy of the description text, so a session that never
   * types a `-` never pays for it.
   */
  private haystacks: Map<string, string> | null = null;
  /** Incremented per {@link setDescriptions} call so an in-flight chunked build
   * that has been superseded discards its result instead of winning the swap. */
  private buildToken = 0;
  /** Precomputed option lists for the UI. */
  readonly options: FilterOptionLists;

  constructor(index: ItemIndex, opts: SearchEngineOptions = {}) {
    this.index = index;
    const descriptions = opts.descriptions ?? {};
    this.descriptions = descriptions;
    this.mini = buildTextIndex(index.items, descriptions);
    this.descriptionsLoaded = Object.keys(descriptions).length > 0;
    this.options = buildOptionLists(index, opts.categories);
  }

  /** Whether description text is available to the full-text index. */
  get hasDescriptions(): boolean {
    return this.descriptionsLoaded;
  }

  /**
   * Fold descriptions into the full-text index after construction — they are
   * fetched lazily in Foundry (large payloads), so the engine starts name-only
   * and is upgraded on demand when the user first asks to search descriptions.
   *
   * The rebuild is chunked (`addAllAsync`, {@link TEXT_INDEX_CHUNK_SIZE}) and
   * lands in a **separate** index that replaces the live one only once it is
   * complete. Two properties fall out of that, and both matter:
   *
   * - queries during the rebuild keep hitting the old name-only index and return
   *   correct (if narrower) results, rather than seeing a half-populated one;
   * - the yields between chunks keep typing responsive, at the cost of a slightly
   *   longer total — the work stops being one ~460ms freeze.
   *
   * A later call supersedes an in-flight one, so an index rebuild racing a
   * description load can't have the stale result win.
   */
  async setDescriptions(descriptions: Record<string, string>): Promise<void> {
    const token = ++this.buildToken;
    const next = createTextIndex();
    await next.addAllAsync(toTextDocs(this.index.items, descriptions), {
      chunkSize: TEXT_INDEX_CHUNK_SIZE,
    });
    if (token !== this.buildToken) return; // superseded mid-build; discard.
    // Swap atomically: everything derived from the text lands together.
    this.descriptions = descriptions;
    this.mini = next;
    this.descriptionsLoaded = Object.keys(descriptions).length > 0;
    // Stale: rebuilt on the next query that actually needs it.
    this.haystacks = null;
  }

  /**
   * The lower-cased name+description haystack for each item, built once on
   * demand. Until descriptions land this covers names only, so an exclusion
   * narrows further (rather than widening, as the positive side does) once the
   * bodies arrive — the app re-queries at that point either way.
   */
  private exclusionHaystacks(): Map<string, string> {
    if (this.haystacks) return this.haystacks;
    const map = new Map<string, string>();
    for (const item of this.index.items) {
      const description = this.descriptions[item.uuid];
      map.set(
        item.uuid,
        description ? `${item.name}\n${description}`.toLowerCase() : item.name.toLowerCase(),
      );
    }
    this.haystacks = map;
    return map;
  }

  /**
   * Run a query and return the sorted rows plus the uncapped total. The pipeline:
   * 1. narrow to the ability-tag candidate set via the Phase 3 inverted index
   *    (OR within the selection); no tags selected → the full corpus;
   * 2. apply the structured predicates (level, rarity, traits, price) — AND
   *    across categories;
   * 3. drop anything matching a `-term` exclusion;
   * 4. when positive text is present, AND-intersect with the MiniSearch
   *    candidate set;
   * 5. sort (relevance when text is present and requested, else the chosen key).
   */
  query(state: FilterState, queryOptions: QueryOptions = {}): QueryResult {
    // 1 + 2: structured candidate set (Map preserves the index's item order).
    const structured = this.structuredMatches(state);

    const { include: text, exclude } = parseQueryText(state.text);

    // 3: remove excluded items before the text pass, so an exclusion applies
    // just as well to a query that has no positive terms at all ("-staff").
    if (exclude.length > 0) {
      const haystacks = this.exclusionHaystacks();
      for (const uuid of structured.keys()) {
        const haystack = haystacks.get(uuid) ?? "";
        if (exclude.some((term) => haystack.includes(term))) structured.delete(uuid);
      }
    }

    // 4: intersect with the free-text candidate set, keeping relevance rank.
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

    // 5: order the surviving rows.
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

/** A free-text query split into its positive and negative halves. */
export interface ParsedQuery {
  /** The positive terms, re-joined for MiniSearch; null when there are none. */
  include: string | null;
  /** Lower-cased exclusion terms (the `-` already stripped). */
  exclude: string[];
}

/**
 * Split a raw search string into terms to match and terms to exclude.
 *
 * A token beginning with `-` is an exclusion — `staff -wand` means "matches
 * staff, does not mention wand", and a query of *only* exclusions (`-staff`)
 * filters the whole corpus rather than searching it. The `-` only counts at the
 * start of a token, so hyphenated words ("fatal-aim", "well-known") and a bare
 * dash are left alone.
 *
 * Exclusions are matched as plain case-insensitive **substrings** of the name
 * and description, not as MiniSearch terms: prefix/fuzzy matching is right for
 * finding things and wrong for hiding them (fuzzy "staff" would also drop
 * "stuff"), and substring semantics are what "has staff in the name" means —
 * `-staff` hides "Quarterstaff" too.
 */
export function parseQueryText(text: string | undefined): ParsedQuery {
  if (!text) return { include: null, exclude: [] };
  const include: string[] = [];
  const exclude: string[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (token.length === 0) continue;
    if (token.startsWith("-")) {
      const term = token.slice(1);
      // A lone "-" excludes nothing; drop it rather than excluding everything.
      if (term.length > 0) exclude.push(term.toLowerCase());
    } else {
      include.push(token);
    }
  }
  return { include: include.length > 0 ? include.join(" ") : null, exclude };
}

/** Predicate for the structured (non-tag, non-text) filters. */
function matchesStructured(item: IndexedItem, state: FilterState): boolean {
  if (state.minLevel != null && item.level < state.minLevel) return false;
  if (state.maxLevel != null && item.level > state.maxLevel) return false;

  if (state.magic && state.magic.length > 0) {
    // Selecting both values is the same as selecting neither, which falls out of
    // the membership test rather than needing a special case.
    if (!state.magic.includes(item.magical ? "magical" : "mundane")) return false;
  }

  if (state.rarities && state.rarities.length > 0 && !state.rarities.includes(item.rarity)) {
    return false;
  }

  if (state.traits && state.traits.length > 0) {
    // OR within: keep the item if it has any of the selected traits.
    if (!state.traits.some((t) => item.traits.includes(t))) return false;
  }

  // Weapon group + armor category + rune family form one OR-combined "item
  // type" axis.
  const weaponGroups = state.weaponGroups ?? [];
  const armorCategories = state.armorCategories ?? [];
  const runeKinds = state.runeKinds ?? [];
  if (weaponGroups.length > 0 || armorCategories.length > 0 || runeKinds.length > 0) {
    const matchesWeapon =
      item.type === "weapon" && item.group != null && weaponGroups.includes(item.group);
    const matchesArmor =
      item.type === "armor" && item.category != null && armorCategories.includes(item.category);
    const matchesRune = item.runeKind != null && runeKinds.includes(item.runeKind);
    if (!matchesWeapon && !matchesArmor && !matchesRune) return false;
  }

  if (state.hands && state.hands.length > 0) {
    // Non-weapons have no hand count, so they drop out here by construction.
    if (item.hands == null || !state.hands.includes(item.hands)) return false;
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
      return (a, b) => NAME_COLLATOR.compare(a.name, b.name);
  }
}

/** An empty MiniSearch index configured for the corpus. */
function createTextIndex(): MiniSearch<TextDoc> {
  return new MiniSearch<TextDoc>({
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
}

/** Project the items into MiniSearch documents. */
function toTextDocs(
  items: readonly IndexedItem[],
  descriptions: Record<string, string>,
): TextDoc[] {
  return items.map((item) => ({
    id: item.uuid,
    name: item.name,
    description: descriptions[item.uuid] ?? "",
  }));
}

/** Construct the MiniSearch index over name + (optional) description text. */
function buildTextIndex(
  items: readonly IndexedItem[],
  descriptions: Record<string, string>,
): MiniSearch<TextDoc> {
  const mini = createTextIndex();
  mini.addAll(toTextDocs(items, descriptions));
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

  // Magic: only the halves actually present, so a corpus that is entirely one or
  // the other doesn't render a filter that can only ever be a no-op.
  const magicSet = new Set<string>();
  for (const item of index.items) magicSet.add(item.magical ? "magical" : "mundane");
  const magic = MAGIC_VALUES.filter((v) => magicSet.has(v));

  // Weapon groups (from weapons) and armor categories (from armor), each
  // distinct across the corpus. Armor categories follow the canonical
  // light→heavy order; anything unexpected trails alphabetically.
  const weaponGroupSet = new Set<string>();
  const armorCategorySet = new Set<string>();
  const handsSet = new Set<WeaponHands>();
  const runeKindSet = new Set<RuneKind>();
  for (const item of index.items) {
    if (item.type === "weapon" && item.group) weaponGroupSet.add(item.group);
    if (item.type === "armor" && item.category) armorCategorySet.add(item.category);
    if (item.hands) handsSet.add(item.hands);
    if (item.runeKind) runeKindSet.add(item.runeKind);
  }
  // Only the families the corpus actually contains, in canonical order.
  const runeKinds = RUNE_KIND_ORDER.filter((k) => runeKindSet.has(k));
  const hands = WEAPON_HANDS_ORDER.filter((h) => handsSet.has(h));
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

  return {
    tags, magic, traits, weaponGroups, armorCategories, runeKinds, hands, rarities,
    levelRange, priceRange,
  };
}
