import { afterEach, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { findViolations } from "./check-md-code";

const fixture = join(import.meta.dir, "..", "tmp", "check-md-code-fixture.md");

afterEach(async () => {
  await rm(fixture, { force: true });
});

it("ignores untracked markdown", async () => {
  await Bun.write(fixture, ["```json", "{ not json }", "```", ""].join("\n"));
  const violations = await findViolations();
  expect(violations.filter((violation) => violation.includes("check-md-code-fixture"))).toEqual([]);
});

it("finds no violations in tracked markdown", async () => {
  expect(await findViolations()).toEqual([]);
});
