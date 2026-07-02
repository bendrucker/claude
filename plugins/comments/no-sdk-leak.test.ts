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
    const offenders: string[] = [];
    for (const dir of productDirs) {
      const glob = new Glob("**/*.{ts,js}");
      for await (const path of glob.scan(join(root, dir))) {
        if (path.includes("node_modules")) continue;
        const text = await Bun.file(join(root, dir, path)).text();
        if (text.includes("@anthropic-ai/sdk")) offenders.push(join(dir, path));
      }
    }
    expect(offenders).toEqual([]);
  });
});
