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
