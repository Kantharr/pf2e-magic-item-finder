import { MODULE_ID } from "../constants.js";
import { sluggify } from "./sluggify.js";
import {
  EQUIPMENT_PACK_ID,
  PACK_UUID_PREFIX,
  RUNE_INDEX_FIELDS,
  isMagicalItem,
  type RawRunes,
} from "./coverage.js";
import { runeKind, type RuneKind } from "./runes.js";
import type { MatchMethod, TagMap, TagMapEntry } from "./tag-map.js";

/**
 * Phase 3 — the in-memory item model. One entry per item in
 * `pf2e.equipment-srd` — magical *and* mundane — combining the live compendium
 * index fields with the bundled ability tags (joined by uuid, slug fallback).
 * Built once at `ready` and reused by the search engine (Phase 4) and UI
 * (Phase 5).
 *
 * Only magical items can carry ability tags (the bundled map covers just them),
 * so mundane entries land here with an empty `tags[]` and are reachable by name,
 * trait, and the other structured filters. {@link IndexedItem.magical} records
 * which is which, and backs the engine's `magic` filter axis.
 */

/** Fields requested from `pack.getIndex()` beyond the defaults (`_id`, `name`, `img`, `type`). */
const INDEX_FIELDS = [
  "system.level.value",
  "system.traits.rarity",
  "system.traits.value",
  "system.price.value",
  "system.publication.title",
  "system.slug",
  // Weapon/armor sub-type: `category` is simple/martial/advanced (weapons) or
  // light/medium/heavy (armor); `group` is the weapon group (sword, firearm…)
  // or armor group. Drives the weapon-group / armor-category filters.
  "system.category",
  "system.group",
  // How the item is wielded/worn; for weapons this is what the hands filter
  // reads (held-in-one-hand / held-in-one-plus-hands / held-in-two-hands).
  "system.usage.value",
  // Etched runes — part of the "is it magical?" predicate (see isMagicalItem).
  ...RUNE_INDEX_FIELDS,
] as const;

/** Raw multi-denomination price object from `system.price.value` (any subset of keys). */
export interface RawPriceValue {
  pp?: number;
  gp?: number;
  sp?: number;
  cp?: number;
}

/** How the item was joined to a tag-map entry, or `null` when it has no tags. */
export type TagJoin = "uuid" | "slug" | null;

/**
 * How many hands a weapon takes to wield: one, "one plus" (a bow or similar that
 * needs a second hand free to fire), or two — matching PF2e's own hands filter.
 */
export type WeaponHands = "1" | "1+" | "2";

/** `system.usage.value` → {@link WeaponHands}. */
const USAGE_TO_HANDS: Record<string, WeaponHands> = {
  "held-in-one-hand": "1",
  "held-in-one-plus-hands": "1+",
  "held-in-two-hands": "2",
};

/** Canonical order for the hands filter chips. */
export const WEAPON_HANDS_ORDER: readonly WeaponHands[] = ["1", "1+", "2"];

/**
 * The hands a weapon occupies, or `null` for anything that isn't a hand-held
 * weapon. Deliberately scoped to `type === "weapon"`: wands, scrolls, and most
 * other equipment are also "held in one hand", and folding them in would make a
 * *weapon* hands filter match half the corpus. Handwrap-style weapons (worn
 * gloves) have no usable hand count and stay `null`.
 */
export function weaponHands(type: string, usage: string | null | undefined): WeaponHands | null {
  if (type !== "weapon" || !usage) return null;
  return USAGE_TO_HANDS[usage] ?? null;
}

