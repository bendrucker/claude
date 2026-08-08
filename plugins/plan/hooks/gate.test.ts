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
  // Equal-length prefixes keep the rewrite the same size as the original, so the
  // sustained-growth branch stays out of tests about the hash check.
  const body = (prefix: string) =>
    Array.from({ length: 20 }, (_, i) => `${prefix} line ${i}`).join("\n");
  const plan = body("alpha");
  const rewritten = body("bravo");

  it("denies a byte-identical resubmission", async () => {
    await decision(plan);
    expect(await decision(plan)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("byte-identical"),
    });
  });

  it("denies repeatedly until the text changes", async () => {
    await decision(plan);
    expect((await decision(plan))?.permissionDecision).toBe("deny");
    expect((await decision(plan))?.permissionDecision).toBe("deny");
    expect(await decision(rewritten)).toBeNull();
  });

  it.each<{ name: string; changedPlan: string }>([
    { name: "allows a changed plan", changedPlan: rewritten },
    { name: "treats trailing-whitespace-only changes as changed", changedPlan: `${plan} \n` },
  ])("$name", async ({ changedPlan }) => {
    await decision(plan);
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

describe("append-only re-present", () => {
  const basePlan = [
    "# Add retry to the fetch client",
    "## Approach",
    "- Wrap the fetch call in a retry loop",
    "- Back off exponentially between attempts",
    "- Cap retries at 3",
    "## Files",
    "- src/client.ts",
    "- src/client.test.ts",
    "## Testing",
    "- Add a test for the backoff schedule",
  ].join("\n");

  it("asks when the re-present keeps nearly all prior lines and only adds new ones", async () => {
    await decision(basePlan);
    const grown = `${basePlan}\n## Rollout\n- Ship behind a flag\n- Monitor error rates`;
    expect(await decision(grown)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: expect.stringContaining("carries nearly every prior line"),
    });
  });

  it("allows a genuine revision that rewrites most of the plan", async () => {
    await decision(basePlan);
    const rewritten = [
      "# Add retry to the fetch client",
      "## Approach",
      "- Use a circuit breaker instead of unbounded retries",
      "- Fail fast after 2 consecutive errors",
      "## Files",
      "- src/circuit-breaker.ts",
      "## Testing",
      "- Add a test for the open/closed transitions",
    ].join("\n");
    expect(await decision(rewritten)).toBeNull();
  });

  it("does not ask on the first presentation of a plan that would otherwise qualify", async () => {
    expect(await decision(basePlan)).toBeNull();
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

describe("append-only re-present", () => {
  const lines = (count: number, prefix = "line") =>
    Array.from({ length: count }, (_, i) => `${prefix} ${i}`);

  const initial = lines(10).join("\n");

  it("asks when a re-present keeps nearly all prior lines and only adds new ones", async () => {
    await decision(initial);
    const appended = `${initial}\nline 10`;
    expect(await decision(appended)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: expect.stringContaining("carries nearly every prior line"),
    });
  });

  it("asks on a line swap that carries the document at zero net growth", async () => {
    const base = lines(50).join("\n");
    await decision(base);
    // Trade 3 lines for 3 new ones: carry-over 0.94, no net size change.
    const swapped = [...lines(47), ...lines(3, "swapped")].join("\n");
    expect(await decision(swapped)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: expect.stringContaining("carries nearly every prior line"),
    });
  });

  it("returns null for a genuine revision with low carry-over", async () => {
    await decision(initial);
    // Same prefix length, so the rewrite does not trip the growth branch.
    const revised = lines(10, "note").join("\n");
    expect(await decision(revised)).toBeNull();
  });

  it("does not ask when the re-present adds no new lines", async () => {
    await decision(initial);
    // Same lines, reordered: full carry-over, nothing introduced.
    const reordered = [...lines(10)].reverse().join("\n");
    expect(await decision(reordered)).toBeNull();
  });

  it("does not ask when more than the incidental-drop allowance is removed", async () => {
    const big = lines(100).join("\n");
    await decision(big);
    // Drop 4 prior lines and add 5 new ones: carry-over is still >= 0.9, but
    // removal exceeds the incidental-drop allowance, so this is a real edit.
    const trimmedAndGrown = [...lines(96), ...lines(5, "new")].join("\n");
    expect(await decision(trimmedAndGrown)).toBeNull();
  });

  it("allows and skips state when the stored line set is corrupt", async () => {
    await decision(initial);
    await Bun.write(join(stateRoot, "session-1", "exit-plan-lines"), "not json");
    // A one-line swap the append-only check would ask on, at unchanged length.
    expect(await decision(initial.replace("line 9", "line X"))).toBeNull();
  });

  it("prefers deny when the append-only re-present is byte-identical", async () => {
    await decision(initial);
    await decision(`${initial}\nline 10`);
    expect((await decision(`${initial}\nline 10`))?.permissionDecision).toBe("deny");
  });

  it("asks once for append-only, not size, when the re-present is also oversized", async () => {
    const pad = "x".repeat(120);
    const padded = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) => `${prefix} ${i} ${pad}`);
    const base = padded(90, "line").join("\n");
    expect(base.length).toBeLessThan(12_000);
    await decision(base);

    const grown = [...padded(90, "line"), ...padded(5, "new")].join("\n");
    expect(grown.length).toBeGreaterThan(12_000);
    expect(await decision(grown)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: expect.stringContaining("carries nearly every prior line"),
    });
    // Append-only asks before the size check, so the size branch never runs and
    // records no marker: one prompt for append-only, no second prompt for size.
    expect(readdirSync(join(stateRoot, "session-1"))).not.toContain("exit-plan-size-asked");
  });
});

