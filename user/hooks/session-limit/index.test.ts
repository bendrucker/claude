process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SyncHookJSONOutput,
  UserPromptSubmitHookInput,
  UserPromptSubmitHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  crossedBand,
  evaluate,
  FIVE_HOUR_BANDS,
  formatResetTime,
  type Marker,
  processInput,
  SEVEN_DAY_BANDS,
} from "./index";

const FIVE_RESETS = 1783503000; // Wed 9:30 AM UTC
const SEVEN_RESETS = 1783922400; // Mon 6:00 AM UTC
const FIVE_RESETS_MS = FIVE_RESETS * 1000;

function limits(fivePct: number, sevenPct = 0) {
  return {
    five_hour: { used_percentage: fivePct, resets_at: FIVE_RESETS },
    seven_day: { used_percentage: sevenPct, resets_at: SEVEN_RESETS },
  };
}

function marker(over: Partial<Marker> = {}): Marker {
  return {
    fiveHourBand: 0,
    fiveHourResetsAt: FIVE_RESETS,
    sevenDayBand: 0,
    sevenDayResetsAt: SEVEN_RESETS,
    ...over,
  };
}

describe("crossedBand", () => {
  test.each([
    [89, 0],
    [90, 90],
    [94, 90],
    [95, 95],
    [99, 95],
    [100, 100],
  ])("five-hour %i%% -> band %i", (pct, expected) => {
    expect(crossedBand(pct, FIVE_HOUR_BANDS)?.threshold ?? 0).toBe(expected);
  });

  test.each([
    [94, 0],
    [95, 95],
    [100, 95],
  ])("seven-day %i%% -> band %i", (pct, expected) => {
    expect(crossedBand(pct, SEVEN_DAY_BANDS)?.threshold ?? 0).toBe(expected);
  });
});

describe("formatResetTime", () => {
  it("renders local weekday and time", () => {
    expect(formatResetTime(FIVE_RESETS)).toBe("Wed 9:30 AM");
    expect(formatResetTime(SEVEN_RESETS)).toBe("Mon 6:00 AM");
  });
});

describe("evaluate", () => {
  it("returns null when five_hour percentage is absent", () => {
    expect(evaluate({ seven_day: { used_percentage: 99 } }, null, 0)).toBeNull();
    expect(evaluate({}, null, 0)).toBeNull();
  });

  it("emits nothing below the first threshold", () => {
    const result = evaluate(limits(89), null, 0);
    expect(result?.messages).toEqual([]);
    expect(result?.marker.fiveHourBand).toBe(0);
  });

  it("announces the 90 band on first crossing", () => {
    const result = evaluate(limits(92), null, 0);
    expect(result?.marker.fiveHourBand).toBe(90);
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]).toContain("90%");
    expect(result?.messages[0]).toContain("Wed 9:30 AM");
  });

  it("suppresses a band already announced for the same block", () => {
    const result = evaluate(limits(92), marker({ fiveHourBand: 90 }), 0);
    expect(result?.messages).toEqual([]);
    expect(result?.marker.fiveHourBand).toBe(90);
  });

  it("escalates to the next band", () => {
    const result = evaluate(limits(96), marker({ fiveHourBand: 90 }), 0);
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]).toContain("95%");
    expect(result?.marker.fiveHourBand).toBe(95);
  });

  it("resets the band when the block rolls over", () => {
    const prev = marker({ fiveHourBand: 95, fiveHourResetsAt: FIVE_RESETS - 18000 });
    const result = evaluate(limits(30), prev, 0);
    expect(result?.messages).toEqual([]);
    expect(result?.marker.fiveHourBand).toBe(0);
    expect(result?.marker.fiveHourResetsAt).toBe(FIVE_RESETS);
  });

  it("schedules a wake-up when the reset is within the wake-up horizon", () => {
    const result = evaluate(limits(100), null, FIVE_RESETS_MS - 10 * 60 * 1000);
    expect(result?.messages[0]).toContain("schedule a wake-up");
    expect(result?.messages[0]).not.toContain("tell the user to return");
  });

  it("defers to the user when the reset is beyond the wake-up horizon", () => {
    const result = evaluate(limits(100), null, FIVE_RESETS_MS - 2 * 60 * 60 * 1000);
    expect(result?.messages[0]).toContain("tell the user to return");
    expect(result?.messages[0]).not.toContain("schedule a wake-up");
  });

  it("defers rather than scheduling when a stale reset is already in the past", () => {
    const result = evaluate(limits(100), null, FIVE_RESETS_MS + 60 * 1000);
    expect(result?.messages[0]).toContain("tell the user to return");
    expect(result?.messages[0]).not.toContain("schedule a wake-up");
  });

  it("announces the seven-day band independently", () => {
    const result = evaluate(limits(50, 96), null, 0);
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]).toContain("7-day");
    expect(result?.marker.sevenDayBand).toBe(95);
  });

  it("announces both windows in one evaluation", () => {
    const result = evaluate(limits(90, 96), null, 0);
    expect(result?.messages).toHaveLength(2);
  });
});