/** One indexed item: compendium data + joined ability tags. */
export interface IndexedItem {
  /** `Compendium.pf2e.equipment-srd.Item.<_id>` — the primary key everywhere. */
  uuid: string;
  /** The 16-char document `_id`. */
  id: string;
  name: string;
  /** `system.level.value`; 0 when the item omits a level. */
  level: number;
  /** common / uncommon / rare / unique. */
  rarity: string;
  traits: string[];
  /** gp-equivalent price, or `null` for priceless items (distinct from 0). */
  priceGp: number | null;
  /** `system.publication.title`, or `null`. */
  source: string | null;
  /** `system.slug` from the index, else a sluggified name. */
  slug: string;
  img: string | null;
  type: string;
  /** `system.category`: simple/martial/advanced (weapons) or light/medium/heavy
   * (armor); `null` for items that carry no category. */
  category: string | null;
  /** `system.group`: the weapon group (sword, firearm…) or armor group; `null`
   * when absent. */
  group: string | null;
  /** Hands the weapon occupies; `null` for non-weapons (see {@link weaponHands}). */
  hands: WeaponHands | null;
  /** Which rune family the item belongs to, or `null` for non-runes — derived
   * from {@link slug} via the bundled classification (see {@link runeKind}). */
  runeKind: RuneKind | null;
  /**
   * Whether the item is magical per {@link isMagicalItem} (a marker trait *or* an
   * etched rune). Backs the `magic` filter axis. Mundane items never carry
   * ability tags, since the bundled map only covers the magical half.
   */
  magical: boolean;
  /** Matched tag names (dictionary order); empty when unmatched. */
  tags: string[];
  /** Tag name → evidence snippet. */
  snippets: Record<string, string>;
  /** Tag name → how the tag matched (structured / regex). */
  matchMethod: Record<string, MatchMethod>;
  /** How this item joined the tag map (diagnostics + hit-rate). */
  joinedBy: TagJoin;
}

/** Per-build counts for the index (fed to {@link logItemIndex}). */
export interface ItemIndexStats {
  /** Items indexed, magical + mundane (== `items.length`). */
  total: number;
  /** Magical items indexed — the denominator for the tag-join hit rate. */
  magical: number;
  /** Mundane items indexed (== `total - magical`). */
  mundane: number;
  /** Items that joined a tag-map entry (the tag-join hit rate). */
  matched: number;
  matchedByUuid: number;
  rescuedBySlug: number;
  /**
   * **Magical** items with no map entry at all (still searchable by name and the
   * structured filters). Mundane items are excluded from this count: they have no
   * map entry by construction, so folding them in would report ~2.4k phantom
   * misses.
   */
  unmatched: number;
  /**
   * Items carrying at least one tag. Less than {@link matched}: some joined
   * entries were evaluated but matched no tag (empty `tags[]`).
   */
  withTags: number;
  /** Distinct tags present across the corpus (== `tagToItemIds.size`). */
  tagCount: number;
}

/** The assembled index: the item array plus the lookup structures Phase 4 needs. */
export interface ItemIndex {
  items: IndexedItem[];
  /** uuid → item, for O(1) resolution. */
  byUuid: Map<string, IndexedItem>;
  /** tag name → uuids carrying it (inverted index for fast tag filtering). */
  tagToItemIds: Map<string, string[]>;
  /** Epoch-ms the index was built. */
  builtAt: number;
  stats: ItemIndexStats;
}

/** Pre-join extraction of one live item (kept raw so {@link assembleIndex} is pure). */
interface RawItem {
  uuid: string;
  id: string;
  name: string;
  level: number;
  rarity: string;
  traits: string[];
  price: RawPriceValue | null;
  source: string | null;
  slug: string;
  img: string | null;
  type: string;
  category: string | null;
  group: string | null;
  hands: WeaponHands | null;
  magical: boolean;
}

interface RawIndexEntry {
  _id: string;
  name?: string;
  img?: string;
  type?: string;
  system?: {
    slug?: string | null;
    level?: { value?: number };
    traits?: { value?: string[]; rarity?: string };
    price?: { value?: RawPriceValue | null };
    publication?: { title?: string };
    category?: string | null;
    group?: string | null;
    usage?: { value?: string | null };
    runes?: RawRunes | null;
  };
}

/**
 * Collapse Foundry's multi-denomination price into a single gp-equivalent,
 * as `pp*10 + gp + sp/10 + cp/100`.
 * An absent or empty (`{}`) price object → `null` (priceless), distinct from a
 * price whose denominations happen to sum to 0.
 */
