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

const OVER = "Adds words. ".repeat(65);

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
    `"The PR body draft in \`<dir>/pr-body-topic.md\` would be denied at create or edit. Cut it before anyone reviews it. The body is over its structure limits (prose words 130 > 120, cut 10; longest paragraph or bullet words 130 > 40, cut 90). List words count apart from prose words. Tables, fenced output, and \`<details>\` don't count. Make every cut in one rewrite."`,
  );
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
    attributes: { verb: "draft", rules: ["structure-limits"], proseWords: 130 },
  });
});
