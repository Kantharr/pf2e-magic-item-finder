# Phase 7 — Packaging, Release & Docs

**Goal:** Ship it. Finalize the manifest URLs and versioning, cut a GitHub release
with the module zip, optionally submit to the Foundry package registry, and write
the README + the tag-refresh workflow so a maintainer can re-export tags when PF2e
updates.

**Depends on:** Phases 1–6 (feature-complete module).

> **Version note (post-retarget):** this file was written pre-retarget. The live
> targets are Foundry **verified `12`** / PF2e **verified `6.9.0`** (Phase 1), *not*
> the `14` / `8.3.0` in the original bullets below. The bundled tag map's
> `pf2eSystemVersion` stays `8.3.0` on purpose — it records the data's origin, and
> the `_id`s resolve 99.5% against 6.9.0 (Phase 2). Released as **v1.0.0**.

## Manifest & versioning

- [x] Finalize `module.json` URLs: `manifest` → the **latest**-pointing `module.json`, `download` → a **versioned** release zip (`.../releases/download/v1.0.0/module.zip`).
- [x] Semantic versioning (**v1.0.0** in `module.json` + `package.json`); `compatibility.verified` = Foundry `12`, `relationships.systems` pf2e `verified` = `6.9.0` (the tested system).
- [x] Confirmed the bundled `ability-tags.json` header: `schemaVersion 1`, `pf2eSystemVersion 8.3.0` (the authoring source — intentionally decoupled from `verified 6.9.0`; documented in README "Compatibility & data provenance").

## Release

- [x] Ready-to-attach artifacts staged (fallback to CI): `release/module.zip` (built `dist/`, forward-slash entries, `module.json` at root) + standalone `release/module.json`.
- [x] CI (GitHub Actions) [`.github/workflows/release.yml`](../.github/workflows/release.yml): on `v*` tag push — `npm ci && npm run build`, patch `dist/module.json` version + `download` URL to the tag, zip `dist/`, publish release with both artifacts.
- [ ] **(User)** Create the GitHub repo, push, tag `v1.0.0` → CI cuts the release (or attach `release/` artifacts by hand). See the release recipe.
- [ ] **(User)** Submit to the Foundry package registry, **or** share the manifest URL for manual install.

## Docs

- [x] README rewritten for release: what it does, install (manifest URL / registry), usage (open the window, filter by tag, open/drag, presets, export), build/dev loop, releasing.
- [x] Documented the **tag-refresh workflow** (re-run the C# exporter, replace `ability-tags.json`, bump `pf2eSystemVersion` + version + `verified`, re-release).
- [x] Noted the relationship to the desktop app (C# = tag-authoring pipeline; module = Foundry-native consumer).

## Verification — **(User, post-publish)**

- [ ] Install the module **from its manifest URL in a clean Foundry v12 + PF2e v6.9.0 world** — enables with no errors.
- [ ] Tags load; coverage report is sane; ability-tag search returns expected items.
- [ ] Open + drag a result works; a preset + CSV export work. *(Also closes the Phase 6 live round-trip check.)*
- [ ] The `download` zip and `manifest` URL resolve and match the release version.

## Exit Criteria

- The module installs from its manifest URL in a clean Foundry, tags load, search works.
