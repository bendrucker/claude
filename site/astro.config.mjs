import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";

// Build output bundles every module into a flat `dist/.prerender/chunks/`
// directory, so an `import.meta.dirname`-relative walk up to the repo root
// (as `site/src/data/catalog.ts` does) resolves to the wrong depth once
// bundled. This config runs from its own unbundled file, so it is the one
// place the walk is still reliable. The resulting path is injected as a
// build-time constant for the rest of the app to pass into `loadCatalog()`.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  site: "https://bendrucker.github.io",
  base: "/claude",
  output: "static",
  integrations: [vue()],
  vite: {
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.REPO_ROOT": JSON.stringify(REPO_ROOT),
    },
  },
});
