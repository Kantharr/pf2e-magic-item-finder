/**
 * Rune classification — which of Pathfinder's seven rune families an equipment
 * item belongs to, backing the rune filter axis alongside weapon group and armor
 * category.
 *
 * **Why a bundled slug list rather than a predicate over index fields.** The
 * live pack carries no field that names a rune's family. The two fields that
 * come closest each mis-sort a real chunk of the corpus:
 *
 * - `system.usage.value` says what a rune is applied *to*, which is not the same
 *   question. Half the accessory runes read `applied-to-shield` or
 *   `applied-to-footwear`, and so do plain adjustments like *Throwing Shield*
 *   and *Armor Latches*, which are not runes at all.
 * - PF2e's icon paths (`icons/equipment/runes/<family>/…`) are close, but file
 *   *Catching*, *Menacing*, *Preserving*, *Trackless* and *Unexceptional* under
 *   the weapon/armor property folders when all five are accessory runes, put
 *   *Rock-Braced* and *Sinister Knight* on the wrong side of the weapon/armor
 *   line, and give the relic seed *Adamantine Echo* a fundamental-armor icon.
 *
 * So the families below are transcribed from the Archives of Nethys rune
 * subcategories (the same seven the filter offers) and keyed by `system.slug`,
 * which is stable across PF2e releases in a way uuids and display names are not.
 * Every slug here was verified present in `pf2e.equipment-srd` at PF2e 8.4.0.
 *
 * To refresh after a PF2e release: diff the pack's rune items against
 * {@link RUNE_SLUGS} — anything new lands unclassified (`null`) and simply does
 * not answer the rune filter, so a stale list under-reports rather than lies.
 */

/** One of the seven rune families, as its stable filter value. */
export type RuneKind =
  | "accessory"
  | "armor-property"
  | "clan-dagger"
  | "fundamental-armor"
  | "fundamental-weapon"
  | "shield"
  | "weapon-property";

/** Display order for the rune chips (alphabetical by English label). */
export const RUNE_KIND_ORDER: readonly RuneKind[] = [
  "accessory",
  "armor-property",
  "clan-dagger",
  "fundamental-armor",
  "fundamental-weapon",
  "shield",
  "weapon-property",
];

/**
 * `system.slug` of every rune in the equipment pack, by family.
 *
 * A few entries are worth calling out because they read as surprises:
 * `called` is the accessory rune while `called-lastwall` is the weapon one;
 * the clan dagger filigrees are weapon property runes to PF2e's own data model
 * but get their own family here, matching how the rules present them.
 */
