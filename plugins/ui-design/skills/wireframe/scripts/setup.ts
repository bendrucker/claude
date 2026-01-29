import { execSync } from "node:child_process";
import { join } from "node:path";

const skillRoot = join(import.meta.dirname, "..");

// bun install is a fast no-op when deps are already installed
try {
  execSync("bun install", {
    cwd: skillRoot,
    env: {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: join(skillRoot, ".bun-cache"),
    },
    stdio: "inherit",
  });
} catch {
  console.error("Failed to install dependencies. Is bun installed? https://bun.sh");
  process.exit(1);
}

// Playwright checks if browser exists, fast no-op if already installed
try {
  execSync("bunx playwright install chromium", {
    cwd: skillRoot,
    stdio: "inherit",
  });
} catch {
  console.error(
    "Failed to install Chromium. Try running manually: bunx playwright install chromium",
  );
  process.exit(1);
}
