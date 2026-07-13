# Bundled data

`ability-tags.json` is the ability-tag map the module loads at runtime. Vite copies
this folder to `dist/data/`, so the module fetches it from:

`modules/pf2e-magic-item-finder/data/ability-tags.json`

## Shape

```jsonc
{
  "schemaVersion": 1,
  "pf2eSystemVersion": "8.3.0",   // version the map was built against
  "generatedAt": "…Z",
  "itemCount": 3328,               // == number of entries in "tags"
  "tags": {
    "Compendium.pf2e.equipment-srd.Item.<_id>": {
      "slug": "…",                 // fallback join key (PF2e sluggify of name)
      "name": "…",
      "tags": ["Flight", "Resistance"],
      "snippets":    { "Flight": "…evidence…" },
      "matchMethod": { "Flight": "regex", "Resistance": "structured" }
    }
    // …one entry per evaluated magical item; tag-less items have empty tags/snippets/matchMethod
  },
  "categories": [ { "name": "Flight", "description": "Grants a fly Speed…" }, … ]
}
```

The module keys on the UUID and falls back to `slug` when a UUID misses (Phase 0 §3).
`schemaVersion` is hard-checked by the loader; a `pf2eSystemVersion` that differs from
the installed system triggers a drift warning.

## Regenerating

This file is a pre-computed export generated offline by a separate tagging
pipeline — **do not hand-edit it.** On a PF2e data refresh, regenerate the export,
replace `ability-tags.json` here, and bump the `pf2eSystemVersion` header to the
system version it was built against. Then `npm run build` (or `deploy`) to ship it
in `dist/`.
