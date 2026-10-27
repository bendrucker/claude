import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "./generate";

test.each<{ name: string; manifest: object | undefined; written: string[] }>([
  {
    name: "a generate script",
    manifest: { scripts: { generate: "mkdir -p one && touch one/case.yaml" } },
    written: ["one", "package.json"],
  },
  { name: "no generate script", manifest: { name: "x" }, written: ["package.json"] },
  { name: "no package.json", manifest: undefined, written: [] },
])("a suite with $name", async ({ manifest, written }) => {
  const suite = mkdtempSync(join(tmpdir(), "generate-"));
  if (manifest !== undefined)
    await Bun.write(join(suite, "package.json"), JSON.stringify(manifest));
  await generate(suite);
  expect(readdirSync(suite).toSorted()).toEqual(written);
});
