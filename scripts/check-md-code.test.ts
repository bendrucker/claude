import { afterEach, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { checkFile, findViolations } from "./check-md-code";

const root = join(import.meta.dir, "..");
const name = "check-md-code-fixture.md";
const fixture = join(root, name);

const block = (lang: string) => [`\`\`\`${lang}`, "{ not json }", "```", ""].join("\n");

afterEach(async () => {
  await rm(fixture, { force: true });
});

it("skips markdown that git does not track", async () => {
  await Bun.write(fixture, block("json"));

  const violations = await findViolations();

  expect(violations.filter((violation) => violation.startsWith(name))).toEqual([]);
});

it("reports a code block that fails to parse", async () => {
  await Bun.write(fixture, block("json"));

  expect(await checkFile(name)).toHaveLength(1);
});

it("skips a block tagged fragment", async () => {
  await Bun.write(fixture, block("json fragment"));

  expect(await checkFile(name)).toEqual([]);
});

it("reads a tracked file that has been deleted from the working tree as empty", async () => {
  expect(await checkFile("does-not-exist.md")).toEqual([]);
});
