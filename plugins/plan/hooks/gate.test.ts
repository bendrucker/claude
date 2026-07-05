import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./gate";

let stateRoot: string;

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), "plan-gate-"));
});

afterEach(async () => {
  await rm(stateRoot, { recursive: true, force: true });
});

function mockInput(plan: string, sessionId = "session-1"): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "ExitPlanMode",
    tool_input: { plan },
    tool_use_id: "test",
  };
}

async function decision(
  plan: string,
  sessionId = "session-1",
): Promise<PreToolUseHookSpecificOutput | null> {
  const result = await processInput(mockInput(plan, sessionId), stateRoot);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("first presentation", () => {
  it("allows silently with no prior state", async () => {
    expect(await decision("My plan")).toBeNull();
  });

  it("records the hash for the next call", async () => {
    await decision("My plan");
    expect(readdirSync(join(stateRoot, "session-1"))).toContain("exit-plan-hash");
  });
});

describe("unchanged re-present", () => {
  it("denies a byte-identical resubmission", async () => {
    await decision("My plan");
    expect(await decision("My plan")).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("Plan text is unchanged"),
    });
  });

  it("denies repeatedly until the text changes", async () => {
    await decision("My plan");
    expect((await decision("My plan"))?.permissionDecision).toBe("deny");
    expect((await decision("My plan"))?.permissionDecision).toBe("deny");
    expect(await decision("My plan, revised")).toBeNull();
  });

  it.each<{ name: string; changedPlan: string }>([
    { name: "allows a changed plan", changedPlan: "My revised plan" },
    { name: "treats trailing-whitespace-only changes as changed", changedPlan: "My plan \n" },
  ])("$name", async ({ changedPlan }) => {
    await decision("My plan");
    expect(await decision(changedPlan)).toBeNull();
  });

  it("updates the stored hash on allow, so re-presenting the new text denies", async () => {
    await decision("Plan A");
    await decision("Plan B");
    expect((await decision("Plan B"))?.permissionDecision).toBe("deny");
  });

  it("keeps sessions independent", async () => {
    await decision("My plan", "session-1");
    expect(await decision("My plan", "session-2")).toBeNull();
  });
});

describe("size advisory", () => {
  const bigPlan = (seed: string) => seed + "x".repeat(12_001);

  it("asks on a plan over 12k characters", async () => {
    expect(await decision(bigPlan("a"))).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: expect.stringContaining("exceeds 12k characters"),
    });
  });

  it("does not ask at exactly 12k characters", async () => {
    expect(await decision("x".repeat(12_000))).toBeNull();
  });

  it("asks at most once per session", async () => {
    expect((await decision(bigPlan("a")))?.permissionDecision).toBe("ask");
    expect(await decision(bigPlan("b"))).toBeNull();
  });

  it("asks again in a different session", async () => {
    await decision(bigPlan("a"), "session-1");
    expect((await decision(bigPlan("a"), "session-2"))?.permissionDecision).toBe("ask");
  });

  it("prefers deny when the oversized plan is also unchanged", async () => {
    expect((await decision(bigPlan("a")))?.permissionDecision).toBe("ask");
    expect((await decision(bigPlan("a")))?.permissionDecision).toBe("deny");
  });
});

describe("fail open", () => {
  it("allows and skips state when session_id is missing", async () => {
    const input = mockInput("My plan");
    input.session_id = "";
    expect(await processInput(input, stateRoot)).toBeNull();
    expect(await processInput(input, stateRoot)).toBeNull();
    expect(readdirSync(stateRoot)).toEqual([]);
  });

  it("allows when tool_input has no plan string", async () => {
    const input = mockInput("unused");
    input.tool_input = {};
    expect(await processInput(input, stateRoot)).toBeNull();
  });

  it("allows when the stored hash is corrupt", async () => {
    await decision("My plan");
    await Bun.write(join(stateRoot, "session-1", "exit-plan-hash"), "not a real hash");
    expect(await decision("My plan")).toBeNull();
  });

  it("allows when the state root is unusable", async () => {
    await Bun.write(join(stateRoot, "blocked"), "");
    const blocked = join(stateRoot, "blocked", "nested");
    expect(await processInput(mockInput("My plan"), blocked)).toBeNull();
    expect(await processInput(mockInput("My plan"), blocked)).toBeNull();
  });
});
