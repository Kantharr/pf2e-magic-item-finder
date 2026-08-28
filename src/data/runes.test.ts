import { describe, it, expect } from "vitest";
import { RUNE_KIND_ORDER, runeKind, runeSlugs, type RuneKind } from "./runes.js";

/**
 * The rune classification. Every assertion here is a claim about the bundled
 * slug list — the cases that motivated it (families PF2e's own icons and usage
 * strings get wrong) get named checks, so a careless refresh of the list breaks
 * the test rather than the filter.
 */

describe("runeKind", () => {
  it("classifies the fundamental runes by family", () => {
    expect(runeKind("striking")).toBe("fundamental-weapon");
    expect(runeKind("weapon-potency-1")).toBe("fundamental-weapon");
    expect(runeKind("mythic-striking")).toBe("fundamental-weapon");
    expect(runeKind("resilient-major")).toBe("fundamental-armor");
    expect(runeKind("armor-potency-3")).toBe("fundamental-armor");
  });

  it("classifies the property runes", () => {
    expect(runeKind("flaming")).toBe("weapon-property");
    expect(runeKind("ghost-touch")).toBe("weapon-property");
    expect(runeKind("shadow-greater")).toBe("armor-property");
    expect(runeKind("slick")).toBe("armor-property");
  });

  it("covers exactly the six clan dagger filigrees", () => {
    expect([...runeSlugs("clan-dagger")].sort()).toEqual([
      "bolkas-blessing",
      "bolkas-blessing-greater",
      "kolss-oath",
      "kolss-oath-greater",
      "trudds-strength",
      "trudds-strength-greater",
    ]);
  });

  it("puts every reinforcing rune — and only those — in the shield family", () => {
    for (const slug of runeSlugs("shield")) expect(slug).toMatch(/^reinforcing-rune-/);
    expect(runeKind("reinforcing-rune-supreme")).toBe("shield");
  });

  /**
   * The five accessory runes PF2e files under a *property*-rune icon folder. An
   * icon-derived classification puts each of them in the wrong family, which is
   * why the list is transcribed rather than computed.
   */
  it("classifies accessory runes that PF2e ships with property-rune icons", () => {
    expect(runeKind("catching")).toBe("accessory");
    expect(runeKind("menacing")).toBe("accessory");
    expect(runeKind("preserving")).toBe("accessory");
    expect(runeKind("trackless")).toBe("accessory");
    expect(runeKind("unexceptional")).toBe("accessory");
  });

  /** Likewise across the weapon/armor line, in both directions. */
  it("classifies the property runes whose icons sit on the wrong side", () => {
    expect(runeKind("rock-braced")).toBe("armor-property");
    expect(runeKind("sinister-knight")).toBe("armor-property");
    expect(runeKind("kin-warding")).toBe("weapon-property");
    expect(runeKind("serrating")).toBe("weapon-property");
    expect(runeKind("bloodbane")).toBe("weapon-property");
  });

  /** Two different runes, one name: only the slug tells them apart. */
  it("separates the accessory and weapon 'Called' runes", () => {
    expect(runeKind("called")).toBe("accessory");
    expect(runeKind("called-lastwall")).toBe("weapon-property");
  });

  it("returns null for non-runes, including rune-adjacent gear", () => {
    // A relic seed PF2e gives a fundamental-armor-rune icon.
    expect(runeKind("adamantine-echo")).toBeNull();
    // Adjustments whose usage reads "applied to armor"/"applied to shield".
    expect(runeKind("armor-latches")).toBeNull();
    expect(runeKind("throwing-shield")).toBeNull();
    expect(runeKind("runestone")).toBeNull();
    expect(runeKind("longsword")).toBeNull();
  });

  it("handles a missing slug", () => {
    expect(runeKind(null)).toBeNull();
    expect(runeKind(undefined)).toBeNull();
    expect(runeKind("")).toBeNull();
  });
});

describe("the rune slug list itself", () => {
  it("assigns every slug to exactly one family", () => {
    const seen = new Map<string, RuneKind>();
    for (const kind of RUNE_KIND_ORDER) {
      for (const slug of runeSlugs(kind)) {
        expect(seen.get(slug), `${slug} is in two families`).toBeUndefined();
        seen.set(slug, kind);
      }
    }
    // The pack carried 213 classified runes at PF2e 8.4.0; a refresh that
    // changes the total should be a deliberate edit here too.
    expect(seen.size).toBe(213);
  });

  it("holds well-formed slugs only", () => {
    for (const kind of RUNE_KIND_ORDER) {
      for (const slug of runeSlugs(kind)) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
