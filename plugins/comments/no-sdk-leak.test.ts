import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";

/**
 * The Anthropic SDK is the calibration oracle only. The product path (extraction,
 * judging job, agent fan-out, apply, the skill CLI) must never import it, or the
 * skill would carry an API-key dependency it no longer needs.
 */
describe("no SDK leak into the product path", () => {
  const root = import.meta.dirname;
  const productDirs = ["detection", "judge", "apply", "skills", "workflow"];

  test("no @anthropic-ai/sdk import outside evals/", async () => {
    const perDir = await Promise.all(
      productDirs.map(async (dir) => {
        const glob = new Glob("**/*.{ts,js}");
        const found: string[] = [];
        for await (const path of glob.scan(join(root, dir))) {
          if (path.includes("node_modules")) continue;
          const text = await Bun.file(join(root, dir, path)).text();
          if (text.includes("@anthropic-ai/sdk")) found.push(join(dir, path));
        }
        return found;
      }),
    );
    expect(perDir.flat()).toEqual([]);
  });
});
