import { describe, expect, test } from "bun:test";
import { bodySource, rows } from "./report";

function trace(...calls: [string, { content: string; is_error?: boolean }][]): string {
  return calls
    .flatMap(([command, result], index) => [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: `t${index}`, name: "Bash", input: { command } }],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: `t${index}`, ...result }] },
      },
    ])
    .map((line) => JSON.stringify(line))
    .join("\n");
}

describe("bodySource", () => {
  test.each<[string, string]>([
    ["gh pr create --body-file - <<'EOF'\nProse.\nEOF", "heredoc"],
    ["cp a.md b.md && gh pr create --body-file b.md", "file a.md"],
    ["sed -i.bak 's/a/b/' b.md && gh pr edit 12 --body-file b.md", "file b.md after sed"],
    [
      'gh pr create --body "$BODY"',
      "unreadable: an inline body holding a shell expansion the hook cannot evaluate (`$BODY`)",
    ],
    ["gh pr create --fill", "none"],
  ])("%p -> %p", (command, expected) => {
    expect(bodySource(command)).toBe(expected);
  });
});

describe("rows", () => {
  test("pairs each PR command with what came back and skips other calls", () => {
    const found = rows(
      trace(
        ["git push -u origin HEAD", { content: "ok" }],
        [
          "cp a.md b.md && sed -i 's/x/y/' b.md && gh pr create --body-file b.md",
          {
            content:
              "Fix the PR body before retrying:\n- The hook cannot read body file `b.md`, which `sed` writes after the hook runs",
            is_error: true,
          },
        ],
        ["gh pr create --body-file b.md", { content: "https://github.com/o/r/pull/1" }],
      ),
      "case-with-1",
    );
    expect(found).toEqual([
      {
        trace: "case-with-1",
        verb: "gh pr create",
        before: "cp && sed",
        source: "file b.md after sed",
        outcome:
          "denied: The hook cannot read body file `b.md`, which `sed` writes after the hook runs",
      },
      {
        trace: "case-with-1",
        verb: "gh pr create",
        before: "",
        source: "file b.md",
        outcome: "ran",
      },
    ]);
  });

  test("tolerates a transcript cut mid-line", () => {
    expect(rows('{"type":"assistant","message":{"content":[{"ty', "cut")).toEqual([]);
  });
});
