import { describe, expect, test } from "bun:test";
import { type HookAlert, MAX_REPORTED, report } from "./report";

function makeAlert(overrides: Partial<HookAlert> = {}): HookAlert {
  return {
    check: "Writing.FillerWords",
    decision: "context",
    message: "Cut the filler.",
    at: "1:1",
    ...overrides,
  };
}

describe("report", () => {
  test("is null without alerts", () => {
    expect(report([], { event: "PreToolUse" })).toBeNull();
  });

  test("lists a file's alerts as PostToolUse context", () => {
    const result = report([makeAlert()], { event: "PostToolUse", filePath: "docs/a.md" });
    expect(result?.output).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "additionalContext": 
      "Vale found 1 alert in \`docs/a.md\`. Fix it.

      - 1:1 Writing.FillerWords: Cut the filler."
      ,
          "hookEventName": "PostToolUse",
        },
      }
    `);
  });

  test("denies a message when any alert denies, listing the deny first", () => {
    const result = report(
      [
        makeAlert(),
        makeAlert({
          check: "Writing.NoNegation",
          decision: "deny",
          message: "Negate the verb.",
          at: "2:5",
        }),
      ],
      { event: "PreToolUse" },
    );
    expect(result?.decision).toBe("deny");
    expect(result?.output).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "hookEventName": "PreToolUse",
          "permissionDecision": "deny",
          "permissionDecisionReason": 
      "Vale found 2 alerts in this text. Fix them in one pass.

      - 2:5 Writing.NoNegation: Negate the verb.
      - 1:1 Writing.FillerWords: Cut the filler."
      ,
        },
      }
    `);
  });

  test("caps the list and counts the rest", () => {
    const alerts = Array.from({ length: MAX_REPORTED + 3 }, (_, i) =>
      makeAlert({ check: `Writing.Rule${i}` }),
    );
    const result = report(alerts, { event: "PreToolUse" });
    expect(result?.shown).toHaveLength(MAX_REPORTED);
    expect(result?.output).toMatchSnapshot();
  });
});
