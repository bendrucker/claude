import { describe, expect, test } from "bun:test";
import type { Finding } from "../../../detection/findings";
import { type Draft, firstDrafts, MIN_WORDS, type Payload, payloadsOf, sample } from "./mine";

const prose = (word: string) => Array.from({ length: MIN_WORDS }, () => word).join(" ");

const use = (name: string, input: unknown, timestamp = "2026-10-01 00:00:00") => ({
  host: "local",
  session_id: "s1",
  timestamp,
  name,
  input: JSON.stringify(input),
});

describe("payloadsOf", () => {
  test("reads a markdown Write as a file draft", () => {
    expect(payloadsOf(use("Write", { file_path: "/r/docs/a.md", content: "x" }))).toMatchObject([
      { target: "/r/docs/a.md", message: false, text: "x" },
    ]);
  });

  test("treats a markdown file under tmp/ as a message", () => {
    const [payload] = payloadsOf(use("Write", { file_path: "/r/tmp/pr-body.md", content: "x" }));
    expect(payload?.message).toBe(true);
  });

  test("reads an Edit's replacement text and skips code files", () => {
    expect(
      payloadsOf(use("Edit", { file_path: "/r/a.md", old_string: "a", new_string: "b" })),
    ).toMatchObject([{ text: "b" }]);
    expect(payloadsOf(use("Write", { file_path: "/r/a.ts", content: "x" }))).toEqual([]);
  });

  test("reads each Notion page and a Linear description as messages", () => {
    const pages = { pages: [{ content: "one" }, { content: "two" }, { title: "none" }] };
    expect(
      payloadsOf(use("mcp__claude_ai_Notion__notion-create-pages", pages)).map((p) => p.text),
    ).toEqual(["one", "two"]);
    expect(
      payloadsOf(use("mcp__claude_ai_Linear__save_issue", { description: "d" })),
    ).toMatchObject([{ message: true, text: "d" }]);
  });
});

describe("firstDrafts", () => {
  const payload = (target: string, text: string, timestamp: string): Payload => ({
    host: "local",
    session: "s1",
    timestamp,
    tool: "Write",
    target,
    message: false,
    text,
  });

  test("keeps a session's first version of each target", () => {
    const kept = firstDrafts([
      payload("a.md", prose("revised"), "2026-10-01 00:02:00"),
      payload("a.md", prose("first"), "2026-10-01 00:01:00"),
    ]);
    expect(kept.map((p) => p.text)).toEqual([prose("first")]);
  });

  test("drops repeated text and short drafts", () => {
    const kept = firstDrafts([
      payload("a.md", prose("same"), "2026-10-01 00:01:00"),
      payload("b.md", prose("same"), "2026-10-01 00:02:00"),
      payload("c.md", "too short", "2026-10-01 00:03:00"),
    ]);
    expect(kept.map((p) => p.target)).toEqual(["a.md"]);
  });
});

describe("sample", () => {
  const finding = (category: string): Finding => ({
    line: 1,
    col: 1,
    category,
    tier: "context",
    structural: false,
    message: "",
  });
  const draft = (id: string, ...categories: string[]): Draft => ({
    id,
    split: "dev",
    host: "local",
    timestamp: "",
    tool: "Write",
    message: false,
    text: "",
    findings: categories.map(finding),
  });

  test("caps each category and still takes a draft carrying a rare one", () => {
    const chosen = sample(
      [draft("a", "common"), draft("b", "common"), draft("c", "common", "rare")],
      1,
    );
    expect(chosen.map((d) => d.id)).toEqual(["a", "c"]);
  });
});
