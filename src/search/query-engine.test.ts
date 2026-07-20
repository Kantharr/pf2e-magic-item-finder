import { describe, it, expect } from "vitest";
import type { IndexedItem, ItemIndex } from "../data/item-index.js";
import { createSearchEngine, type FilterState } from "./query-engine.js";

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
