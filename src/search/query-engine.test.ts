import { describe, it, expect } from "vitest";
import type { IndexedItem, ItemIndex, WeaponHands } from "../data/item-index.js";
import type { RuneKind } from "../data/runes.js";
import { createSearchEngine, parseQueryText, type FilterState } from "./query-engine.js";

/**
 * Phase 4 verification. A small, hand-built fixture with known
 * tags/traits/levels/prices exercises each filter in isolation, the
 * AND-across / OR-within combination rules, the text ∩ structured intersection,
 * the sort orderings, and the priceless handling — all headless (no Foundry).
 */

/** Spec for one fixture item; unspecified fields get sensible defaults. */
interface ItemSpec {
  name: string;
  level: number;
  rarity: string;
  traits: string[];
  priceGp: number | null;
  tags: string[];
  description?: string;
  /** Item document type (default "equipment"); "weapon"/"armor" drive type filters. */
  type?: string;
  /** system.category (simple/martial for weapons; light/medium/heavy for armor). */
  category?: string | null;
  /** system.group (weapon group, e.g. firearm/sword; armor group). */
  group?: string | null;
  /** Hands the weapon occupies ("1" / "1+" / "2"); non-weapons leave this null. */
  hands?: WeaponHands | null;
  /** Rune family; non-runes (everything else) leave this null. */
  runeKind?: RuneKind | null;
  /** Whether the item is magical. Defaults to true, so the pre-existing fixture
   * (all magic items) keeps its original meaning. */
  magical?: boolean;
}

/** Build a full {@link IndexedItem} from a terse spec (uuid derived from name). */
function makeItem(spec: ItemSpec): IndexedItem {
  const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    uuid: `Compendium.pf2e.equipment-srd.Item.${slug}`,
    id: slug,
    name: spec.name,
    level: spec.level,
    rarity: spec.rarity,
    traits: spec.traits,
    priceGp: spec.priceGp,
    source: "Test",
    slug,
    img: null,
    type: spec.type ?? "equipment",
    category: spec.category ?? null,
    group: spec.group ?? null,
    hands: spec.hands ?? null,
    runeKind: spec.runeKind ?? null,
    magical: spec.magical ?? true,
    tags: spec.tags,
    snippets: {},
    matchMethod: {},
    joinedBy: spec.tags.length > 0 ? "uuid" : null,
  };
}

/** Assemble an {@link ItemIndex} (byUuid + inverted tag index) from specs. */
function makeIndex(specs: ItemSpec[]): ItemIndex {
  const items = specs.map(makeItem);
  const byUuid = new Map<string, IndexedItem>();
  const tagToItemIds = new Map<string, string[]>();
  for (const item of items) {
    byUuid.set(item.uuid, item);
    for (const tag of item.tags) {
      const ids = tagToItemIds.get(tag);
      if (ids) ids.push(item.uuid);
      else tagToItemIds.set(tag, [item.uuid]);
    }
  }
  return {
    items,
    byUuid,
    tagToItemIds,
    builtAt: 0,
    stats: {
      total: items.length,
      magical: items.filter((i) => i.magical).length,
      mundane: items.filter((i) => !i.magical).length,
      matched: items.filter((i) => i.tags.length > 0).length,
      matchedByUuid: items.filter((i) => i.tags.length > 0).length,
      rescuedBySlug: 0,
      unmatched: items.filter((i) => i.tags.length === 0).length,
      withTags: items.filter((i) => i.tags.length > 0).length,
      tagCount: tagToItemIds.size,
    },
  };
}

// The fixture: six magical items with distinct, known attributes.
const SPECS: ItemSpec[] = [
  {
    name: "Amulet of Fire",
    level: 3,
    rarity: "common",
    traits: ["abjuration", "magical"],
    priceGp: 100,
    tags: ["Damage", "Fire"],
    description: "A cursed blazing amulet that scorches foes.",
  },
  {
    name: "Boots of Speed",
    level: 5,
    rarity: "uncommon",
    traits: ["transmutation", "magical"],
    priceGp: 500,
    tags: ["Movement"],
    description: "Grants a burst of great speed.",
  },
  {
    name: "Cloak of Elvenkind",
    level: 7,
    rarity: "uncommon",
    traits: ["conjuration", "magical"],
    priceGp: 250,
    tags: ["Stealth"],
    description: "Blends the wearer into the shadows.",
  },
  {
    name: "Dagger of Doom",
    level: 3,
    rarity: "rare",
    traits: ["evocation", "magical"],
    priceGp: 1000,
    tags: ["Damage"],
    description: "A cursed blade whispering of doom.",
  },
  {
    name: "Everlasting Rations",
    level: 1,
    rarity: "common",
    traits: ["magical"],
    priceGp: null, // priceless
    tags: [],
    description: "Food that never runs out.",
  },
  {
    name: "Flaming Sphere Wand",
    level: 4,
    rarity: "common",
    traits: ["evocation", "magical"],
    priceGp: 60,
    tags: ["Fire", "Damage"],
    description: "Conjures a rolling sphere of flame.",
  },
];

