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

This file is produced by the C# desktop app's exporter from the tagged SQLite DB —
**do not hand-edit it.** Regenerate on any PF2e data refresh (Phase 7):

```
Pf2eItemFinder.App.exe --export-ability-tags <items.db> foundry-module/data/ability-tags.json 8.3.0
```

or use the app's **"Export tags (JSON)…"** button. Then `npm run build` (or `deploy`)
to ship it in `dist/`. Bump the trailing version argument when the source system
version changes.
