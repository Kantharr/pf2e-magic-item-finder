import { MODULE_ID } from "../constants.js";
import { sluggify } from "./sluggify.js";
import type { TagMap } from "./tag-map.js";

/** The single equipment pack the module indexes (Phase 0 section 2). */
export const EQUIPMENT_PACK_ID = "pf2e.equipment-srd";

/** UUID prefix shared by every entry in the map and every live equipment item. */
export const PACK_UUID_PREFIX = `Compendium.${EQUIPMENT_PACK_ID}.Item.`;

/** The trait that marks the magical universe the map covers. */
export const MAGICAL_TRAIT = "magical";

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
    fields: ["system.slug", "system.traits.value"],
  });

  const items: LiveItem[] = [];
  for (const entry of index) {
    const traits = entry.system?.traits?.value ?? [];
    if (!traits.includes(MAGICAL_TRAIT)) continue;
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
  system?: { slug?: string | null; traits?: { value?: string[] } };
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