const CATEGORIES = ["Damage", "Fire", "Movement", "Stealth", "Healing"];

/** Build an engine with descriptions folded into the text index. */
function makeEngine() {
  const index = makeIndex(SPECS);
  const descriptions: Record<string, string> = {};
  for (const item of index.items) {
    const spec = SPECS.find((s) => s.name === item.name);
    if (spec?.description) descriptions[item.uuid] = spec.description;
  }
  return createSearchEngine(index, { categories: CATEGORIES, descriptions });
}

/** Convenience: run a query and return matched names (in result order). */
function names(state: FilterState): string[] {
  return makeEngine().query(state).items.map((i) => i.name);
}

describe("empty query", () => {
  it("returns the full corpus", () => {
    const result = makeEngine().query({});
    expect(result.total).toBe(SPECS.length);
    expect(result.items).toHaveLength(SPECS.length);
  });
});

describe("each filter alone narrows correctly", () => {
  it("ability-tag filter (OR within) via the inverted index", () => {
    expect(names({ tags: ["Fire"] }).sort()).toEqual(["Amulet of Fire", "Flaming Sphere Wand"]);
    // OR within: Movement OR Stealth.
    expect(names({ tags: ["Movement", "Stealth"] }).sort()).toEqual([
      "Boots of Speed",
      "Cloak of Elvenkind",
    ]);
    // An item carrying two selected tags appears once (de-duped).
    expect(names({ tags: ["Fire", "Damage"] }).sort()).toEqual([
      "Amulet of Fire",
      "Dagger of Doom",
      "Flaming Sphere Wand",
    ]);
  });

  it("level range (inclusive, tolerates the null-free fixture)", () => {
    expect(names({ minLevel: 4 }).sort()).toEqual([
      "Boots of Speed",
      "Cloak of Elvenkind",
      "Flaming Sphere Wand",
    ]);
    expect(names({ maxLevel: 3 }).sort()).toEqual([
      "Amulet of Fire",
      "Dagger of Doom",
      "Everlasting Rations",
    ]);
    expect(names({ minLevel: 3, maxLevel: 4 }).sort()).toEqual([
      "Amulet of Fire",
      "Dagger of Doom",
      "Flaming Sphere Wand",
    ]);
  });

  it("rarity multi-select (OR within)", () => {
    expect(names({ rarities: ["rare"] })).toEqual(["Dagger of Doom"]);
    expect(names({ rarities: ["uncommon", "rare"] }).sort()).toEqual([
      "Boots of Speed",
      "Cloak of Elvenkind",
      "Dagger of Doom",
    ]);
  });

  it("traits multi-select (OR within)", () => {
    expect(names({ traits: ["evocation"] }).sort()).toEqual([
      "Dagger of Doom",
      "Flaming Sphere Wand",
    ]);
    expect(names({ traits: ["abjuration", "transmutation"] }).sort()).toEqual([
      "Amulet of Fire",
      "Boots of Speed",
    ]);
  });

  it("price range excludes priceless items by default", () => {
    // Everlasting Rations (priceless) is out of any numeric range.
    expect(names({ minPriceGp: 0 })).not.toContain("Everlasting Rations");
    expect(names({ minPriceGp: 100, maxPriceGp: 500 }).sort()).toEqual([
      "Amulet of Fire",
      "Boots of Speed",
      "Cloak of Elvenkind",
    ]);
  });

  it("include-priceless toggle keeps null-price items in a range", () => {
    const withPriceless = names({ minPriceGp: 100, includePriceless: true });
    expect(withPriceless).toContain("Everlasting Rations");
    // Priced items still respect the bound.
    expect(withPriceless).not.toContain("Flaming Sphere Wand"); // 60 < 100
  });
});

