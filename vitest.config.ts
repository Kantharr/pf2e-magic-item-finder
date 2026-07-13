import { defineConfig } from "vitest/config";

// Dedicated test config so the unit runner does NOT inherit the lib-build
// vite.config.ts (its Foundry deploy hook + static-copy plugins are irrelevant
// to headless tests). The Phase 4 engine has no Foundry/DOM deps, so a plain
// node environment is all it needs.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
