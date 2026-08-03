# Bundled data

`ability-tags.json` is the ability-tag map the module loads at runtime. Vite copies
this folder to `dist/data/`, so the module fetches it from:

`modules/pf2e-magic-item-finder/data/ability-tags.json`

## Shape

```jsonc
{
  "schemaVersion": 1,
  "pf2eSystemVersion": "8.4.0",   // version the map was built against
  "generatedAt": "…Z",
  "itemCount": 3488,               // == number of entries in "tags"
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

This file is a pre-computed export generated offline by the desktop app's tagging
pipeline (ingest → tag → export) — **do not hand-edit it.** On a PF2e data refresh:

1. Update the data clone (`foundry-data/pf2e`) and run the desktop app's **Resync**,
   which re-ingests and re-tags `%LOCALAPPDATA%\Pf2eItemFinder\items.db`.
2. Export over this file, stamping the PF2e version the clone is at
   (`git describe --tags` in the clone):

   ```bash
   dotnet run --project src/Pf2eItemFinder.App -- --export-ability-tags "%LOCALAPPDATA%\Pf2eItemFinder\items.db" foundry-module/data/ability-tags.json 8.4.0
   ```

3. `npm run build` (or `deploy`) to ship it in `dist/`.

The stamped version is what the module compares against the installed system, so it
must be the version the map was *built from*, not the one you happen to be running.
A mismatch is a deliberate soft warning: it explains coverage gaps rather than
hiding them.
