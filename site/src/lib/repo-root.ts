/**
 * Injected by `astro.config.mjs` as a build-time constant. An
 * `import.meta.dirname`-relative walk computed here would resolve to the
 * wrong depth once this module is bundled into `dist/.prerender/chunks/`.
 */
export const REPO_ROOT = import.meta.env.REPO_ROOT;
