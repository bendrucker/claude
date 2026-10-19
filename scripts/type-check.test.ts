import { afterAll, beforeAll, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { typeCheckArgs } from "./type-check";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "type-check-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

it("type-checks mods only where the generated engine types exist", async () => {
  await Bun.write(join(root, "plugins/typed/mod/register.ts"), "");
  await Bun.write(join(root, "plugins/typed/.claude-plugin/types/claude-code/index.d.ts"), "");
  await Bun.write(join(root, "plugins/untyped/mod/register.ts"), "");
  expect(await typeCheckArgs([], root)).toEqual([
    "--quiet",
    "--no-error-on-unmatched-pattern",
    "--ignore-pattern",
    "plugins/untyped/mod/**",
  ]);
});

it("checks only the files given, after the flags", async () => {
  expect((await typeCheckArgs(["scripts/a.ts"], root)).at(-1)).toBe("scripts/a.ts");
});