describe("AND across categories, OR within", () => {
  it("combines a multi-category query correctly", () => {
    // (Damage OR Fire tags) AND level<=3 AND rarity in {common,rare}
    const result = names({
      tags: ["Damage", "Fire"],
      maxLevel: 3,
      rarities: ["common", "rare"],
    });
    // Candidates by tag: Amulet(3,common), Dagger(3,rare), Flaming(4,common).
    // Flaming drops on level>3; both others pass rarity.
    expect(result.sort()).toEqual(["Amulet of Fire", "Dagger of Doom"]);
  });

  it("an unsatisfiable category yields no rows", () => {
    expect(names({ tags: ["Stealth"], rarities: ["common"] })).toEqual([]);
  });
});

describe("full-text ∩ structured", () => {
  it("text alone matches name (prefix)", () => {
    expect(names({ text: "boots" })).toEqual(["Boots of Speed"]);
  });

  it("text alone matches description body", () => {
    // "cursed" appears only in Amulet + Dagger descriptions.
    expect(names({ text: "cursed" }).sort()).toEqual(["Amulet of Fire", "Dagger of Doom"]);
  });

  it("intersects the text candidate set with structured filters", () => {
    // cursed → {Amulet, Dagger}; rarity rare → {Dagger}.
    expect(names({ text: "cursed", rarities: ["rare"] })).toEqual(["Dagger of Doom"]);
  });

  it("no text match short-circuits to empty regardless of structured filters", () => {
    expect(names({ text: "zzzznomatch", rarities: ["common"] })).toEqual([]);
  });
});

describe("search spans names and descriptions", () => {
  it("keeps name-only matches alongside body matches", () => {
    // "boots" hits a name and nothing in any description body; "shadows" is
    // carried only by a body. A single query has to surface both kinds.
    expect(names({ text: "boots" })).toEqual(["Boots of Speed"]);
    expect(names({ text: "shadows" })).toEqual(["Cloak of Elvenkind"]);
  });

  it("still intersects body matches with the structured filters", () => {
    expect(names({ text: "cursed" }).sort()).toEqual(["Amulet of Fire", "Dagger of Doom"]);
    expect(names({ text: "cursed", rarities: ["rare"] })).toEqual(["Dagger of Doom"]);
  });

  it("matches names only until setDescriptions supplies the body text", async () => {
    const index = makeIndex(SPECS);
    const engine = createSearchEngine(index, { categories: CATEGORIES });
    expect(engine.hasDescriptions).toBe(false);

    // Names work immediately, so the window is usable while the descriptions
    // are still loading; body-only terms simply find nothing yet.
    expect(engine.query({ text: "boots" }).items.map((i) => i.name)).toEqual(["Boots of Speed"]);
    expect(engine.query({ text: "cursed" }).total).toBe(0);

    const descriptions: Record<string, string> = {};
    for (const item of index.items) {
      const spec = SPECS.find((s) => s.name === item.name);
      if (spec?.description) descriptions[item.uuid] = spec.description;
    }
    await engine.setDescriptions(descriptions);

    // Once loaded, the same query widens to the body matches — and the name
    // match still works.
    expect(engine.hasDescriptions).toBe(true);
    expect(
      engine.query({ text: "cursed" }).items.map((i) => i.name).sort(),
    ).toEqual(["Amulet of Fire", "Dagger of Doom"]);
    expect(engine.query({ text: "boots" }).items.map((i) => i.name)).toEqual(["Boots of Speed"]);
  });
});

