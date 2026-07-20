import { describe, it, expect } from "vitest";
import type { IndexedItem } from "./item-index.js";
import { buildExportRows, exportTimestamp, toCsv, toJson } from "./export.js";

/**
 * Phase 6 verification — the pure export builders. Confirms the CSV mirrors the
 * results columns + matched Tags, RFC 4180 quoting/escaping, CRLF terminators,
 * numeric prices (blank for priceless), and the JSON structure.
 */

function makeItem(partial: Partial<IndexedItem> & { name: string }): IndexedItem {
  const slug = partial.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    uuid: `Compendium.pf2e.equipment-srd.Item.${slug}`,
    id: slug,
    name: partial.name,
    level: partial.level ?? 1,
    rarity: partial.rarity ?? "common",
    traits: partial.traits ?? [],
    priceGp: partial.priceGp ?? null,
    source: partial.source ?? null,
    slug,
    img: null,
    type: "equipment",
    category: null,
    group: null,
    tags: partial.tags ?? [],
    snippets: {},
    matchMethod: {},
    joinedBy: null,
  };
}

describe("buildExportRows", () => {
  it("projects the export columns from an indexed item", () => {
    const rows = buildExportRows([
      makeItem({ name: "Flaming Sword", level: 8, rarity: "uncommon", traits: ["fire", "magical"], priceGp: 500, tags: ["Damage", "Fire"], source: "CRB" }),
    ]);
    expect(rows[0]).toEqual({
      name: "Flaming Sword",
      level: 8,
      rarity: "uncommon",
      priceGp: 500,
      traits: ["fire", "magical"],
      tags: ["Damage", "Fire"],
      source: "CRB",
    });
  });
});

describe("toCsv", () => {
  it("emits the header + one CRLF-terminated line per row", () => {
    const csv = toCsv(buildExportRows([makeItem({ name: "Torch", level: 0, rarity: "common", priceGp: 0.1, source: "CRB" })]));
    expect(csv).toBe(
      "Name,Level,Rarity,Price (gp),Traits,Tags,Source\r\n" +
        "Torch,0,common,0.1,,,CRB\r\n",
    );
  });

  it("quotes fields with commas (traits/tags) and doubles embedded quotes", () => {
    const csv = toCsv(
      buildExportRows([
        makeItem({ name: 'Ring of "Wishes"', traits: ["magical", "invested"], tags: ["Wish", "Teleport"], source: "GMG" }),
      ]),
    );
    const line = csv.split("\r\n")[1];
    expect(line).toBe('"Ring of ""Wishes""",1,common,,"magical, invested","Wish, Teleport",GMG');
  });

  it("leaves the price blank for priceless items", () => {
    const csv = toCsv(buildExportRows([makeItem({ name: "Artifact", priceGp: null })]));
    expect(csv.split("\r\n")[1]).toBe("Artifact,1,common,,,,");
  });

  it("keeps prices numeric (no thousands separators) so spreadsheets parse them", () => {
    const csv = toCsv(buildExportRows([makeItem({ name: "Pricey", priceGp: 12000 })]));
    expect(csv.split("\r\n")[1]).toContain(",12000,");
  });
});

describe("toJson", () => {
  it("serializes the same fields as a structured array", () => {
    const rows = buildExportRows([makeItem({ name: "Wand", level: 3, priceGp: 60, tags: ["Fire"] })]);
    const parsed = JSON.parse(toJson(rows));
    expect(parsed).toEqual([
      { name: "Wand", level: 3, rarity: "common", priceGp: 60, traits: [], tags: ["Fire"], source: null },
    ]);
  });
});

describe("exportTimestamp", () => {
  it("formats a filesystem-safe local timestamp", () => {
    const ts = exportTimestamp(new Date(2026, 6, 12, 9, 5, 3));
    expect(ts).toBe("2026-07-12_090503");
  });
});
