import { describe, it, expect } from "vitest";
import { assembleIndex, descriptionToText, weaponHands } from "./item-index.js";
import { hasMagicalMarker, hasMagicalRunes, isMagicalItem } from "./coverage.js";
import type { TagMap } from "./tag-map.js";

/**
 * The HTML → plain-text flattening behind description search. The bulk loader
 * itself needs a live pack, but this — the part that decides what the text
 * index actually sees — is pure.
 */
describe("descriptionToText", () => {
  it("strips tags without fusing adjacent words", () => {
    expect(descriptionToText("<p>One</p><p>Two</p>")).toBe("One Two");
    expect(descriptionToText("<p>A <strong>bold</strong> claim.</p>")).toBe("A bold claim.");
  });

  it("keeps the visible label of Foundry inline references", () => {
    expect(
      descriptionToText("Cast @UUID[Compendium.pf2e.spells-srd.Item.abc]{Fireball} at will."),
    ).toBe("Cast Fireball at will.");
    // Label-less form: the arguments are the visible text.
    expect(descriptionToText("Deal @Damage[2d6] fire damage.")).toBe("Deal 2d6 fire damage.");
  });

  it("decodes entities and collapses whitespace", () => {
    expect(descriptionToText("<p>fire&nbsp;&amp;&nbsp;ice</p>\n\n  <p>   spread </p>")).toBe(
      "fire & ice spread",
    );
  });

  it("returns an empty string for markup with no text", () => {
    expect(descriptionToText("<hr />")).toBe("");
    expect(descriptionToText("")).toBe("");
  });
});

/**
 * The corpus predicate. The rune half exists because the remaster strips the
 * `magical` trait from **specific magic items** — they are recognizable only by
 * their etched runes.
 */
describe("isMagicalItem", () => {
  it("accepts any marker trait", () => {
    expect(hasMagicalMarker(["magical"])).toBe(true);
    expect(hasMagicalMarker(["artifact"])).toBe(true);
    expect(hasMagicalMarker(["occult", "invested"])).toBe(true);
    expect(hasMagicalMarker(["agile", "finesse"])).toBe(false);
    expect(hasMagicalMarker(undefined)).toBe(false);
  });

  it("treats any etched rune as magical", () => {
    expect(hasMagicalRunes({ potency: 1, striking: 1, property: [] })).toBe(true);
    expect(hasMagicalRunes({ potency: 0, striking: 0, property: ["ghostTouch"] })).toBe(true);
    expect(hasMagicalRunes({ resilient: 2 })).toBe(true);
    expect(hasMagicalRunes({ reinforcing: 1 })).toBe(true);
  });

  it("does not treat an unetched item as magical", () => {
    expect(hasMagicalRunes({ potency: 0, striking: 0, resilient: 0, property: [] })).toBe(false);
    expect(hasMagicalRunes({ potency: null, resilient: null, reinforcing: null })).toBe(false);
    expect(hasMagicalRunes(null)).toBe(false);
    expect(hasMagicalRunes(undefined)).toBe(false);
  });

  it("tolerates the object-shaped empty property list some pack entries carry", () => {
    expect(hasMagicalRunes({ property: { "0": "" } })).toBe(false);
    expect(hasMagicalRunes({ property: { "0": "flaming" } })).toBe(true);
  });

  it("keeps a specific magic item that carries no marker trait", () => {
    // "Iris of the Sky": a +1 striking jezail whose only traits are weapon traits.
    expect(
      isMagicalItem({
        traits: ["concussive", "fatal-aim-d12"],
        runes: { potency: 1, striking: 1, property: [] },
      }),
    ).toBe(true);
    // A plain jezail is neither.
    expect(isMagicalItem({ traits: ["concussive", "fatal-aim-d12"] })).toBe(false);
  });
});

/**
 * The pure assembly half of the index. The corpus spans magical and mundane
 * items, and only the magical half can ever join the tag map — so the stats have
 * to keep those two populations apart or the hit rate reads as a regression.
 */
