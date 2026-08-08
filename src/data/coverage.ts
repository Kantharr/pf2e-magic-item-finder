import { MODULE_ID } from "../constants.js";
import { sluggify } from "./sluggify.js";
import type { TagMap } from "./tag-map.js";

/** The single equipment pack the module indexes (Phase 0 section 2). */
export const EQUIPMENT_PACK_ID = "pf2e.equipment-srd";

/** UUID prefix shared by every entry in the map and every live equipment item. */
export const PACK_UUID_PREFIX = `Compendium.${EQUIPMENT_PACK_ID}.Item.`;

/** The trait that marks the magical universe the map covers. */
export const MAGICAL_TRAIT = "magical";

/**
 * Traits that mark an item as magical. PF2e stamps most magic items with the
 * literal `magical` trait, but a magic-tradition trait (arcane/divine/occult/
 * primal) and `artifact` each *imply* magic without necessarily co-listing
 * `magical` — e.g. the unique artifact "Coldstar Pistols" carries `artifact`
 * but not `magical`. Matching any of these keeps such items in the corpus.
 */
export const MAGICAL_MARKER_TRAITS: readonly string[] = [
  MAGICAL_TRAIT,
  "arcane",
  "divine",
  "occult",
  "primal",
  "artifact",
];

const MAGICAL_MARKER_SET = new Set(MAGICAL_MARKER_TRAITS);

/** True when an item's trait list carries any {@link MAGICAL_MARKER_TRAITS}. */
export function hasMagicalMarker(traits: readonly string[] | undefined): boolean {
  if (!traits) return false;
  for (const t of traits) if (MAGICAL_MARKER_SET.has(t)) return true;
  return false;
}

/**
 * `system.runes` on a weapon, armor, or shield. Every field is optional: the
 * fundamental runes are numeric grades (0 = absent) and `property` lists the
 * property-rune slugs.
 */
export interface RawRunes {
  potency?: number | null;
  striking?: number | null;
  resilient?: number | null;
  reinforcing?: number | null;
  /** Property-rune slugs. Normally an array, but a handful of pack entries carry
   * the object-shaped remnant `{"0": ""}`, so both forms are tolerated. */
  property?: readonly string[] | Record<string, string> | null;
}

/**
 * True when an item carries at least one etched rune (fundamental or property).
 * Runes are magic by definition, and the remaster's **specific magic items** —
 * "Iris of the Sky", "Robe of the Archmagi", … — are the reason this matters:
 * they are stamped with runes but *no* trait from {@link MAGICAL_MARKER_TRAITS},
 * so a trait-only predicate silently drops ~116 of the pack's magic items.
 */
export function hasMagicalRunes(runes: RawRunes | null | undefined): boolean {
  if (!runes) return false;
  if ((runes.potency ?? 0) > 0) return true;
  if ((runes.striking ?? 0) > 0) return true;
  if ((runes.resilient ?? 0) > 0) return true;
  if ((runes.reinforcing ?? 0) > 0) return true;
  const property = runes.property;
  const slugs = Array.isArray(property)
    ? property
    : property && typeof property === "object"
      ? Object.values(property)
      : [];
  return slugs.some((slug) => typeof slug === "string" && slug.length > 0);
}

/**
 * The `pack.getIndex()` field paths backing {@link hasMagicalRunes}. Requested
 * as leaves rather than the whole `system.runes` object because the server
 * projects the index one requested path at a time.
 */
export const RUNE_INDEX_FIELDS: readonly string[] = [
  "system.runes.potency",
  "system.runes.striking",
  "system.runes.resilient",
  "system.runes.reinforcing",
  "system.runes.property",
];

/** The corpus predicate: a marker trait **or** an etched rune. */
export function isMagicalItem(item: {
  traits?: readonly string[];
  runes?: RawRunes | null;
}): boolean {
  return hasMagicalMarker(item.traits) || hasMagicalRunes(item.runes);
}

/** How a map entry was resolved against the live pack (or that it wasn't). */
export interface CoverageReport {
  /** Entries in the bundled map. */
  mapEntries: number;
  /** Magical items in the live pack. */
  liveMagical: number;
  /**
   * How many live magical items carried `system.slug` in the compendium index
   * (the rest fall back to a sluggified name). If this is 0 the index isn't
   * exposing slugs on this system version, and the fallback join relies entirely
   * on the derived slug.
   */
  liveWithIndexSlug: number;
  /** Map entries resolved directly by UUID. */
  matchedByUuid: number;
  /** Map entries that missed by UUID but were rescued by the slug fallback. */
  rescuedBySlug: number;
  /** matchedByUuid + rescuedBySlug. */
  matched: number;
  /** Map entries that resolved to no live item (by UUID or slug). */
  orphans: number;
  /** Live magical items not covered by any map entry. */
  untagged: number;
  /** A few orphan UUIDs, for the diagnostics line. */
  orphanSample: string[];
  /** A few untagged live item names, for the diagnostics line. */
  untaggedSample: string[];
}