describe("exclusion terms (-word)", () => {
  it("splits a raw query into positive and negative halves", () => {
    expect(parseQueryText("flight -staff")).toEqual({ include: "flight", exclude: ["staff"] });
    expect(parseQueryText("-staff")).toEqual({ include: null, exclude: ["staff"] });
    expect(parseQueryText("  fire   -wand  -staff ")).toEqual({
      include: "fire",
      exclude: ["wand", "staff"],
    });
    expect(parseQueryText("fire")).toEqual({ include: "fire", exclude: [] });
    expect(parseQueryText(undefined)).toEqual({ include: null, exclude: [] });
    expect(parseQueryText("   ")).toEqual({ include: null, exclude: [] });
  });

  it("lower-cases exclusions but leaves positive terms alone", () => {
    expect(parseQueryText("Fire -STAFF")).toEqual({ include: "Fire", exclude: ["staff"] });
  });

  it("only treats a leading dash as an exclusion", () => {
    // Hyphenated words are ordinary terms, and a bare dash excludes nothing
    // (rather than excluding the empty string, which would match everything).
    expect(parseQueryText("fatal-aim")).toEqual({ include: "fatal-aim", exclude: [] });
    expect(parseQueryText("fire - wand")).toEqual({ include: "fire wand", exclude: [] });
    expect(parseQueryText("-")).toEqual({ include: null, exclude: [] });
  });

  it("filters the whole corpus when the query is only exclusions", () => {
    // No positive term: everything survives except the cursed items.
    expect(names({ text: "-cursed" }).sort()).toEqual([
      "Boots of Speed",
      "Cloak of Elvenkind",
      "Everlasting Rations",
      "Flaming Sphere Wand",
    ]);
  });

  it("subtracts from a positive match", () => {
    expect(names({ text: "cursed" }).sort()).toEqual(["Amulet of Fire", "Dagger of Doom"]);
    expect(names({ text: "cursed -amulet" })).toEqual(["Dagger of Doom"]);
  });

  it("excludes on the description body, not just the name", () => {
    // "flame" appears only in Flaming Sphere Wand's description.
    expect(names({ text: "-flame" })).not.toContain("Flaming Sphere Wand");
    expect(names({ text: "-flame" })).toContain("Amulet of Fire");
  });

  it("applies every exclusion (AND, not OR)", () => {
    const kept = names({ text: "-cursed -speed" }).sort();
    expect(kept).toEqual(["Cloak of Elvenkind", "Everlasting Rations", "Flaming Sphere Wand"]);
  });

  it("matches substrings, so -flam also hides Flaming Sphere Wand", () => {
    // Exclusion is literal substring, not MiniSearch prefix/fuzzy — a partial
    // word hides anything containing it.
    expect(names({ text: "-flam" })).not.toContain("Flaming Sphere Wand");
    // …and fuzzy near-misses are NOT excluded ("doom" must not drop "Boots").
    expect(names({ text: "-doom" })).toContain("Boots of Speed");
  });

  it("AND-intersects with the structured filters", () => {
    expect(names({ text: "-cursed", rarities: ["common"] }).sort()).toEqual([
      "Everlasting Rations",
      "Flaming Sphere Wand",
    ]);
  });

  it("excludes on names before descriptions are loaded", () => {
    const engine = createSearchEngine(makeIndex(SPECS), { categories: CATEGORIES });
    // Name-only haystack: the name match is excluded…
    expect(engine.query({ text: "-amulet" }).items.map((i) => i.name)).not.toContain(
      "Amulet of Fire",
    );
    // …but a body-only term can't hide anything yet.
    expect(engine.query({ text: "-cursed" }).total).toBe(SPECS.length);
  });

  it("rebuilds the haystack when descriptions arrive", async () => {
    const index = makeIndex(SPECS);
    const engine = createSearchEngine(index, { categories: CATEGORIES });
    // Build the name-only haystack first, so the rebuild is what's under test.
    expect(engine.query({ text: "-cursed" }).total).toBe(SPECS.length);

    const descriptions: Record<string, string> = {};
    for (const item of index.items) {
      const spec = SPECS.find((s) => s.name === item.name);
      if (spec?.description) descriptions[item.uuid] = spec.description;
    }
    await engine.setDescriptions(descriptions);

    expect(engine.query({ text: "-cursed" }).items.map((i) => i.name).sort()).toEqual([
      "Boots of Speed",
      "Cloak of Elvenkind",
      "Everlasting Rations",
      "Flaming Sphere Wand",
    ]);
  });
});