export function normalizePrice(value: RawPriceValue | null | undefined): number | null {
  if (!value) return null;
  const { pp, gp, sp, cp } = value;
  if (pp === undefined && gp === undefined && sp === undefined && cp === undefined) {
    return null;
  }
  return (pp ?? 0) * 10 + (gp ?? 0) + (sp ?? 0) / 10 + (cp ?? 0) / 100;
}

/**
 * Build the item index against the live `pf2e.equipment-srd` pack. Read-only:
 * reads the compendium index (with the extra fields) and joins the bundled map.
 * Throws when the pack is missing/disabled (the PF2e system isn't active).
 */
export async function buildItemIndex(tagMap: TagMap): Promise<ItemIndex> {
  const pack = game.packs?.get(EQUIPMENT_PACK_ID);
  if (!pack) {
    throw new Error(
      `${MODULE_ID} | equipment pack "${EQUIPMENT_PACK_ID}" not found; is the PF2e system active?`,
    );
  }
  const raw = await readItems(pack);
  return assembleIndex(tagMap, raw);
}

/**
 * Pull **every** item from the pack index with the fields the model needs.
 * Magical and mundane alike: `isMagicalItem` is recorded per item rather than
 * used as a gate, so the `magic` filter axis can narrow to either half while the
 * default view spans both.
 */
async function readItems(pack: unknown): Promise<RawItem[]> {
  // getIndex's typed signature varies across fvtt-types/Foundry lines; the
  // `fields` option is honoured at runtime (v12+). Cast narrowly here, matching
  // the coverage reader.
  const getIndex = (pack as {
    getIndex: (options?: { fields?: readonly string[] }) => Promise<Iterable<RawIndexEntry>>;
  }).getIndex;
  const index = await getIndex.call(pack, { fields: INDEX_FIELDS });

  const items: RawItem[] = [];
  for (const entry of index) {
    const traits = entry.system?.traits?.value ?? [];
    const name = entry.name ?? "(unnamed)";
    const indexSlug = entry.system?.slug ?? null;
    const type = entry.type ?? "equipment";
    items.push({
      magical: isMagicalItem({ traits, runes: entry.system?.runes }),
      uuid: PACK_UUID_PREFIX + entry._id,
      id: entry._id,
      name,
      level: entry.system?.level?.value ?? 0,
      rarity: entry.system?.traits?.rarity ?? "common",
      traits,
      price: entry.system?.price?.value ?? null,
      source: entry.system?.publication?.title ?? null,
      // Fall back to a sluggified name so the slug join never silently no-ops
      // when the index omits system.slug (mirrors the coverage reader).
      slug: indexSlug ?? sluggify(name),
      img: entry.img ?? null,
      type,
      category: entry.system?.category ?? null,
      group: entry.system?.group ?? null,
      hands: weaponHands(type, entry.system?.usage?.value),
    });
  }
  return items;
}

/**
 * Pure assembly of the index from extracted raw items + the tag map. Separated
 * from the pack read so it is unit-testable without a live Foundry. De-dupes by
 * uuid defensively (Phase 0 found one pack, but duplicates are tolerated).
 */