interface LiveItem {
  uuid: string;
  name: string;
  /** The join slug: `system.slug` from the index, else derived from the name. */
  slug: string;
  /** True when {@link slug} came from the index rather than the name fallback. */
  slugFromIndex: boolean;
}

/**
 * Resolve every map entry against the live `pf2e.equipment-srd` pack and count
 * matches, slug rescues, orphans, and untagged live items. Read-only: it only
 * reads the compendium index (with the two extra fields it needs), so it is safe
 * to run at `ready`.
 */
export async function computeCoverage(tagMap: TagMap): Promise<CoverageReport> {
  const pack = game.packs?.get(EQUIPMENT_PACK_ID);
  if (!pack) {
    throw new Error(
      `${MODULE_ID} | equipment pack "${EQUIPMENT_PACK_ID}" not found; is the PF2e system active?`,
    );
  }

  const live = await readLiveMagicalItems(pack);
  return summarize(tagMap, live);
}

/** Pull the magical items from the pack index with slug + traits fields. */
async function readLiveMagicalItems(pack: unknown): Promise<LiveItem[]> {
  // getIndex's typed signature varies across fvtt-types/Foundry lines; the
  // `fields` option is honoured at runtime (v12+). Cast narrowly here.
  const getIndex = (pack as {
    getIndex: (options?: { fields?: string[] }) => Promise<Iterable<RawIndexEntry>>;
  }).getIndex;
  const index = await getIndex.call(pack, {
    fields: ["system.slug", "system.traits.value", ...RUNE_INDEX_FIELDS],
  });

  const items: LiveItem[] = [];
  for (const entry of index) {
    const traits = entry.system?.traits?.value ?? [];
    if (!isMagicalItem({ traits, runes: entry.system?.runes })) continue;
    const name = entry.name ?? "(unnamed)";
    const indexSlug = entry.system?.slug ?? null;
    items.push({
      uuid: PACK_UUID_PREFIX + entry._id,
      name,
      // Fall back to a sluggified name so the slug join never silently no-ops
      // when the index omits system.slug (it maps to the same value PF2e computes).
      slug: indexSlug ?? sluggify(name),
      slugFromIndex: indexSlug !== null,
    });
  }
  return items;
}

interface RawIndexEntry {
  _id: string;
  name?: string;
  system?: {
    slug?: string | null;
    traits?: { value?: string[] };
    runes?: RawRunes | null;
  };
}

/** Pure counting core (separated so it is unit-testable without a live pack). */
export function summarize(tagMap: TagMap, live: LiveItem[]): CoverageReport {
  const liveByUuid = new Map<string, LiveItem>();
  const liveBySlug = new Map<string, LiveItem>();
  let liveWithIndexSlug = 0;
  for (const item of live) {
    liveByUuid.set(item.uuid, item);
    if (item.slug) liveBySlug.set(item.slug, item);
    if (item.slugFromIndex) liveWithIndexSlug++;
  }

  // Live items consumed by a map entry (directly or via slug) — the complement
  // is the "untagged" set.
  const covered = new Set<string>();
  let matchedByUuid = 0;
  let rescuedBySlug = 0;
  const orphanSample: string[] = [];

  for (const [uuid, entry] of Object.entries(tagMap.tags)) {
    const direct = liveByUuid.get(uuid);
    if (direct) {
      matchedByUuid++;
      covered.add(direct.uuid);
      continue;
    }
    const bySlug = entry.slug ? liveBySlug.get(entry.slug) : undefined;
    if (bySlug) {
      rescuedBySlug++;
      covered.add(bySlug.uuid);
      continue;
    }
    if (orphanSample.length < 5) orphanSample.push(uuid);
  }

  const mapEntries = Object.keys(tagMap.tags).length;
  const matched = matchedByUuid + rescuedBySlug;
  const orphans = mapEntries - matched;

  const untaggedItems = live.filter((item) => !covered.has(item.uuid));
  const untaggedSample = untaggedItems.slice(0, 5).map((item) => item.name);

  return {
    mapEntries,
    liveMagical: live.length,
    liveWithIndexSlug,
    matchedByUuid,
    rescuedBySlug,
    matched,
    orphans,
    untagged: untaggedItems.length,
    orphanSample,
    untaggedSample,
  };
}

/** One-line-per-metric console summary of a coverage report. */
export function logCoverage(report: CoverageReport, tagMap: TagMap): void {
  console.log(
    `${MODULE_ID} | coverage: ${report.matched}/${report.mapEntries} map entries matched ` +
      `(${report.matchedByUuid} by uuid, ${report.rescuedBySlug} rescued by slug), ` +
      `${report.orphans} orphans, ${report.untagged} untagged live items ` +
      `(live magical: ${report.liveMagical}, ${report.liveWithIndexSlug} with index slug; ` +
      `map built for PF2e ${tagMap.pf2eSystemVersion})`,
  );
  if (report.orphans > 0) {
    console.log(`${MODULE_ID} | coverage: orphan sample — ${report.orphanSample.join(", ")}`);
  }
  if (report.untagged > 0) {
    console.log(
      `${MODULE_ID} | coverage: untagged sample — ${report.untaggedSample.join(", ")}`,
    );
  }
}
