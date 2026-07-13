import { describe, it, expect } from "vitest";
import { coerceAppliedState } from "./presets.js";
import type { FilterOptionLists, FilterState } from "../search/query-engine.js";

/**
 * Phase 6 verification — the graceful-degradation half of the preset service
 * ({@link coerceAppliedState}), the only Foundry-free part. The CRUD helpers wrap
 * `game.settings` and are exercised live in a world.
 */

const options: FilterOptionLists = {
  tags: [
    { name: "Flight", count: 12 },
    { name: "Healing", count: 30 },
  ],
  traits: ["fire", "invested", "magical"],
  rarities: ["common", "uncommon", "rare"],
  levelRange: { min: 0, max: 20 },
  priceRange: { min: 1, max: 100000 },
};

describe("coerceAppliedState", () => {
  it("keeps names that still exist in the option lists", () => {
    const state: FilterState = {
      tags: ["Flight", "Healing"],
      traits: ["fire", "magical"],
      rarities: ["rare"],
      minLevel: 5,
      maxPriceGp: 1000,
      includePriceless: true,
      sort: "level",
      sortDir: "desc",
      text: "  sword ",
    };
    expect(coerceAppliedState(state, options)).toEqual({
      tags: ["Flight", "Healing"],
      traits: ["fire", "magical"],
      rarities: ["rare"],
      minLevel: 5,
      maxLevel: undefined,
      minPriceGp: undefined,
      maxPriceGp: 1000,
      includePriceless: true,
      sort: "level",
      sortDir: "desc",
      text: "sword",
    });
  });

  it("drops tags/traits/rarities that no longer exist (degrade gracefully)", () => {
    const state: FilterState = {
      tags: ["Flight", "Necromancy"],
      traits: ["fire", "gone"],
      rarities: ["rare", "mythic"],
    };
    const out = coerceAppliedState(state, options);
    expect(out.tags).toEqual(["Flight"]);
    expect(out.traits).toEqual(["fire"]);
    expect(out.rarities).toEqual(["rare"]);
  });

  it("collapses an entirely-unknown selection to undefined (not an empty array)", () => {
    const out = coerceAppliedState({ tags: ["Gone"], traits: ["Gone"] }, options);
    expect(out.tags).toBeUndefined();
    expect(out.traits).toBeUndefined();
  });

  it("rejects an invalid sort/sortDir that doesn't survive a schema change", () => {
    const out = coerceAppliedState(
      { sort: "bogus" as FilterState["sort"], sortDir: "sideways" as FilterState["sortDir"] },
      options,
    );
    expect(out.sort).toBeUndefined();
    expect(out.sortDir).toBeUndefined();
  });
});
