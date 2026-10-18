import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  assertDistinctSessions,
  bySession,
  caseId,
  type Decision,
  gateRule,
  type Present,
  Presents,
} from "./decisions";
import { processInput } from "./gate";

// Replay presentations through the gate as it is checked out now, one state
// directory per session. The corpus block runs only where `bun run mine` has
// written the private corpus.

const ReplayRow = z.object({
  id: z.string(),
  host: z.string(),
  chars: z.number(),
  actual: z.string(),
  replay: z.string(),
});
type ReplayRow = z.infer<typeof ReplayRow>;

function replayDecision(reason: string | undefined): Decision {
  if (reason === undefined) return "none";
  const rule = gateRule(reason);
  return rule === null ? "unknown" : `gate:${rule}`;
}

function hookInput(present: Present): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: present.session_id,
    transcript_path: "",
    cwd: "",
    tool_name: "ExitPlanMode",
    // A call mined without plan text reaches the gate the way it did live,
    // without a plan field, which the gate passes through untouched.
    tool_input: present.plan === "" ? {} : { plan: present.plan },
    tool_use_id: caseId(present),
  };
}

async function replaySession(
  presents: readonly Present[],
  stateRoot: string,
  index = 0,
  rows: ReplayRow[] = [],
): Promise<ReplayRow[]> {
  const present = presents[index];
  if (present === undefined) return rows;
  const output = await processInput(hookInput(present), stateRoot);
  const specific = output?.hookSpecificOutput;
  const reason =
    specific?.hookEventName === "PreToolUse" ? specific.permissionDecisionReason : undefined;
  rows.push({
    id: caseId(present),
    host: present.host,
    chars: present.chars,
    actual: present.actual,
    replay: replayDecision(reason),
  });
  return replaySession(presents, stateRoot, index + 1, rows);
}

async function replay(presents: readonly Present[]): Promise<ReplayRow[]> {
  assertDistinctSessions(presents);
  const root = await mkdtemp(join(tmpdir(), "plan-gate-replay-"));
  try {
    const sessions = [...bySession(presents).values()];
    const perSession = await Promise.all(sessions.map((list) => replaySession(list, root)));
    return perSession.flat();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function changed(rows: readonly ReplayRow[], baseline: readonly ReplayRow[]): ReplayRow[] {
  const before = new Map(baseline.map((row) => [row.id, row.replay]));
  return rows.filter((row) => before.has(row.id) && before.get(row.id) !== row.replay);
}

function fixture(session: string, seq: number, plan: string, actual = "none"): Present {
  return {
    host: "local",
    session_id: `${session}-session`,
    session,
    project_path: null,
    timestamp: `2026-09-01 00:00:0${seq}`,
    seq,
    chars: plan.length,
    plan,
    plan_file: null,
    model: null,
    response: null,
    actual,
  };
}

const oversized = `# Plan\n${"x".repeat(10_100)}\n`;
const small = "# Plan\n\nsmall\n";

describe("replay", () => {
  it("decides each session's presents in order with isolated state", async () => {
    const rows = await replay([
      fixture("aaaaaaaa", 2, small),
      fixture("aaaaaaaa", 1, small, "user:rejected"),
      fixture("bbbbbbbb", 1, oversized, "gate:size"),
      fixture("bbbbbbbb", 2, small),
    ]);
    const decisions = new Map(rows.map((row) => [row.id, row.replay]));
    expect(decisions.get("aaaaaaaa-seq1")).toBe("none");
    expect(decisions.get("aaaaaaaa-seq2")).toBe("gate:unchanged");
    expect(decisions.get("bbbbbbbb-seq1")).toBe("gate:size");
    expect(decisions.get("bbbbbbbb-seq2")).toBe("none");
  });

  it("maps a deny reason to its rule", () => {
    expect(replayDecision(undefined)).toBe("none");
    expect(replayDecision("This plan exceeds 10k characters.")).toBe("gate:size");
    expect(replayDecision("something new")).toBe("unknown");
  });

  it("lists only the decisions that moved against a baseline", () => {
    const row = (id: string, decision: string): ReplayRow => ({
      id,
      host: "local",
      chars: 1,
      actual: "none",
      replay: decision,
    });
    const baseline = [row("a", "gate:growth"), row("b", "gate:size"), row("c", "none")];
    const now = [row("a", "gate:size"), row("b", "gate:size"), row("d", "none")];
    expect(changed(now, baseline).map((r) => r.id)).toEqual(["a"]);
  });
});

const data = join(import.meta.dirname, "..", "evals", "gate", "data");
const corpus = join(data, "presents.json");
const baselinePath = join(data, "replay.json");
const hasCorpus = await Bun.file(corpus).exists();

describe("mined corpus", () => {
  it.skipIf(!hasCorpus)(
    "decides every presentation as the saved baseline did",
    async () => {
      const presents = Presents.parse(JSON.parse(await Bun.file(corpus).text()));
      const rows = await replay(presents);

      const tally = new Map<string, number>();
      for (const row of rows) {
        if (!row.actual.startsWith("gate:") && !row.replay.startsWith("gate:")) continue;
        const key = `${row.actual} -> ${row.replay}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      console.log(`${rows.length} presentations replayed`);
      console.table(Object.fromEntries([...tally].toSorted(([a], [b]) => a.localeCompare(b))));

      if (!(await Bun.file(baselinePath).exists())) {
        await Bun.write(baselinePath, `${JSON.stringify(rows, null, 2)}\n`);
        console.log(`saved baseline ${baselinePath}`);
        return;
      }
      const baseline = z.array(ReplayRow).parse(JSON.parse(await Bun.file(baselinePath).text()));
      const before = new Map(baseline.map((row) => [row.id, row.replay]));
      const moved = changed(rows, baseline).map(
        ({ id, chars, actual, replay: now }) =>
          `${id} (${chars} chars, ${actual}): ${before.get(id)} -> ${now}`,
      );
      expect(moved).toEqual([]);
    },
    60_000,
  );
});