describe("chunked description rebuild", () => {
  /** The description map the fixture's engine is upgraded with. */
  function descriptionsFor(index: ItemIndex): Record<string, string> {
    const out: Record<string, string> = {};
    for (const item of index.items) {
      const spec = SPECS.find((s) => s.name === item.name);
      if (spec?.description) out[item.uuid] = spec.description;
    }
    return out;
  }

  it("never exposes a half-built index while the rebuild is in flight", async () => {
    const index = makeIndex(SPECS);
    const engine = createSearchEngine(index, { categories: CATEGORIES });

    // Start the rebuild but do NOT await it, then query on the very next tick —
    // the chunked build yields, so this lands mid-build.
    const pending = engine.setDescriptions(descriptionsFor(index));

    // The old name-only index is still the live one: a body-only term finds
    // nothing (narrower), and a name term still works (correct).
    expect(engine.hasDescriptions).toBe(false);
    expect(engine.query({ text: "cursed" }).total).toBe(0);
    expect(engine.query({ text: "boots" }).items.map((i) => i.name)).toEqual(["Boots of Speed"]);

    await pending;

    // Only after it resolves does the corpus widen.
    expect(engine.hasDescriptions).toBe(true);
    expect(engine.query({ text: "cursed" }).items.map((i) => i.name).sort()).toEqual([
      "Amulet of Fire",
      "Dagger of Doom",
    ]);
  });

  it("indexes every document across chunk boundaries", async () => {
    // The main fixture is smaller than one chunk, so nothing here would catch a
    // document dropped at a seam. 250 items spans several chunks.
    const many: ItemSpec[] = Array.from({ length: 250 }, (_, i) => ({
      name: `Widget ${i}`,
      level: 1,
      rarity: "common",
      traits: ["magical"],
      priceGp: 10,
      tags: [],
      description: `body marker unique${i} filler text`,
    }));
    const index = makeIndex(many);
    const engine = createSearchEngine(index, { categories: CATEGORIES });
    const descriptions: Record<string, string> = {};
    for (const item of index.items) {
      descriptions[item.uuid] = many.find((s) => s.name === item.name)!.description!;
    }

    await engine.setDescriptions(descriptions);

    // A term every body shares: 250 hits means no document was dropped.
    expect(engine.query({ text: "marker" }).total).toBe(250);
    // And each item on either side of a seam is individually findable. Uses
    // toContain, not toEqual — the engine's fuzzy matching also surfaces
    // near-identical neighbours like "unique3" for "unique0", which is correct
    // behaviour here and not what this test is about.
    for (const i of [0, 99, 100, 101, 199, 200, 249]) {
      expect(engine.query({ text: `unique${i}` }).items.map((x) => x.name)).toContain(
        `Widget ${i}`,
      );
    }
  });

  it("lets a later rebuild supersede an in-flight one", async () => {
    const index = makeIndex(SPECS);
    const engine = createSearchEngine(index, { categories: CATEGORIES });
    const full = descriptionsFor(index);

    // Kick off a build with the real bodies, then immediately supersede it with
    // an empty one. The stale build must not win the swap when it finishes.
    const stale = engine.setDescriptions(full);
    const winner = engine.setDescriptions({});
    await Promise.all([stale, winner]);

    expect(engine.hasDescriptions).toBe(false);
    expect(engine.query({ text: "cursed" }).total).toBe(0);
  });
});

describe("sorting is stable and correct", () => {
  it("sorts by name ascending by default", () => {
    expect(names({})).toEqual([
      "Amulet of Fire",
      "Boots of Speed",
      "Cloak of Elvenkind",
      "Dagger of Doom",
      "Everlasting Rations",
      "Flaming Sphere Wand",
    ]);
  });

  it("sorts by name descending", () => {
    expect(names({ sort: "name", sortDir: "desc" })).toEqual([
      "Flaming Sphere Wand",
      "Everlasting Rations",
      "Dagger of Doom",
      "Cloak of Elvenkind",
      "Boots of Speed",
      "Amulet of Fire",
    ]);
  });

  it("sorts by level with a stable tie-break (index order)", () => {
    // Levels: Rations 1, Amulet 3, Dagger 3, Flaming 4, Boots 5, Cloak 7.
    // Amulet precedes Dagger in the fixture, so the level-3 tie keeps that order.
    expect(names({ sort: "level" })).toEqual([
      "Everlasting Rations",
      "Amulet of Fire",
      "Dagger of Doom",
      "Flaming Sphere Wand",
      "Boots of Speed",
      "Cloak of Elvenkind",
    ]);
  });

  it("sorts by price with priceless items last in both directions", () => {
    const asc = names({ sort: "price" });
    expect(asc[asc.length - 1]).toBe("Everlasting Rations"); // null sorts last
    expect(asc.slice(0, 3)).toEqual(["Flaming Sphere Wand", "Amulet of Fire", "Cloak of Elvenkind"]);
  });

  it("relevance ordering ranks text matches, degrading to name without text", () => {
    // With text, name-field hits outrank description hits (name boost).
    const relevance = makeEngine().query({ text: "flame", sort: "relevance" });
    expect(relevance.items[0]?.name).toBe("Flaming Sphere Wand");
    // Without text, relevance falls back to name order.
    expect(names({ sort: "relevance" })[0]).toBe("Amulet of Fire");
  });
});

