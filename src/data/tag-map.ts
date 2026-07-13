import { MODULE_ID } from "../constants.js";

/**
 * Runtime shape of the bundled ability-tag map (`dist/data/ability-tags.json`),
 * a pre-computed data artifact generated offline. Keep {@link TAG_MAP_SCHEMA_VERSION}
 * in lockstep with the map's `schemaVersion` header.
 */
export const TAG_MAP_SCHEMA_VERSION = 1;

/** Module-relative path the map is fetched from at `ready`. */
export const TAG_MAP_PATH = `modules/${MODULE_ID}/data/ability-tags.json`;

/** How a tag was matched to an item. */
export type MatchMethod = "structured" | "regex";

/** One item's tag data, keyed in {@link TagMap.tags} by its compendium UUID. */
export interface TagMapEntry {
  /** Fallback join key: the sluggified item name (Phase 0 section 3). */
  slug: string;
  name: string;
  /** Names of the tags matched on this item (dictionary order). */
  tags: string[];
  /** Tag name → evidence snippet (tags with no snippet are absent). */
  snippets: Record<string, string>;
  /** Tag name → how it matched. */
  matchMethod: Record<string, MatchMethod>;
}

/** A tag-dictionary category, for rendering chips/labels in the UI. */
export interface TagCategory {
  name: string;
  description: string;
}

/** The parsed, validated map plus its header metadata. */
export interface TagMap {
  schemaVersion: number;
  /** PF2e system version the map was built against. */
  pf2eSystemVersion: string;
  /** ISO-8601 UTC timestamp of the export. */
  generatedAt: string;
  /** Number of items evaluated (== `Object.keys(tags).length`). */
  itemCount: number;
  /** UUID → tag data (`Compendium.pf2e.equipment-srd.Item.<_id>`). */
  tags: Record<string, TagMapEntry>;
  /** The 21-entry tag dictionary. */
  categories: TagCategory[];
}

/**
 * Fetch, parse, and validate the bundled tag map. Throws on a missing file, bad
 * JSON, or a schema-version mismatch (an incompatible bundle is a hard error);
 * a *system*-version drift is a soft warning surfaced via
 * {@link warnOnSystemVersionMismatch}, called from the caller once `game.system`
 * is known.
 */
export async function loadTagMap(fetchImpl: typeof fetch = fetch): Promise<TagMap> {
  const response = await fetchImpl(TAG_MAP_PATH);
  if (!response.ok) {
    throw new Error(
      `${MODULE_ID} | failed to fetch tag map (${response.status} ${response.statusText}) ` +
        `from ${TAG_MAP_PATH}`,
    );
  }

  const data = (await response.json()) as Partial<TagMap>;
  return validateTagMap(data);
}

/** Structural + schema-version validation. Returns the value narrowed to a TagMap. */
export function validateTagMap(data: Partial<TagMap> | null | undefined): TagMap {
  if (!data || typeof data !== "object") {
    throw new Error(`${MODULE_ID} | tag map is empty or not an object`);
  }
  if (data.schemaVersion !== TAG_MAP_SCHEMA_VERSION) {
    throw new Error(
      `${MODULE_ID} | tag map schemaVersion ${String(data.schemaVersion)} is not the ` +
        `supported ${TAG_MAP_SCHEMA_VERSION}; rebuild the bundle with the current exporter`,
    );
  }
  if (!data.tags || typeof data.tags !== "object") {
    throw new Error(`${MODULE_ID} | tag map is missing its "tags" object`);
  }
  if (!Array.isArray(data.categories)) {
    throw new Error(`${MODULE_ID} | tag map is missing its "categories" array`);
  }
  return data as TagMap;
}

/**
 * Compare the map's build-time PF2e version against the installed system and warn
 * (console always; a UI notice when `notify` is set) when they differ — the
 * bundled `_id`s and tags are version-specific, so drift explains coverage gaps.
 */
export function warnOnSystemVersionMismatch(
  tagMap: TagMap,
  systemVersion: string | undefined,
  notify = false,
): boolean {
  if (!systemVersion || systemVersion === tagMap.pf2eSystemVersion) return false;

  const message =
    `${MODULE_ID} | tag map was built for PF2e ${tagMap.pf2eSystemVersion} but the ` +
    `installed system is ${systemVersion}; some items may not match (see the coverage report)`;
  console.warn(message);
  if (notify) ui.notifications?.warn(message);
  return true;
}
