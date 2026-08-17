import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { buildAttribution, printCaptured } from "./inbox";

describe("buildAttribution", () => {
  test("resumes in the caller's directory", () => {
    expect(buildAttribution("sess-1", "/repos/thing")).toMatchInlineSnapshot(`
      "---

      🤖 Created via Claude Code (Session: sess-1)

      \`\`\`sh
      cd /repos/thing && claude --resume sess-1
      \`\`\`"
    `);
  });

  test("falls back to the process directory", () => {
    expect(buildAttribution("sess-1")).toContain(`cd ${process.cwd()} &&`);
  });
});

describe("printCaptured", () => {
  let log: ReturnType<typeof spyOn>;

  beforeEach(() => {
    log = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
  });

  test.each<{ name: string; captured: Map<string, string>; expected: string }>([
    {
      name: "prints title when present",
      captured: new Map([["title", "Buy milk"]]),
      expected: "captured: Buy milk",
    },
    {
      name: "prints first line and count for multi-line titles",
      captured: new Map([["titles", "Buy milk\nWalk dog\nCall mom"]]),
      expected: "captured: Buy milk (+2 more)",
    },
    {
      name: "prints titles without suffix when only one line",
      captured: new Map([["titles", "Just one"]]),
      expected: "captured: Just one",
    },
    {
      name: "ignores blank lines in titles count",
      captured: new Map([["titles", "Buy milk\n\n  \nWalk dog"]]),
      expected: "captured: Buy milk (+1 more)",
    },
    {
      name: "falls back to (untitled) when neither title nor titles present",
      captured: new Map([["notes", "just notes"]]),
      expected: "captured: (untitled)",
    },
    {
      name: "prefers title over titles when both present",
      captured: new Map([
        ["title", "Primary"],
        ["titles", "Secondary"],
      ]),
      expected: "captured: Primary",
    },
  ])("$name", ({ captured, expected }) => {
    printCaptured(captured);
    expect(log).toHaveBeenCalledWith(expected);
  });
});