export function assembleIndex(tagMap: TagMap, raw: RawItem[]): ItemIndex {
  // slug → entry, for the fallback join (first entry wins; slugs are unique).
  const entriesBySlug = new Map<string, TagMapEntry>();
  for (const entry of Object.values(tagMap.tags)) {
    if (entry.slug && !entriesBySlug.has(entry.slug)) entriesBySlug.set(entry.slug, entry);
  }

  const items: IndexedItem[] = [];
  const byUuid = new Map<string, IndexedItem>();
  const tagToItemIds = new Map<string, string[]>();
  let matchedByUuid = 0;
  let rescuedBySlug = 0;
  let withTags = 0;
  let magical = 0;

  for (const r of raw) {
    if (byUuid.has(r.uuid)) continue; // de-dupe defensively
    if (r.magical) magical++;

    let joinedBy: TagJoin = null;
    let entry: TagMapEntry | undefined = tagMap.tags[r.uuid];
    if (entry) {
      joinedBy = "uuid";
      matchedByUuid++;
    } else if (r.slug) {
      const bySlug = entriesBySlug.get(r.slug);
      if (bySlug) {
        entry = bySlug;
        joinedBy = "slug";
        rescuedBySlug++;
      }
    }

    const tags = entry?.tags ?? [];
    const item: IndexedItem = {
      uuid: r.uuid,
      id: r.id,
      name: r.name,
      level: r.level,
      rarity: r.rarity,
      traits: r.traits,
      priceGp: normalizePrice(r.price),
      source: r.source,
      slug: r.slug,
      img: r.img,
      type: r.type,
      category: r.category,
      group: r.group,
      hands: r.hands,
      // Classified here rather than in the pack read so it stays pure and
      // unit-testable: the slug is all it needs.
      runeKind: runeKind(r.slug),
      magical: r.magical,
      tags,
      snippets: entry?.snippets ?? {},
      matchMethod: entry?.matchMethod ?? {},
      joinedBy,
    };
    items.push(item);
    byUuid.set(item.uuid, item);
    if (tags.length > 0) withTags++;
    for (const tag of tags) {
      const ids = tagToItemIds.get(tag);
      if (ids) ids.push(item.uuid);
      else tagToItemIds.set(tag, [item.uuid]);
    }
  }

  const matched = matchedByUuid + rescuedBySlug;
  return {
    items,
    byUuid,
    tagToItemIds,
    builtAt: Date.now(),
    stats: {
      total: items.length,
      magical,
      mundane: items.length - magical,
      matched,
      matchedByUuid,
      rescuedBySlug,
      // Against the magical half only: mundane items have no map entry by
      // construction, so counting them as misses would be meaningless.
      unmatched: magical - matched,
      withTags,
      tagCount: tagToItemIds.size,
    },
  };
}

/**
 * Lazily fetch an item's enriched description HTML (`system.description.value`)
 * via `fromUuid`. Deferred out of the index because descriptions are large and
 * only needed for the detail view / on-demand full-text (recon §2). Returns
 * `null` on any failure (missing doc, unexpected shape).
 */
