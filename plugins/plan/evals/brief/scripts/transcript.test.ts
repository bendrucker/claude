import { describe, expect, test } from "bun:test";
import {
  RESULT_LIMIT,
  renderItem,
  renderPrefix,
  truncate,
  type TranscriptItem,
} from "./transcript";

function makeItem(overrides: Partial<TranscriptItem> = {}): TranscriptItem {
  return { kind: "text", name: null, text: "hello", ...overrides };
}

describe("renderItem", () => {
  test.each<{ name: string; item: TranscriptItem; expected: string }>([
    {
      name: "prompt",
      item: makeItem({ kind: "prompt", text: "Plan it" }),
      expected: "## User\n\nPlan it",
    },
    { name: "assistant text", item: makeItem(), expected: "## Assistant\n\nhello" },
    {
      name: "tool call",
      item: makeItem({ kind: "tool_use", name: "Read", text: "src/a.ts" }),
      expected: "**Tool call** `Read`: `src/a.ts`",
    },
    {
      name: "tool call without input",
      item: makeItem({ kind: "tool_use", name: "Glob", text: "" }),
      expected: "**Tool call** `Glob`:",
    },
    {
      name: "result",
      item: makeItem({ kind: "tool_result", text: "ok" }),
      expected: "**Result**\n\n```\nok\n```",
    },
    {
      name: "result with a fence inside",
      item: makeItem({ kind: "tool_result", text: "a ``` b" }),
      expected: "**Result**\n\n````\na ``` b\n````",
    },
  ])("$name", ({ item, expected }) => {
    expect(renderItem(item)).toBe(expected);
  });

  test("truncates a long result", () => {
    const out = renderItem(makeItem({ kind: "tool_result", text: "x".repeat(RESULT_LIMIT + 50) }));
    expect(out).toContain("[truncated 50 chars]");
    expect(out).not.toContain("x".repeat(RESULT_LIMIT + 1));
  });
});

describe("truncate", () => {
  test.each([
    { name: "under limit", text: "abc", limit: 5, expected: "abc" },
    { name: "at limit", text: "abcde", limit: 5, expected: "abcde" },
    { name: "over limit", text: "abcdef", limit: 5, expected: "abcde\n[truncated 1 chars]" },
  ])("$name", ({ text, limit, expected }) => {
    expect(truncate(text, limit)).toBe(expected);
  });
});

describe("renderPrefix", () => {
  const prompt = makeItem({ kind: "prompt", text: "FIRST PROMPT" });
  const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => makeItem({ text: `msg-${i} ${"y".repeat(100)}` }));

  test("keeps everything under the limit", () => {
    const out = renderPrefix([prompt, ...filler(2)], 10_000);
    expect(out).toContain("FIRST PROMPT");
    expect(out).toContain("msg-1");
    expect(out).not.toContain("omitted");
  });

  test("drops the middle and keeps the first prompt and the tail", () => {
    const out = renderPrefix([prompt, ...filler(50)], 1_500);
    expect(out.length).toBeLessThanOrEqual(1_500);
    expect(out.startsWith("## User\n\nFIRST PROMPT")).toBe(true);
    expect(out).toContain("earlier items omitted");
    expect(out).toContain("msg-49");
    expect(out).not.toContain("msg-0 ");
  });

  test("keeps the first prompt when no tail fits", () => {
    const out = renderPrefix([prompt, makeItem({ text: "z".repeat(5_000) })], 300);
    expect(out).toContain("FIRST PROMPT");
    expect(out).not.toContain("zzzz");
  });

  test("empty input renders empty", () => {
    expect(renderPrefix([])).toBe("");
  });
});

describe("truncate surrogate pairs", () => {
  test("does not split an emoji at the limit", () => {
    const out = truncate("ab\u{1F600}cd", 3);
    expect(out.startsWith("ab\n")).toBe(true);
  });
});
