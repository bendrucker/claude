import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { $ } from "bun";
import { buildAttribution, printCaptured, shellQuote } from "./inbox";

describe("buildAttribution", () => {
  test("resumes in the caller's directory", () => {
    expect(buildAttribution("sess-1", "/repos/thing")).toMatchInlineSnapshot(`
      "---

      🤖 Created via Claude Code (Session: sess-1)

      \`\`\`sh
      cd '/repos/thing' && claude --resume 'sess-1'
      \`\`\`"
    `);
  });

  test("omits the cd when the caller has no directory to name", () => {
    expect(buildAttribution("sess-1")).toMatchInlineSnapshot(`
      "---

      🤖 Created via Claude Code (Session: sess-1)

      \`\`\`sh
      claude --resume 'sess-1'
      \`\`\`"
    `);
  });

  test.each<{ name: string; directory: string; expected: string }>([
    {
      name: "a space",
      directory: "/repos/my thing",
      expected: "cd '/repos/my thing' && claude --resume 'sess-1'",
    },
    {
      name: "an embedded single quote",
      directory: "/repos/ben's thing",
      expected: "cd '/repos/ben'\\''s thing' && claude --resume 'sess-1'",
    },
    {
      name: "a command separator",
      directory: "/repos/a; rm -rf b",
      expected: "cd '/repos/a; rm -rf b' && claude --resume 'sess-1'",
    },
  ])("quotes a directory containing $name", ({ directory, expected }) => {
    expect(buildAttribution("sess-1", directory)).toContain(expected);
  });

  // The point of the quoting is that a shell reads the value back whole, so ask
  // one. `directory` reaches this as an MCP tool argument, hence arbitrary.
  test.each([
    "/repos/my thing",
    "/repos/ben's thing",
    "/repos/a; rm -rf b",
    "/repos/$(whoami)",
    String.raw`/repos/back\slash`,
    '/repos/"quoted"',
  ])("survives a shell round trip: %s", async (directory) => {
    const { stdout } = await $`sh -c ${`printf %s ${shellQuote(directory)}`}`.quiet();
    expect(stdout.toString()).toBe(directory);
  });
});

describe("printCaptured", () => {
  const silenceLog = () => spyOn(console, "log").mockImplementation(() => {});
  let log: ReturnType<typeof silenceLog>;

  beforeEach(() => {
    log = silenceLog();
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
