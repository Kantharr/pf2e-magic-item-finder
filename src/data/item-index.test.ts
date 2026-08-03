import { describe, it, expect } from "vitest";
import { descriptionToText } from "./item-index.js";

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
