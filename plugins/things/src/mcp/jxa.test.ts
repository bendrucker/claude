import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findJxaRunner } from "./jxa";

// The layout matrix this delegates to lives in src/marketplace.test.ts. These
// two cases pin the sibling plugin and script name it asks for.
describe("findJxaRunner", () => {
  test("names the mac plugin's jxa.ts", async () => {
    const root = mkdtempSync(join(tmpdir(), "things-marketplace-"));
    await Bun.write(join(root, "mac/scripts/jxa.ts"), "");
    expect(await findJxaRunner(join(root, "things"))).toBe(join(root, "mac", "scripts", "jxa.ts"));
  });

  test("finds nothing when the plugin is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "things-marketplace-"));
    expect(await findJxaRunner(join(root, "things"))).toBeNull();
  });
});
