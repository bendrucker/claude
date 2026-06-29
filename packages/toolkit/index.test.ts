import { describe, expect, test } from "bun:test";
import { postToolUse, preToolUse } from "./index";

describe("preToolUse", () => {
  test("deny sets the permission decision", () => {
    expect(preToolUse.deny("nope")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "nope",
      },
    });
  });

  test("ask sets the permission decision", () => {
    expect(preToolUse.ask("maybe")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "maybe",
      },
    });
  });

  test("context carries additionalContext only", () => {
    expect(preToolUse.context("info")).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "info" },
    });
  });

  test("updatedInput omits additionalContext when absent", () => {
    expect(preToolUse.updatedInput({ command: "ls" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { command: "ls" } },
    });
  });

  test("updatedInput includes additionalContext when given", () => {
    expect(preToolUse.updatedInput({ command: "ls" }, "why")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: "ls" },
        additionalContext: "why",
      },
    });
  });
});

describe("postToolUse", () => {
  test("context carries additionalContext", () => {
    expect(postToolUse.context("done")).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "done" },
    });
  });
});
