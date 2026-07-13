import type { MODULE_ID } from "../constants.js";

// fvtt-types augmentations for this module.
declare global {
  // Register this module's client-scoped settings so game.settings.register /
  // .get are typed for the `pf2e-magic-item-finder` namespace.
  interface SettingConfig {
    "pf2e-magic-item-finder.debugLogging": boolean;
    // Phase 6: per-user named filter presets (array of StoredPreset).
    "pf2e-magic-item-finder.filterPresets": import("../data/presets.js").StoredPreset[];
  }
}

// Keep this a module (required for global augmentation under isolatedModules).
export type _ModuleId = typeof MODULE_ID;