const RUNE_SLUGS: Readonly<Record<RuneKind, readonly string[]>> = {
  accessory: [
    "called", "catching", "dragons-breath-1st-level-spell", "dragons-breath-2nd-level-spell",
    "dragons-breath-3rd-level-spell", "dragons-breath-4th-level-spell",
    "dragons-breath-5th-level-spell", "dragons-breath-6th-level-spell",
    "dragons-breath-7th-level-spell", "dragons-breath-8th-level-spell",
    "dragons-breath-9th-level-spell", "menacing", "menacing-greater", "paired",
    "paired-greater", "paired-major", "pontoon", "presentable", "presentable-greater",
    "preserving", "preserving-greater", "retaliation-greater", "retaliation-lesser",
    "retaliation-major", "retaliation-moderate", "snagging", "soft-landing", "spell-bastion",
    "trackless", "trackless-greater", "unexceptional", "wind-catcher", "wind-catcher-greater",
  ],
  "armor-property": [
    "advancing", "advancing-greater", "aim-aiding", "antimagic", "assisting", "bitter",
    "caverns-heart", "convincing", "convincing-greater", "convincing-major", "deathless",
    "dread-greater", "dread-lesser", "dread-moderate", "energy-absorbing",
    "energy-absorbing-greater", "energy-adaptive", "energy-resistant",
    "energy-resistant-greater", "ethereal", "fortification", "fortification-greater",
    "gliding", "immovable", "implacable", "invisibility", "invisibility-greater",
    "magnetizing", "malleable", "misleading", "mobile", "moonweave", "moonweave-greater",
    "moonweave-major", "portable", "quenching", "quenching-greater", "quenching-major",
    "quenching-true", "raiment", "ready", "ready-greater", "rock-braced", "safeguarding",
    "self-sealing", "shadow", "shadow-greater", "shadow-major", "sidestepping",
    "sinister-knight", "size-changing", "slick", "slick-greater", "slick-major", "soaring",
    "spellwatch", "stanching", "stanching-greater", "stanching-major", "stanching-true",
    "sunweave", "sunweave-greater", "sunweave-major", "swallow-spike", "swallow-spike-greater",
    "swallow-spike-major", "unnerving", "winged", "winged-greater",
  ],
  "clan-dagger": [
    "bolkas-blessing", "bolkas-blessing-greater", "kolss-oath", "kolss-oath-greater",
    "trudds-strength", "trudds-strength-greater",
  ],
  "fundamental-armor": [
    "armor-potency-1", "armor-potency-2", "armor-potency-3", "mythic-armor-potency",
    "mythic-resilient", "resilient", "resilient-greater", "resilient-major",
  ],
  "fundamental-weapon": [
    "mythic-striking", "mythic-weapon-potency", "striking", "striking-greater",
    "striking-major", "weapon-potency-1", "weapon-potency-2", "weapon-potency-3",
  ],
  shield: [
    "reinforcing-rune-greater", "reinforcing-rune-lesser", "reinforcing-rune-major",
    "reinforcing-rune-minor", "reinforcing-rune-moderate", "reinforcing-rune-supreme",
  ],
  "weapon-property": [
    "ancestral-echoing", "anchoring", "anchoring-greater", "animated", "ashen",
    "ashen-greater", "astral", "astral-greater", "authorized", "bane", "bloodbane",
    "bloodbane-greater", "bloodthirsty", "brilliant", "brilliant-greater", "called-lastwall",
    "coating", "conducting", "corrosive", "corrosive-greater", "crushing", "crushing-greater",
    "cunning", "deathdrinking", "decaying", "decaying-greater", "deflecting", "demolishing",
    "earthbinding", "energizing", "energy-vulnerability", "energy-vulnerability-greater",
    "extending", "extending-greater", "fanged", "fanged-greater", "fanged-major", "fearsome",
    "fearsome-greater", "flaming", "flaming-greater", "flickering", "flurrying", "frost",
    "frost-greater", "ghost-touch", "giant-killing", "giant-killing-greater", "grievous",
    "hauling", "hauling-greater", "holy", "hooked", "hopeful", "impactful",
    "impactful-greater", "impossible", "keen", "kin-warding", "merciful", "nightmare",
    "pacifying", "quickstrike", "returning", "rooting", "rooting-greater", "rooting-major",
    "rooting-true", "serrating", "shifting", "shock", "shock-greater", "shockwave",
    "spell-reservoir", "swarming", "thundering", "thundering-greater", "underwater", "unholy",
    "vitalizing", "vitalizing-greater", "vorpal", "wounding",
  ],
};

/** Inverted {@link RUNE_SLUGS}: slug → family, built once at module load. */
const SLUG_TO_KIND: ReadonlyMap<string, RuneKind> = new Map(
  RUNE_KIND_ORDER.flatMap((kind) => RUNE_SLUGS[kind].map((slug) => [slug, kind] as const)),
);

/**
 * The rune family an item belongs to, or `null` for anything that isn't a rune
 * — which is the overwhelming majority of the corpus, and also how an as-yet
 * unclassified new rune reads.
 */
export function runeKind(slug: string | null | undefined): RuneKind | null {
  if (!slug) return null;
  return SLUG_TO_KIND.get(slug) ?? null;
}

/** Every classified rune slug (diagnostics + tests). */
export function runeSlugs(kind: RuneKind): readonly string[] {
  return RUNE_SLUGS[kind];
}
