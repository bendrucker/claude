import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSiblingScript } from "./marketplace";

// Both callers of this resolver previously scanned the installed layout by
// checking Bun.file(<dir>).exists(), which is false for a directory. The scan
// never ran, so no installed plugin ever resolved a sibling script.
describe("findSiblingScript", () => {
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
    found: string[] | null;
  }>([
    {
      name: "resolves the sibling installed from the same marketplace commit",
      layout: [
        `things/${version}/scripts/url.ts`,
        `mac/${other}/scripts/jxa.ts`,
        `mac/${version}/scripts/jxa.ts`,
      ],
      pluginRoot: ["things", version],
      found: ["mac", version, "scripts", "jxa.ts"],
    },
    {
      name: "prefers a dev checkout's sibling directory over the installed layout",
      layout: ["things/scripts/url.ts", "mac/scripts/jxa.ts", `mac/${version}/scripts/jxa.ts`],
      pluginRoot: ["things"],
      found: ["mac", "scripts", "jxa.ts"],
    },
    {
      name: "declines a sibling from a version this plugin was not installed with",
      layout: [`things/${version}/scripts/url.ts`, `mac/${other}/scripts/jxa.ts`],
      pluginRoot: ["things", version],
      found: null,
    },
    {
      name: "finds nothing when the sibling plugin is not installed",
      layout: [`things/${version}/scripts/url.ts`],
      pluginRoot: ["things", version],
      found: null,
    },
    {
      name: "finds nothing when the matching version carries no such script",
      layout: [`things/${version}/scripts/url.ts`, `mac/${version}/scripts/sandbox.ts`],
      pluginRoot: ["things", version],
      found: null,
    },
    {
      name: "finds nothing when a file sits where the sibling plugin should be",
      layout: [`things/${version}/scripts/url.ts`, "mac"],
      pluginRoot: ["things", version],
      found: null,
    },
  ])("$name", async ({ layout, pluginRoot, found }) => {
    const root = await tree(...layout);
    const resolved = await findSiblingScript(join(root, ...pluginRoot), "mac", "scripts", "jxa.ts");
    expect(resolved).toBe(found ? join(root, ...found) : null);
  });
});
