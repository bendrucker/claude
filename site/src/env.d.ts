/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Repo root, injected by `astro.config.mjs`. See `src/lib/repo-root.ts`. */
  readonly REPO_ROOT: string;
}
