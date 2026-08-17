import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findJxaRunner } from "./jxa";

// The installed layout previously gated its scan on Bun.file(<dir>).exists(),
// which is false for a directory, so no installed plugin ever resolved a
// runner and every read tool failed.
describe("findJxaRunner", () => {
  const version = "69eed9ed34f1";
  const other = "282d5556b96b";

  async function tree(...paths: string[]): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), "things-marketplace-"));
    for (const path of paths) await Bun.write(join(root, path), "");
    return root;
  }

  test.each<{
    name: string;
    layout: string[];
    pluginRoot: string[];
    runner: string[] | null;
  }>([
    {
      name: "resolves the sibling installed from the same marketplace commit",
      layout: [
        `things/${version}/src/mcp/jxa.ts`,
        `mac/${other}/scripts/jxa.ts`,
        `mac/${version}/scripts/jxa.ts`,
      ],
      pluginRoot: ["things", version],
      runner: ["mac", version, "scripts", "jxa.ts"],
    },
    {
      name: "prefers a dev checkout's sibling directory over the installed layout",
      layout: ["things/src/mcp/jxa.ts", "mac/scripts/jxa.ts", `mac/${version}/scripts/jxa.ts`],
      pluginRoot: ["things"],
      runner: ["mac", "scripts", "jxa.ts"],
    },
    {
      name: "declines a runner from a version this plugin was not installed with",
      layout: [`things/${version}/src/mcp/jxa.ts`, `mac/${other}/scripts/jxa.ts`],
      pluginRoot: ["things", version],
      runner: null,
    },
    {
      name: "finds nothing when the mac plugin is not installed",
      layout: [`things/${version}/src/mcp/jxa.ts`],
      pluginRoot: ["things", version],
      runner: null,
    },
    {
      name: "finds nothing when the matching version carries no runner",
      layout: [`things/${version}/src/mcp/jxa.ts`, `mac/${version}/scripts/sandbox.ts`],
      pluginRoot: ["things", version],
      runner: null,
    },
  ])("$name", async ({ layout, pluginRoot, runner }) => {
    const root = await tree(...layout);
    const resolved = await findJxaRunner(join(root, ...pluginRoot));
    expect(resolved).toBe(runner ? join(root, ...runner) : null);
  });
});
