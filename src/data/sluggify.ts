/**
 * TypeScript twin of the C# `Sluggify` (and of PF2e's own default `sluggify`).
 * Used by the coverage report to derive a live item's slug from its name when the
 * compendium index doesn't carry `system.slug`, so the slug fallback join can
 * never silently no-op. Keep this in lockstep with
 * `src/Pf2eItemFinder.Core/Tagging/Sluggify.cs`.
 */

// camelCase / PascalCase boundary -> hyphen, before lowercasing.
const LOWER_THEN_UPPER = /(\p{Ll})(\p{Lu}\p{Ll})/gu;
// Straight (U+0027) + typographic (U+2019) apostrophes are stripped, not split.
const APOSTROPHES = /['’]/g;
// Word chars: letters, marks, decimal digits, ZW join controls. Else -> separator.
const NON_WORD_CHARACTER = /[^\p{L}\p{M}\p{Nd}\u200c\u200d]/gu;
const DASH_OR_SPACE_RUNS = /[-\s]+/g;

/** Kebab-case slug for `text` (empty string for null/empty). */
export function sluggify(text: string | null | undefined): string {
  if (!text) return "";
  if (text === "-") return text;

  return text
    .replace(LOWER_THEN_UPPER, "$1-$2")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(NON_WORD_CHARACTER, " ")
    .trim()
    .replace(DASH_OR_SPACE_RUNS, "-");
}
