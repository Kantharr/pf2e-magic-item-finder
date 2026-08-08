import { describe, it, expect } from "vitest";
import { descriptionToText, weaponHands } from "./item-index.js";
import { hasMagicalMarker, hasMagicalRunes, isMagicalItem } from "./coverage.js";

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