export async function fetchItemDescription(uuid: string): Promise<string | null> {
  try {
    const doc = (await fromUuid(uuid)) as
      | { system?: { description?: { value?: string } } }
      | null;
    return doc?.system?.description?.value ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | failed to fetch description for ${uuid}`, err);
    return null;
  }
}

/**
 * Flatten description HTML to searchable plain text: Foundry inline references
 * (`@UUID[…]{Label}`, `@Damage[2d6]`, …) collapse to their visible label, tags
 * are dropped, entities are decoded, and whitespace is collapsed. Cheap and
 * dependency-free — the result is only ever fed to the text index, never shown.
 */
export function descriptionToText(html: string): string {
  const withLabels = html
    // `@Thing[args]{Label}` → `Label`; `@Thing[args]` → `args`.
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, "$1");
  // Block-ish tags become a space so adjacent words don't fuse ("oneTwo").
  const stripped = withLabels.replace(/<[^>]*>/g, " ");
  const decoded = stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * Bulk-load plain-text descriptions for every item in {@link index}, keyed by
 * uuid — the payload {@link import("../search/query-engine.js").SearchEngine.setDescriptions}
 * needs to make description search work.
 *
 * Reads the **compendium index** with `system.description.value` projected in,
 * rather than `getDocuments()`. Both make a single round trip and return the
 * whole pack, but `getDocuments()` additionally instantiates ~5.8k *live PF2e
 * Item documents* — DataModel validation, migration, and rule-element
 * construction for every one — and we throw all of that away to keep one string
 * each. The index path returns plain projected objects and skips it entirely.
 * ({@link fetchItemDescription} stays the right tool for the single selected
 * item.)
 *
 * The cost of the swap is that Foundry caches what it indexes, so the pack's
 * shared index retains the description HTML (~5MB here) for the session instead
 * of releasing it. That is a fraction of what the discarded documents occupied
 * while they existed, and it makes the module's other `getIndex` calls free
 * afterwards (their fields become a subset of what is already indexed).
 *
 * Items with no description are simply absent from the result.
 */
export async function loadItemDescriptions(index: ItemIndex): Promise<Record<string, string>> {
  const pack = game.packs?.get(EQUIPMENT_PACK_ID);
  if (!pack) {
    throw new Error(
      `${MODULE_ID} | equipment pack "${EQUIPMENT_PACK_ID}" not found; is the PF2e system active?`,
    );
  }
  const getIndex = (pack as {
    getIndex: (options?: { fields?: readonly string[] }) => Promise<Iterable<{
      _id?: string;
      uuid?: string;
      system?: { description?: { value?: string } };
    }>>;
  }).getIndex;
  // Re-request the fields the item index already uses alongside the description,
  // so this call supersedes the cached index instead of narrowing it.
  const entries = await getIndex.call(pack, {
    fields: [...INDEX_FIELDS, "system.description.value"],
  });

  const out: Record<string, string> = {};
  for (const entry of entries) {
    // Index entries carry `uuid`, but compose it from `_id` as a fallback so the
    // join matches the index's key exactly (same prefix the index builds with).
    const uuid = entry.uuid ?? (entry._id ? PACK_UUID_PREFIX + entry._id : null);
    // Only the items we actually index are worth carrying.
    if (!uuid || !index.byUuid.has(uuid)) continue;
    const raw = entry.system?.description?.value;
    if (!raw) continue;
    const text = descriptionToText(raw);
    if (text) out[uuid] = text;
  }
  return out;
}

/**
 * One-line console summary of a built index (size + tag-join hit rate). The hit
 * rate is a percentage of the **magical** items, not of `total` — only they can
 * join the tag map, so dividing by the whole corpus would report a permanent
 * ~59% and look like a regression against the magic-only builds.
 */
export function logItemIndex(index: ItemIndex): void {
  const s = index.stats;
  const rate = s.magical ? ((s.matched / s.magical) * 100).toFixed(1) : "0.0";
  console.log(
    `${MODULE_ID} | item index built: ${s.total} items ` +
      `(${s.magical} magical, ${s.mundane} non-magical), ${s.matched} joined ` +
      `(${rate}% hit rate over magical: ${s.matchedByUuid} by uuid, ${s.rescuedBySlug} by slug), ` +
      `${s.unmatched} magical unmatched, ${s.withTags} with tags, ${s.tagCount} distinct tags indexed`,
  );
}

/**
 * Print a small spot-check sample of the built index as a console table, so the
 * price/tag join can be eyeballed without typing into the console. Prefers items
 * that actually carry tags (falls back to the first items if none do). Called at
 * `ready` only when the `debugLogging` setting is on.
 */
export function logIndexSpotCheck(index: ItemIndex, sampleSize = 8): void {
  const tagged = index.items.filter((i) => i.tags.length > 0);
  const sample = (tagged.length > 0 ? tagged : index.items).slice(0, sampleSize);
  if (sample.length === 0) {
    console.log(`${MODULE_ID} | spot-check: index is empty`);
    return;
  }
  const rows = sample.map((i) => ({
    name: i.name,
    level: i.level,
    rarity: i.rarity,
    priceGp: i.priceGp,
    joinedBy: i.joinedBy,
    tags: i.tags.join(", "),
  }));
  console.log(`${MODULE_ID} | spot-check sample (${sample.length} items):`);
  // console.table renders a readable grid in the F12 console; no input needed.
  (console.table as ((data: unknown) => void) | undefined)?.(rows) ??
    console.log(rows);
  // One item's evidence snippets, to confirm the snippet payload joined too.
  const withSnippet = sample.find((i) => Object.keys(i.snippets).length > 0);
  if (withSnippet) {
    console.log(`${MODULE_ID} | spot-check snippets for "${withSnippet.name}":`, withSnippet.snippets);
  }
}
