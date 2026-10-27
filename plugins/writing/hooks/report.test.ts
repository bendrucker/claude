import { describe, expect, test } from "bun:test";
import { type HookFinding, MAX_REPORTED, report } from "./report";

function makeFinding(overrides: Partial<HookFinding> = {}): HookFinding {
  return { category: "filler", tier: "context", message: "Cut the filler.", ...overrides };
}

describe("report", () => {
  test("is null without findings", () => {
    expect(report([], { toolName: "Write" })).toBeNull();
  });

  test("renders a lone finding as its bare message", () => {
    expect(report([makeFinding()], { toolName: "Bash" })?.output).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "additionalContext": "Cut the filler.",
          "hookEventName": "PreToolUse",
        },
      }
    `);
  });

  test("frames a lone introduced finding as a targeted fix", () => {
    const result = report([makeFinding({ introduced: true })], {
      toolName: "Edit",
      filePath: "docs/a.md",
    });
    expect(result?.output).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "additionalContext": "Cut the filler. You introduced this in your edit to \`docs/a.md\`. Issue a follow-up Edit that targets only the text you just changed. Do not modify unrelated parts of the file, including other pre-existing tropes.",
          "hookEventName": "PreToolUse",
        },
      }
    `);
  });

  test("lists every finding at the strictest tier, deny first", () => {
    const result = report(
      [
        makeFinding(),
        makeFinding({ category: "no-negation", tier: "deny", message: "Negate the verb." }),
        makeFinding({ category: "sentence heading", message: "Cut the heading." }),
      ],
      { toolName: "Bash" },
    );
    expect(result?.tier).toBe("deny");
    expect(result?.output).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "hookEventName": "PreToolUse",
          "permissionDecision": "deny",
          "permissionDecisionReason": 
      "Writing checks found 3 issues in this text. Fix them in one pass.

      - no-negation: Negate the verb.
      - filler: Cut the filler.
      - sentence heading: Cut the heading."
      ,
        },
      }
    `);
  });

  test("states the introduced-fix instruction once for several findings", () => {
    const result = report(
      [
        makeFinding({ category: "spaced em dash", message: "Split it.", introduced: true }),
        makeFinding(),
      ],
      { toolName: "Write", filePath: "docs/a.md" },
    );
    expect(result?.output).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "additionalContext": 
      "Writing checks found 2 issues in this text. Fix them in one pass.
      You wrote \`docs/a.md\` introducing the findings marked (introduced). Issue a follow-up Edit that fixes only those tropes. Do not modify unrelated parts of the file.

      - spaced em dash (introduced): Split it.
      - filler: Cut the filler."
      ,
          "hookEventName": "PreToolUse",
        },
      }
    `);
  });

  test("caps the list and counts the rest", () => {
    const findings = Array.from({ length: MAX_REPORTED + 3 }, (_, i) =>
      makeFinding({ category: `rule ${i}` }),
    );
    const result = report(findings, { toolName: "Bash" });
    expect(result?.shown).toHaveLength(MAX_REPORTED);
    expect(result?.output).toMatchSnapshot();
  });
});
