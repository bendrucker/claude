import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDraft } from "./check-draft";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-draft-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const OVER = "Adds words. ".repeat(80);

test.each<{ name: string; file: string; body: string; blocked: boolean }>([
  { name: "over-limit draft", file: "pr-body-topic.md", body: OVER, blocked: true },
  {
    name: "draft under the limits",
    file: "pr-body-topic.md",
    body: "Adds a flag.",
    blocked: false,
  },
  { name: "other markdown file", file: "notes.md", body: OVER, blocked: false },
])("$name", async ({ file, body, blocked }) => {
  const path = join(dir, file);
  await Bun.write(path, body);
  const output = await checkDraft({ tool_input: { file_path: path } }, join(dir, "events"));
  expect(output?.decision === "block").toBe(blocked);
});

test("reports each exceeded limit with the cut it needs", async () => {
  const path = join(dir, "pr-body-topic.md");
  await Bun.write(path, OVER);
  const output = await checkDraft({ tool_input: { file_path: path } }, join(dir, "events"));
  expect(output?.reason?.replace(dir, "<dir>")).toMatchInlineSnapshot(
    `"The PR body draft in \`<dir>/pr-body-topic.md\` would be denied at create or edit. Cut it before anyone reviews it. The body is over its structure limits (visible words 160 > 150, cut 10; longest paragraph or bullet words 160 > 40, cut 120). Tables, fenced output, and \`<details>\` don't count. Make every cut in one rewrite."`,
  );
});

test("denies prose and list words that only exceed the limit together", async () => {
  const prose = Array.from({ length: 5 }, () => "word ".repeat(20).trim()).join("\n\n");
  const list = Array.from({ length: 8 }, () => `- ${"item ".repeat(10).trim()}`).join("\n");
  const path = join(dir, "pr-body-topic.md");
  await Bun.write(path, `${prose}\n\n${list}`);
  const output = await checkDraft({ tool_input: { file_path: path } }, join(dir, "events"));
  expect(output?.decision).toBe("block");
  expect(output?.reason).toContain("visible words 180 > 150, cut 30");
});

test("records the draft validation for the session", async () => {
  const path = join(dir, "pr-body-topic.md");
  const events = join(dir, "events");
  await Bun.write(path, OVER);
  await checkDraft({ session_id: "s-1", tool_input: { file_path: path } }, events);
  const record: unknown = JSON.parse(
    await Bun.file(join(events, "s-1", "pull-request.validate.jsonl")).text(),
  );
  expect(record).toMatchObject({
    attributes: { verb: "draft", rules: ["structure-limits"], proseWords: 160, visibleWords: 160 },
  });
});
