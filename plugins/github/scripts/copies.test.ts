import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..");

// A cached plugin cannot import from `user/`, so the hook carries a
// byte-for-byte copy of the self-timing helper. `.ci.json` selects this
// plugin when the source changes.
test("user/scripts/hook-metrics.ts and plugins/github/scripts/hook-metrics.ts stay identical", async () => {
  const [user, plugin] = await Promise.all([
    Bun.file(join(root, "user", "scripts", "hook-metrics.ts")).text(),
    Bun.file(join(import.meta.dirname, "hook-metrics.ts")).text(),
  ]);
  expect(plugin).toBe(user);
});
