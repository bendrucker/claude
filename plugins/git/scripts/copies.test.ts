import { expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";

const root = join(import.meta.dirname, "..", "..", "..");

// Byte-for-byte copies of the user config's helpers. A cached plugin cannot
// import from `user/`, and runtime code can only import published npm packages.
// Read as text rather than imported, so the plugin-boundary checker still passes.
const copies = ["hook-metrics.ts", "transcript.ts"];

test.each(copies)("user/scripts/%s and plugins/git/scripts/%s stay identical", async (file) => {
  const [user, plugin] = await Promise.all([
    Bun.file(join(root, "user", "scripts", file)).text(),
    Bun.file(join(import.meta.dirname, file)).text(),
  ]);
  expect(plugin).toBe(user);
});

// The check above only runs when CI selects this plugin, and a user-side edit
// selects it through the paths declared in `.ci.json`.
test("every copy source is under a declared CI path", async () => {
  const ci = z
    .object({ paths: z.array(z.string()) })
    .parse(await Bun.file(join(import.meta.dirname, "..", ".ci.json")).json());
  const uncovered = copies
    .map((file) => `user/scripts/${file}`)
    .filter((file) => !ci.paths.some((path) => file.startsWith(path)));
  expect(uncovered).toBeEmpty();
});
