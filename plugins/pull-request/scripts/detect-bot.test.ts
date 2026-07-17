import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect } from "./detect-bot";

async function repo(files: string[]): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "detect-bot-"));
  for (const file of files) {
    await Bun.write(join(root, file), "{}");
  }
  return root;
}

test.each([
  [
    [".greptile/config.json"],
    ["greptile"],
    "greptile: repo config (.greptile/config.json), CLI installed",
  ],
  [
    [".greptile/config.json"],
    [],
    "greptile: repo config (.greptile/config.json), CLI not installed",
  ],
  [[], ["greptile"], "greptile: CLI installed, no repo config"],
  [[".coderabbit.yml"], [], "coderabbit: repo config (.coderabbit.yml), CLI not installed"],
  [[], [], "none: no bot config or CLI found locally"],
  [
    [".greptile/config.json", ".coderabbit.yaml"],
    ["greptile"],
    "greptile: repo config (.greptile/config.json), CLI installed\ncoderabbit: repo config (.coderabbit.yaml), CLI not installed",
  ],
] as [string[], string[], string][])("files %p, CLIs %p", async (files, clis, expected) => {
  const which = (cli: string) => (clis.includes(cli) ? `/bin/${cli}` : null);
  expect(await detect(await repo(files), which)).toBe(expected);
});
