import { describe, expect, test } from "bun:test";
import type { HookEvent } from "./io";
import { decisionOf, type HookAlert, MAX_REPORTED, report, type Severity } from "./report";

function makeAlert(overrides: Partial<HookAlert> = {}): HookAlert {
  return {
    check: "Writing.FillerWords",
    decision: "context",
    severity: "warning",
    message: "Cut the filler.",
    at: "1:1",
    ...overrides,
  };
}

test.each<{ severity: Severity; event: HookEvent; decision: "deny" | "context" }>([
  { severity: "error", event: "PreToolUse", decision: "deny" },
  { severity: "warning", event: "PreToolUse", decision: "context" },
  { severity: "suggestion", event: "PreToolUse", decision: "context" },
  { severity: "error", event: "PostToolUse", decision: "context" },
  { severity: "warning", event: "PostToolUse", decision: "context" },
  { severity: "suggestion", event: "PostToolUse", decision: "context" },
])("a $severity on $event is $decision", ({ severity, event, decision }) => {
  expect(decisionOf(severity, event)).toBe(decision);
});

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
      "Vale found 1 alert in \`docs/a.md\`.

      Warnings are likely problems. Fix each one unless it is wrong for this text:
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
          severity: "error",
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
      "Vale found 2 alerts in this text.

      Errors are high-confidence. Fix each one:
      - 2:5 Writing.NoNegation: Negate the verb.

      Warnings are likely problems. Fix each one unless it is wrong for this text:
      - 1:1 Writing.FillerWords: Cut the filler."
      ,
        },
      }
    `);
  });

  test("groups alerts by severity, each under what it expects", () => {
    const result = report(
      [
        makeAlert({ check: "Writing.Hedge", severity: "suggestion", at: "3:1" }),
        makeAlert({ check: "Writing.Splice", severity: "error", at: "1:1" }),
        makeAlert({ check: "Writing.Filler", severity: "warning", at: "2:1" }),
      ],
      { event: "PostToolUse", filePath: "docs/a.md" },
    );
    expect(result?.decision).toBe("context");
    expect(result?.output).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "additionalContext": 
      "Vale found 3 alerts in \`docs/a.md\`.

      Errors are high-confidence. Fix each one:
      - 1:1 Writing.Splice: Cut the filler.

      Warnings are likely problems. Fix each one unless it is wrong for this text:
      - 2:1 Writing.Filler: Cut the filler.

      Suggestions are low-confidence. Apply one only where it makes the text better, and leave the rest as written:
      - 3:1 Writing.Hedge: Cut the filler."
      ,
          "hookEventName": "PostToolUse",
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