describe("result cap", () => {
  it("caps returned rows but reports the full total", () => {
    const result = makeEngine().query({}, { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(SPECS.length);
  });
});

describe("pagination (limit + offset)", () => {
  it("pages through name-ordered results without gaps or overlap", () => {
    const engine = makeEngine();
    const page1 = engine.query({}, { limit: 2, offset: 0 });
    const page2 = engine.query({}, { limit: 2, offset: 2 });
    const page3 = engine.query({}, { limit: 2, offset: 4 });
    const page4 = engine.query({}, { limit: 2, offset: 6 });

    expect(page1.items.map((i) => i.name)).toEqual(["Amulet of Fire", "Boots of Speed"]);
    expect(page2.items.map((i) => i.name)).toEqual(["Cloak of Elvenkind", "Dagger of Doom"]);
    expect(page3.items.map((i) => i.name)).toEqual(["Everlasting Rations", "Flaming Sphere Wand"]);
    expect(page4.items).toEqual([]);
    // Every page reports the same uncapped total.
    for (const page of [page1, page2, page3, page4]) expect(page.total).toBe(SPECS.length);
  });

  it("pages through relevance-ranked text results in the same order as an unpaged query", () => {
    const engine = makeEngine();
    const full = engine.query({ text: "cursed" }).items.map((i) => i.name);
    expect(full.length).toBeGreaterThanOrEqual(2);

    const paged: string[] = [];
    for (let offset = 0; offset < full.length; offset++) {
      paged.push(...engine.query({ text: "cursed" }, { limit: 1, offset }).items.map((i) => i.name));
    }
    expect(paged).toEqual(full);
  });
});

describe("option lists (handed to Phase 5)", () => {
  it("exposes the full tag dictionary with per-tag corpus counts", () => {
    const { tags } = makeEngine().options;
    expect(tags.map((t) => t.name)).toEqual(CATEGORIES);
    const damage = tags.find((t) => t.name === "Damage");
    expect(damage?.count).toBe(3); // Amulet, Dagger, Flaming
    const healing = tags.find((t) => t.name === "Healing");
    expect(healing?.count).toBe(0); // present in dictionary, absent in corpus
  });

  it("lists distinct traits A→Z and rarities in canonical order", () => {
    const { traits, rarities } = makeEngine().options;
    expect(traits).toEqual([
      "abjuration",
      "conjuration",
      "evocation",
      "magical",
      "transmutation",
    ]);
    expect(rarities).toEqual(["common", "uncommon", "rare"]);
  });

  it("reports observed level and price ranges", () => {
    const { levelRange, priceRange } = makeEngine().options;
    expect(levelRange).toEqual({ min: 1, max: 7 });
    expect(priceRange).toEqual({ min: 60, max: 1000 });
  });
});

describe("weapon group / armor category filter", () => {
  const TYPED: ItemSpec[] = [
    { name: "Flaming Longsword", level: 8, rarity: "common", traits: ["magical"], priceGp: 200, tags: [], type: "weapon", category: "martial", group: "sword" },
    { name: "Coldstar Pistols", level: 23, rarity: "unique", traits: ["artifact"], priceGp: null, tags: [], type: "weapon", category: "martial", group: "firearm" },
    { name: "Dueling Pistol +1", level: 4, rarity: "common", traits: ["magical"], priceGp: 160, tags: [], type: "weapon", category: "martial", group: "firearm" },
    { name: "Glamered Leather", level: 5, rarity: "common", traits: ["magical"], priceGp: 140, tags: [], type: "armor", category: "light", group: "leather" },
    { name: "Fortress Plate", level: 12, rarity: "rare", traits: ["magical"], priceGp: 2000, tags: [], type: "armor", category: "heavy", group: "plate" },
    { name: "Ring of Wizardry", level: 6, rarity: "uncommon", traits: ["arcane"], priceGp: 360, tags: [], type: "equipment", category: null, group: null },
  ];
  const engine = createSearchEngine(makeIndex(TYPED));

  it("derives weapon groups (A→Z) and armor categories (light→heavy)", () => {
    expect(engine.options.weaponGroups).toEqual(["firearm", "sword"]);
    expect(engine.options.armorCategories).toEqual(["light", "heavy"]);
  });

  it("filters weapons by group (OR within)", () => {
    const names = engine.query({ weaponGroups: ["firearm"] }).items.map((i) => i.name);
    expect(names.sort()).toEqual(["Coldstar Pistols", "Dueling Pistol +1"]);
  });

  it("filters armor by category", () => {
    const names = engine.query({ armorCategories: ["heavy"] }).items.map((i) => i.name);
    expect(names).toEqual(["Fortress Plate"]);
  });

  it("OR-combines weapon groups and armor categories as one type axis", () => {
    const names = engine.query({ weaponGroups: ["sword"], armorCategories: ["light"] }).items.map((i) => i.name);
    expect(names.sort()).toEqual(["Flaming Longsword", "Glamered Leather"]);
  });

  it("keeps other categories AND-intersected with the type axis", () => {
    // firearm weapons that are also unique → only Coldstar Pistols.
    const names = engine
      .query({ weaponGroups: ["firearm"], rarities: ["unique"] })
      .items.map((i) => i.name);
    expect(names).toEqual(["Coldstar Pistols"]);
  });
});

describe("rune family filter", () => {
  const RUNES: ItemSpec[] = [
    { name: "Striking", level: 4, rarity: "common", traits: ["magical"], priceGp: 65, tags: [], runeKind: "fundamental-weapon" },
    { name: "Weapon Potency (+1)", level: 2, rarity: "common", traits: ["magical"], priceGp: 35, tags: [], runeKind: "fundamental-weapon" },
    { name: "Flaming", level: 8, rarity: "common", traits: ["fire", "magical"], priceGp: 500, tags: [], runeKind: "weapon-property" },
    { name: "Shadow", level: 5, rarity: "common", traits: ["magical"], priceGp: 55, tags: [], runeKind: "armor-property" },
    { name: "Resilient", level: 8, rarity: "common", traits: ["magical"], priceGp: 340, tags: [], runeKind: "fundamental-armor" },
    { name: "Reinforcing Rune (Minor)", level: 4, rarity: "common", traits: ["magical"], priceGp: 75, tags: [], runeKind: "shield" },
    { name: "Bolka's Blessing", level: 5, rarity: "uncommon", traits: ["divine", "magical"], priceGp: 160, tags: [], runeKind: "clan-dagger" },
    { name: "Presentable", level: 3, rarity: "common", traits: ["magical"], priceGp: 50, tags: [], runeKind: "accessory" },
    { name: "Flaming Longsword", level: 8, rarity: "common", traits: ["magical"], priceGp: 200, tags: [], type: "weapon", category: "martial", group: "sword" },
    { name: "Glamered Leather", level: 5, rarity: "common", traits: ["magical"], priceGp: 140, tags: [], type: "armor", category: "light", group: "leather" },
  ];
  const engine = createSearchEngine(makeIndex(RUNES));

  it("offers only the families present, in canonical order", () => {
    expect(engine.options.runeKinds).toEqual([
      "accessory",
      "armor-property",
      "clan-dagger",
      "fundamental-armor",
      "fundamental-weapon",
      "shield",
      "weapon-property",
    ]);
  });

  it("filters to one family", () => {
    const names = engine.query({ runeKinds: ["clan-dagger"] }).items.map((i) => i.name);
    expect(names).toEqual(["Bolka's Blessing"]);
  });

  it("ORs within a multi-family selection", () => {
    const names = engine
      .query({ runeKinds: ["shield", "fundamental-weapon"] })
      .items.map((i) => i.name);
    expect(names.sort()).toEqual([
      "Reinforcing Rune (Minor)",
      "Striking",
      "Weapon Potency (+1)",
    ]);
  });

  it("OR-combines with weapon groups and armor categories as one type axis", () => {
    const names = engine
      .query({ runeKinds: ["accessory"], weaponGroups: ["sword"], armorCategories: ["light"] })
      .items.map((i) => i.name);
    expect(names.sort()).toEqual(["Flaming Longsword", "Glamered Leather", "Presentable"]);
  });

  it("stays AND-intersected with the other categories", () => {
    // Weapon property runes that also carry the fire trait → only Flaming.
    const names = engine
      .query({ runeKinds: ["weapon-property"], traits: ["fire"] })
      .items.map((i) => i.name);
    expect(names).toEqual(["Flaming"]);
  });

  it("treats an empty selection as no rune filter", () => {
    expect(engine.query({ runeKinds: [] }).total).toBe(RUNES.length);
  });
});

describe("weapon hands filter", () => {
  const HANDED: ItemSpec[] = [
    { name: "Flaming Longsword", level: 8, rarity: "common", traits: ["magical"], priceGp: 200, tags: [], type: "weapon", category: "martial", group: "sword", hands: "1" },
    { name: "Iris of the Sky", level: 6, rarity: "unique", traits: [], priceGp: 240, tags: [], type: "weapon", category: "martial", group: "firearm", hands: "1" },
    { name: "Godsbreath Bow", level: 11, rarity: "rare", traits: [], priceGp: 1300, tags: [], type: "weapon", category: "martial", group: "bow", hands: "1+" },
    { name: "Worldringer", level: 4, rarity: "uncommon", traits: [], priceGp: 100, tags: [], type: "weapon", category: "martial", group: "hammer", hands: "2" },
    // A weapon with no usable hand count (handwraps are worn, not held).
    { name: "Handwraps of Mighty Blows", level: 2, rarity: "common", traits: ["magical"], priceGp: 35, tags: [], type: "weapon", category: "unarmed", group: "brawling", hands: null },
    { name: "Ring of Wizardry", level: 6, rarity: "uncommon", traits: ["arcane"], priceGp: 360, tags: [], type: "equipment" },
  ];
  const engine = createSearchEngine(makeIndex(HANDED));

  it("derives the hand counts present, in canonical order", () => {
    expect(engine.options.hands).toEqual(["1", "1+", "2"]);
  });

  it("filters by a single hand count", () => {
    const names = engine.query({ hands: ["2"] }).items.map((i) => i.name);
    expect(names).toEqual(["Worldringer"]);
  });

  it("ORs within the selection", () => {
    const names = engine.query({ hands: ["1", "1+"] }).items.map((i) => i.name);
    expect(names.sort()).toEqual(["Flaming Longsword", "Godsbreath Bow", "Iris of the Sky"]);
  });

  it("drops items with no hand count (non-weapons and worn weapons)", () => {
    const names = engine.query({ hands: ["1", "1+", "2"] }).items.map((i) => i.name);
    expect(names).not.toContain("Ring of Wizardry");
    expect(names).not.toContain("Handwraps of Mighty Blows");
  });

  it("ANDs with the weapon-group axis rather than ORing into it", () => {
    // One-handed AND a firearm — not "one-handed or a firearm".
    const names = engine
      .query({ hands: ["1"], weaponGroups: ["firearm"] })
      .items.map((i) => i.name);
    expect(names).toEqual(["Iris of the Sky"]);
  });

  it("matches everything when nothing is selected", () => {
    expect(engine.query({ hands: [] }).total).toBe(HANDED.length);
    expect(engine.query({}).total).toBe(HANDED.length);
  });
});

/**
 * The magic axis. The corpus spans magical *and* mundane equipment, so the
 * headline requirement is that the default view shows both — narrowing to either
 * half is opt-in.
 */
describe("magic filter", () => {
  const MIXED: ItemSpec[] = [
    { name: "Flaming Longsword", level: 8, rarity: "common", traits: ["magical"], priceGp: 200, tags: ["Damage"], type: "weapon", category: "martial", group: "sword" },
    { name: "Iris of the Sky", level: 6, rarity: "unique", traits: [], priceGp: 240, tags: [], type: "weapon", category: "martial", group: "firearm" },
    // Mundane gear — invisible to the module before this axis existed.
    { name: "Longsword", level: 0, rarity: "common", traits: [], priceGp: 1, tags: [], type: "weapon", category: "martial", group: "sword", magical: false },
    { name: "Rations", level: 0, rarity: "common", traits: [], priceGp: 0.4, tags: [], magical: false },
    { name: "Leather Armor", level: 0, rarity: "common", traits: [], priceGp: 2, tags: [], type: "armor", category: "light", group: "leather", magical: false },
  ];
  const engine = createSearchEngine(makeIndex(MIXED), { categories: CATEGORIES });
  const run = (state: FilterState): string[] =>
    engine.query(state).items.map((i) => i.name).sort();

  it("returns both kinds by default", () => {
    expect(engine.query({}).total).toBe(MIXED.length);
    expect(run({})).toContain("Rations");
    expect(run({})).toContain("Flaming Longsword");
  });

  it("filters out non-magical items", () => {
    expect(run({ magic: ["magical"] })).toEqual(["Flaming Longsword", "Iris of the Sky"]);
  });

  it("filters out magical items", () => {
    expect(run({ magic: ["mundane"] })).toEqual(["Leather Armor", "Longsword", "Rations"]);
  });

  it("treats both-selected and none-selected as the same thing", () => {
    expect(engine.query({ magic: ["magical", "mundane"] }).total).toBe(MIXED.length);
    expect(engine.query({ magic: [] }).total).toBe(MIXED.length);
  });

  it("ANDs with the other axes", () => {
    // Both swords are in the sword group; only the mundane one survives.
    expect(run({ magic: ["mundane"], weaponGroups: ["sword"] })).toEqual(["Longsword"]);
  });

  it("is subsumed by any ability-tag selection, since only magic items carry tags", () => {
    expect(run({ tags: ["Damage"] })).toEqual(["Flaming Longsword"]);
    // Asking for a tag *and* mundane items is contradictory, and yields nothing.
    expect(run({ tags: ["Damage"], magic: ["mundane"] })).toEqual([]);
  });

  it("offers both values in canonical order, magical first", () => {
    expect(engine.options.magic).toEqual(["magical", "mundane"]);
  });

  it("omits the half the corpus does not contain", () => {
    const magicOnly = createSearchEngine(makeIndex(MIXED.filter((s) => s.magical !== false)));
    expect(magicOnly.options.magic).toEqual(["magical"]);
  });
});
