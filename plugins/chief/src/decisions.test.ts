import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { append, wasDecided } from "./decisions";

const PATH = join(import.meta.dirname, "__fixtures__", "decisions.test.jsonl");

afterEach(async () => {
  await rm(PATH, { force: true });
});

test("wasDecided is false for a missing file", async () => {
  expect(await wasDecided("claude-hook:s1:idle_prompt", PATH)).toBe(false);
});

test("wasDecided is true once a decision is appended", async () => {
  append({ ts: "2026-01-01T00:00:00.000Z", id: "claude-hook:s1:idle_prompt", note: "fine", by: "ben" }, PATH);
  expect(await wasDecided("claude-hook:s1:idle_prompt", PATH)).toBe(true);
  expect(await wasDecided("claude-hook:other", PATH)).toBe(false);
});

test("wasDecided tolerates a truncated last line", async () => {
  append({ ts: "2026-01-01T00:00:00.000Z", id: "claude-hook:s1:idle_prompt", note: "fine", by: "ben" }, PATH);
  await Bun.write(PATH, `${await Bun.file(PATH).text()}{"id":"broken"`);
  expect(await wasDecided("claude-hook:s1:idle_prompt", PATH)).toBe(true);
});
