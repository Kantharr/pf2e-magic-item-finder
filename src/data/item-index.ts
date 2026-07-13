import { MODULE_ID } from "../constants.js";
import { sluggify } from "./sluggify.js";
import { EQUIPMENT_PACK_ID, MAGICAL_TRAIT, PACK_UUID_PREFIX } from "./coverage.js";
import type { MatchMethod, TagMap, TagMapEntry } from "./tag-map.js";

/**
 * Phase 3 — the in-memory item model. One entry per magical item in
 * `pf2e.equipment-srd`, combining the live compendium index fields with the
 * bundled ability tags (joined by uuid, slug fallback). Built once at `ready`
 * and reused by the search engine (Phase 4) and UI (Phase 5).
 */

/** Fields requested from `pack.getIndex()` beyond the defaults (`_id`, `name`, `img`, `type`). */
const INDEX_FIELDS = [
  "system.level.value",
  "system.traits.rarity",
  "system.traits.value",
  "system.price.value",
  "system.publication.title",
  "system.slug",
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
  /** Magical items indexed (== `items.length`). */
  total: number;
  /** Items that joined a tag-map entry (the tag-join hit rate). */
  matched: number;
  matchedByUuid: number;
  rescuedBySlug: number;
  /** Items with no map entry at all (still searchable by name/filters). */
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
  };
}

/**
 * Collapse Foundry's multi-denomination price into a single gp-equivalent,
 * mirroring the desktop `PriceNormalizer`: `pp*10 + gp + sp/10 + cp/100`.
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
  const raw = await readMagicalItems(pack);
  return assembleIndex(tagMap, raw);
}

/** Pull the magical items from the pack index with the fields the model needs. */
async function readMagicalItems(pack: unknown): Promise<RawItem[]> {
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
    if (!traits.includes(MAGICAL_TRAIT)) continue;
    const name = entry.name ?? "(unnamed)";
    const indexSlug = entry.system?.slug ?? null;
    items.push({
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
      type: entry.type ?? "equipment",
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

  for (const r of raw) {
    if (byUuid.has(r.uuid)) continue; // de-dupe defensively

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
      matched,
      matchedByUuid,
      rescuedBySlug,
      unmatched: items.length - matched,
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

/** One-line console summary of a built index (size + tag-join hit rate). */
export function logItemIndex(index: ItemIndex): void {
  const s = index.stats;
  const rate = s.total ? ((s.matched / s.total) * 100).toFixed(1) : "0.0";
  console.log(
    `${MODULE_ID} | item index built: ${s.total} magical items, ${s.matched} joined ` +
      `(${rate}% hit rate: ${s.matchedByUuid} by uuid, ${s.rescuedBySlug} by slug), ` +
      `${s.unmatched} unmatched, ${s.withTags} with tags, ${s.tagCount} distinct tags indexed`,
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