describe("sustained growth", () => {
  // Each rewrite uses a distinct line prefix so carry-over stays low and the
  // append-only check, which runs first, never fires.
  const rewrite = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${prefix} ${i}`).join("\n");

  const skeletal = rewrite("alpha", 4);
  const grown = rewrite("bravo", 12);
  const grownAgain = rewrite("charlie", 30);

  it("asks on a second present above the high-water mark", async () => {
    await decision(skeletal);
    expect(await decision(grown)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: expect.stringContaining(
        `Presentation 2 is larger than any before it (${skeletal.length} -> ${grown.length} chars)`,
      ),
    });
  });

  it("does not ask on a first presentation, which has no high-water mark", async () => {
    expect(await decision(grownAgain)).toBeNull();
  });

  it("stays silent when a later present comes in under the high-water mark", async () => {
    await decision(grownAgain);
    expect(await decision(grown)).toBeNull();
  });

  it("measures against the high-water mark, not the previous present", async () => {
    await decision(grownAgain);
    await decision(rewrite("delta", 6));
    // Larger than the present before it, still under the high-water mark.
    expect(await decision(rewrite("echo", 10))).toBeNull();
  });

  it("asks at most once per session", async () => {
    await decision(skeletal);
    expect((await decision(grown))?.permissionDecision).toBe("ask");
    expect(await decision(rewrite("delta", 60))).toBeNull();
  });

  it("counts a present the append-only check asked on, and reports its ordinal", async () => {
    await decision(grownAgain);
    await decision(grown);
    // An append-only third present returns before the growth branch, so the
    // growth ask is still available when a genuine rewrite lands fourth.
    expect((await decision(`${grown}\nbravo tail`))?.permissionDecision).toBe("ask");
    expect((await decision(rewrite("delta", 60)))?.permissionDecisionReason).toContain(
      "Presentation 4",
    );
  });

  it("allows and skips the check when the stored history is corrupt", async () => {
    await decision(skeletal);
    await Bun.write(join(stateRoot, "session-1", "exit-plan-presents"), "not json");
    expect(await decision(grown)).toBeNull();
  });

  it("still denies a byte-identical re-present after the growth ask has fired", async () => {
    await decision(skeletal);
    expect((await decision(grown))?.permissionDecision).toBe("ask");
    expect((await decision(grown))?.permissionDecision).toBe("deny");
  });

  it("does not spend the ask on a plan that barely clears the high-water mark", async () => {
    await decision(grownAgain);
    // One character over the high-water mark falls inside the noise margin.
    const barelyOver = rewrite("delta", 4).padEnd(grownAgain.length + 1, "x");
    expect(await decision(barelyOver)).toBeNull();
    // The ask is still available for growth that reads as accumulation.
    expect((await decision(rewrite("echo", 60)))?.permissionDecision).toBe("ask");
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
