import { execSync } from "node:child_process";
import { dirname, join } from "node:path";

const skillRoot = dirname(dirname(import.meta.dirname));

// bun install is a fast no-op when deps are already installed
execSync("bun install", {
  cwd: skillRoot,
  env: {
    ...process.env,
    BUN_INSTALL_CACHE_DIR: join(skillRoot, ".bun-cache"),
  },
  stdio: "inherit",
});

// Playwright checks if browser exists, fast no-op if already installed
execSync("bunx playwright install chromium", {
  cwd: skillRoot,
  stdio: "inherit",
});