describe("assembleIndex", () => {
  const TAG_MAP: TagMap = {
    schemaVersion: 1,
    pf2eSystemVersion: "8.3.0",
    generatedAt: "2026-01-01T00:00:00Z",
    itemCount: 1,
    categories: [{ name: "Damage", description: "Deals damage." }],
    tags: {
      "Compendium.pf2e.equipment-srd.Item.aaa": {
        slug: "flaming-longsword",
        name: "Flaming Longsword",
        tags: ["Damage"],
        snippets: { Damage: "deals 1d6 fire" },
        matchMethod: { Damage: "regex" },
      },
    },
  };

  /** Two magical items (one tagged, one not) and two mundane ones. */
  const RAW = [
    { uuid: "Compendium.pf2e.equipment-srd.Item.aaa", id: "aaa", name: "Flaming Longsword", level: 8, rarity: "common", traits: ["magical"], price: { gp: 200 }, source: null, slug: "flaming-longsword", img: null, type: "weapon", category: "martial", group: "sword", hands: "1" as const, magical: true },
    { uuid: "Compendium.pf2e.equipment-srd.Item.bbb", id: "bbb", name: "Iris of the Sky", level: 6, rarity: "unique", traits: [], price: null, source: null, slug: "iris-of-the-sky", img: null, type: "weapon", category: "martial", group: "firearm", hands: "1" as const, magical: true },
    { uuid: "Compendium.pf2e.equipment-srd.Item.ccc", id: "ccc", name: "Longsword", level: 0, rarity: "common", traits: [], price: { gp: 1 }, source: null, slug: "longsword", img: null, type: "weapon", category: "martial", group: "sword", hands: "1" as const, magical: false },
    { uuid: "Compendium.pf2e.equipment-srd.Item.ddd", id: "ddd", name: "Rations", level: 0, rarity: "common", traits: [], price: { sp: 4 }, source: null, slug: "rations", img: null, type: "consumable", category: null, group: null, hands: null, magical: false },
    { uuid: "Compendium.pf2e.equipment-srd.Item.eee", id: "eee", name: "Striking", level: 4, rarity: "common", traits: ["magical"], price: { gp: 65 }, source: null, slug: "striking", img: null, type: "equipment", category: null, group: null, hands: null, magical: true },
  ];

  it("indexes mundane items alongside magical ones, flagging each", () => {
    const index = assembleIndex(TAG_MAP, RAW);
    expect(index.items).toHaveLength(5);
    expect(index.byUuid.get("Compendium.pf2e.equipment-srd.Item.aaa")?.magical).toBe(true);
    expect(index.byUuid.get("Compendium.pf2e.equipment-srd.Item.ccc")?.magical).toBe(false);
  });

  it("splits the magical / mundane counts", () => {
    const { stats } = assembleIndex(TAG_MAP, RAW);
    expect(stats.total).toBe(5);
    expect(stats.magical).toBe(3);
    expect(stats.mundane).toBe(2);
  });

  it("counts unmatched against the magical half only", () => {
    const { stats } = assembleIndex(TAG_MAP, RAW);
    // One magical item joined; the other magical item did not. The two mundane
    // items have no map entry by construction and must not count as misses.
    expect(stats.matched).toBe(1);
    expect(stats.unmatched).toBe(2);
    expect(stats.withTags).toBe(1);
  });

  it("gives mundane items no tags", () => {
    const index = assembleIndex(TAG_MAP, RAW);
    const rations = index.byUuid.get("Compendium.pf2e.equipment-srd.Item.ddd");
    expect(rations?.tags).toEqual([]);
    expect(rations?.joinedBy).toBeNull();
    // ...and they stay out of the inverted tag index entirely.
    expect(index.tagToItemIds.get("Damage")).toEqual([
      "Compendium.pf2e.equipment-srd.Item.aaa",
    ]);
  });

  it("classifies runes by slug, leaving everything else unclassified", () => {
    const index = assembleIndex(TAG_MAP, RAW);
    expect(index.byUuid.get("Compendium.pf2e.equipment-srd.Item.eee")?.runeKind).toBe(
      "fundamental-weapon",
    );
    expect(index.byUuid.get("Compendium.pf2e.equipment-srd.Item.aaa")?.runeKind).toBeNull();
    expect(index.byUuid.get("Compendium.pf2e.equipment-srd.Item.ddd")?.runeKind).toBeNull();
  });
});

describe("weaponHands", () => {
  it("maps the held-in-* usages to hand counts", () => {
    expect(weaponHands("weapon", "held-in-one-hand")).toBe("1");
    expect(weaponHands("weapon", "held-in-one-plus-hands")).toBe("1+");
    expect(weaponHands("weapon", "held-in-two-hands")).toBe("2");
  });

  it("is null for worn weapons and unknown usages", () => {
    expect(weaponHands("weapon", "worngloves")).toBeNull();
    expect(weaponHands("weapon", null)).toBeNull();
    expect(weaponHands("weapon", undefined)).toBeNull();
  });

  it("is null for non-weapons even when they are held", () => {
    // Wands, scrolls, and most equipment are "held in one hand" too — folding
    // them in would make a weapon hands filter match half the corpus.
    expect(weaponHands("equipment", "held-in-one-hand")).toBeNull();
    expect(weaponHands("consumable", "held-in-two-hands")).toBeNull();
    expect(weaponHands("armor", "held-in-one-hand")).toBeNull();
  });
});
