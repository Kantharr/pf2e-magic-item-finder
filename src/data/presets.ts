import { MODULE_ID } from "../constants.js";
import type { FilterOptionLists, FilterState, SortDir, SortField } from "../search/query-engine.js";

/**
 * Phase 6 — named filter presets, the Foundry-native mirror of the desktop
 * `FilterPresetService` (see `src/Pf2eItemFinder.Core/Data/FilterPresetService.cs`).
 *
 * Presets live in a **client-scoped** `game.settings` value (per-user, per-world,
 * survives reloads) rather than a SQLite table. The filter state is serialized
 * **by name** — selected rarities, traits, ability tags are stored as their
 * display names/slugs, never internal ids — so a preset keeps working after the
 * index is rebuilt and any name that no longer exists is silently dropped on load
 * ({@link coerceAppliedState}).
 */

/** Settings key under the module namespace holding the preset array. */
export const PRESETS_SETTING = "filterPresets";

/** One stored preset: a display name, the serialized filter state, and a UTC
 * ISO-8601 creation timestamp (parses/sorts deterministically across locales). */
export interface StoredPreset {
  name: string;
  state: FilterState;
  createdAt: string;
}

/** Register the client-scoped presets setting. Called from the module `init`
 * hook alongside the other settings. Not shown in the config UI (`config: false`)
 * — presets are managed from the search window. */
export function registerPresetSetting(): void {
  game.settings?.register(MODULE_ID, PRESETS_SETTING, {
    scope: "client",
    config: false,
    type: Array,
    default: [] as StoredPreset[],
  });
}

/** Raw read of the stored array (defensive: anything malformed → empty list). */
function read(): StoredPreset[] {
  const raw = game.settings?.get(MODULE_ID, PRESETS_SETTING) as unknown;
  return Array.isArray(raw) ? (raw as StoredPreset[]) : [];
}

/** Persist the array back to the client setting. */
async function write(list: StoredPreset[]): Promise<void> {
  await game.settings?.set(MODULE_ID, PRESETS_SETTING, list);
}

/** Case-insensitive name comparison used for both sorting and upsert/lookup. */
function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

/** All presets, ordered by name (case-insensitive) — mirrors the desktop's
 * `ORDER BY name COLLATE NOCASE`. */
export function listPresets(): StoredPreset[] {
  return [...read()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Find a preset by name (case-insensitive), or null. */
export function getPreset(name: string): StoredPreset | null {
  return read().find((p) => sameName(p.name, name)) ?? null;
}

/**
 * Strip a filter state down to a plain, serializable snapshot: only the known
 * fields, undefined/empty dropped, arrays copied. This keeps the stored JSON
 * small and free of transient UI-only keys.
 */
function sanitizeState(state: FilterState): FilterState {
  const out: FilterState = {};
  const text = state.text?.trim();
  if (text) out.text = text;
  if (state.minLevel != null) out.minLevel = state.minLevel;
  if (state.maxLevel != null) out.maxLevel = state.maxLevel;
  if (state.minPriceGp != null) out.minPriceGp = state.minPriceGp;
  if (state.maxPriceGp != null) out.maxPriceGp = state.maxPriceGp;
  if (state.includePriceless) out.includePriceless = true;
  if (state.rarities?.length) out.rarities = [...state.rarities];
  if (state.traits?.length) out.traits = [...state.traits];
  if (state.tags?.length) out.tags = [...state.tags];
  if (state.sort) out.sort = state.sort;
  if (state.sortDir) out.sortDir = state.sortDir;
  return out;
}

/**
 * Insert a new preset or overwrite the existing one with the same name
 * (case-insensitive upsert, mirroring the desktop `ON CONFLICT(name)`). A
 * re-save keeps the original `createdAt`. The name is trimmed; a blank name
 * throws. Returns the stored preset.
 */
export async function savePreset(name: string, state: FilterState): Promise<StoredPreset> {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) throw new Error("Preset name cannot be blank.");

  const list = read();
  const existing = list.find((p) => sameName(p.name, trimmed));
  const preset: StoredPreset = {
    // Preserve the existing display name's casing on overwrite is not required;
    // adopt the freshly entered name so a re-save can also fix capitalization.
    name: trimmed,
    state: sanitizeState(state),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const next = existing
    ? list.map((p) => (p === existing ? preset : p))
    : [...list, preset];
  await write(next);
  return preset;
}

/**
 * Rename a preset. Throws on a blank new name, if the source doesn't exist, or
 * if the new name collides with a *different* preset (case-insensitive) —
 * mirroring the desktop's UNIQUE-constraint behavior. Renaming to the same name
 * (case change only) is allowed.
 */
export async function renamePreset(oldName: string, newName: string): Promise<void> {
  const trimmed = (newName ?? "").trim();
  if (trimmed.length === 0) throw new Error("Preset name cannot be blank.");

  const list = read();
  const target = list.find((p) => sameName(p.name, oldName));
  if (!target) throw new Error(`Preset "${oldName}" no longer exists.`);

  const collision = list.find((p) => p !== target && sameName(p.name, trimmed));
  if (collision) throw new Error(`A preset named "${trimmed}" already exists.`);

  await write(list.map((p) => (p === target ? { ...p, name: trimmed } : p)));
}

/** Delete a preset by name (case-insensitive). Returns false if it didn't exist. */
export async function deletePreset(name: string): Promise<boolean> {
  const list = read();
  const next = list.filter((p) => !sameName(p.name, name));
  if (next.length === list.length) return false;
  await write(next);
  return true;
}

/**
 * Re-materialize a stored preset's state against the *current* option lists,
 * dropping any rarity/trait/ability-tag whose name no longer exists (graceful
 * degradation after a re-index). Numeric bounds, text, sort, and toggles are
 * carried through as-is.
 */
export function coerceAppliedState(
  state: FilterState,
  options: FilterOptionLists,
): FilterState {
  const tagNames = new Set(options.tags.map((t) => t.name));
  const traitSet = new Set(options.traits);
  const raritySet = new Set(options.rarities);

  const keep = (values: readonly string[] | undefined, allowed: Set<string>): string[] | undefined => {
    if (!values?.length) return undefined;
    const kept = values.filter((v) => allowed.has(v));
    return kept.length ? kept : undefined;
  };

  const sortFields: SortField[] = ["name", "level", "price", "relevance"];
  const sortDirs: SortDir[] = ["asc", "desc"];

  return {
    text: state.text?.trim() || undefined,
    minLevel: state.minLevel ?? undefined,
    maxLevel: state.maxLevel ?? undefined,
    minPriceGp: state.minPriceGp ?? undefined,
    maxPriceGp: state.maxPriceGp ?? undefined,
    includePriceless: state.includePriceless ? true : undefined,
    rarities: keep(state.rarities, raritySet),
    traits: keep(state.traits, traitSet),
    tags: keep(state.tags, tagNames),
    sort: state.sort && sortFields.includes(state.sort) ? state.sort : undefined,
    sortDir: state.sortDir && sortDirs.includes(state.sortDir) ? state.sortDir : undefined,
  };
}