describe("message content", () => {
  it("matches the five-hour snapshots", () => {
    expect(evaluate(limits(90), null, 0)?.messages[0]).toMatchInlineSnapshot(
      `"You are at 90% of the current 5-hour usage block (resets Wed 9:30 AM). Favor efficient work and avoid starting large non-essential tasks."`,
    );
    expect(evaluate(limits(95), null, 0)?.messages[0]).toMatchInlineSnapshot(
      `"You are at 95% of the current 5-hour usage block (resets Wed 9:30 AM). Prefer finishing in-flight work over starting anything new, and batch tool calls."`,
    );
    expect(
      evaluate(limits(100), null, FIVE_RESETS_MS - 10 * 60 * 1000)?.messages[0],
    ).toMatchInlineSnapshot(
      `"The 5-hour usage block is exhausted (resets Wed 9:30 AM). Every further request now spends overage credits. Finish only in-flight work, then schedule a wake-up for just after Wed 9:30 AM (no need to ask) so work resumes on a fresh block, and stop. Start no new work."`,
    );
    expect(
      evaluate(limits(100), null, FIVE_RESETS_MS - 2 * 60 * 60 * 1000)?.messages[0],
    ).toMatchInlineSnapshot(
      `"The 5-hour usage block is exhausted (resets Wed 9:30 AM). Every further request now spends overage credits. Finish only in-flight work, then tell the user to return at Wed 9:30 AM to resume on a fresh block, and stop. Start no new work."`,
    );
  });

  it("matches the seven-day snapshot", () => {
    expect(evaluate(limits(50, 95), null, 0)?.messages[0]).toMatchInlineSnapshot(
      `"You are at 95% of the 7-day usage limit. A 5-hour wait will not restore this. Minimize spend until the weekly reset (Mon 6:00 AM)."`,
    );
  });
});

describe("processInput", () => {
  let dir: string;
  let rlPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-limit-"));
    rlPath = join(dir, "rl.json");
    process.env.CLAUDE_STATUSLINE_RATE_LIMITS_PATH = rlPath;
    process.env.CLAUDE_SESSION_LIMIT_MARKER_ROOT = join(dir, "markers");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.CLAUDE_STATUSLINE_RATE_LIMITS_PATH;
    delete process.env.CLAUDE_SESSION_LIMIT_MARKER_ROOT;
  });

  function input(sessionId: string): UserPromptSubmitHookInput {
    return {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      prompt: "hi",
    };
  }

  async function writeLimits(fivePct: number, sevenPct = 0) {
    await Bun.write(rlPath, JSON.stringify(limits(fivePct, sevenPct)));
  }

  function context(output: SyncHookJSONOutput | null): string {
    const specific = output?.hookSpecificOutput as UserPromptSubmitHookSpecificOutput | undefined;
    return specific?.additionalContext ?? "";
  }

  it("injects context when a band is crossed", async () => {
    await writeLimits(92);
    const ctx = context(await processInput(input("s1"), 0));
    expect(ctx).toContain("90%");
    expect(ctx).toContain("Wed 9:30 AM");
  });

  it("dedups across invocations and escalates on the next band", async () => {
    await writeLimits(92);
    expect(await processInput(input("s2"), 0)).not.toBeNull();
    expect(await processInput(input("s2"), 0)).toBeNull();

    await writeLimits(96);
    expect(context(await processInput(input("s2"), 0))).toContain("95%");
  });

  it("resets the band after a block rollover", async () => {
    await writeLimits(96);
    expect(await processInput(input("s3"), 0)).not.toBeNull();

    await Bun.write(
      rlPath,
      JSON.stringify({
        five_hour: { used_percentage: 30, resets_at: FIVE_RESETS + 18000 },
        seven_day: { used_percentage: 0, resets_at: SEVEN_RESETS },
      }),
    );
    expect(await processInput(input("s3"), 0)).toBeNull();

    const stored = (await Bun.file(
      join(dir, "markers", "s3", "session-limit.json"),
    ).json()) as Marker;
    expect(stored.fiveHourBand).toBe(0);
    expect(stored.fiveHourResetsAt).toBe(FIVE_RESETS + 18000);
  });

  it("emits nothing when the rate-limit file is missing", async () => {
    expect(await processInput(input("s4"), 0)).toBeNull();
  });

  it("emits nothing when the rate-limit file is empty", async () => {
    await Bun.write(rlPath, "");
    expect(await processInput(input("s5"), 0)).toBeNull();
  });
});
