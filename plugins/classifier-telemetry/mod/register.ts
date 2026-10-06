import type { EngineInterface, On, ToolCallResult } from "claude-code";

const MOD = "classifier-telemetry";
const DIR = ".claude/classifier-telemetry";

/**
 * Tools whose run waits on the person by design, so their wall time measures the person.
 */
const INTERACTIVE = new Set(["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"]);

interface Verdict {
  decision: string;
  reason: string | null;
  rule: string | null;
  hook: string | null;
  checkedAt: number;
}

interface VerdictRecord {
  kind: "verdict";
  session_id: string;
  tool_use_id: string;
  agent_id: string | null;
  tool: string;
  interactive: boolean;
  decision: string | null;
  rule: string | null;
  hook: string | null;
  reason: string | null;
  started_at: number;
  check_ms: number | null;
  duration_ms: number;
  outcome: "ok" | "error" | "deny";
}

interface ServerToolRecord {
  kind: "server_tool";
  session_id: string;
  tool_use_id: string;
  agent_id: string | null;
  tool: string;
  turn_id: string;
  step: number;
  started_at: number;
  duration_ms: number | null;
}

type CallRecord = VerdictRecord | ServerToolRecord;

function keyOf(agentId: string | undefined, toolUseId: string): string {
  return `${agentId ?? ""}/${toolUseId}`;
}

function outcomeOf(result: ToolCallResult): VerdictRecord["outcome"] {
  if (result.deny !== undefined) return "deny";
  if (result.isError) return "error";
  return "ok";
}

async function emit($: EngineInterface, record: CallRecord): Promise<void> {
  const home = await $.env.get("HOME");
  if (home === undefined) return;
  try {
    await $.fs.write(
      `${home}/${DIR}/${record.session_id}/${record.tool_use_id}.json`,
      `${JSON.stringify(record)}\n`,
    );
  } catch {
    // A lost record must not fail a call that already ran.
  }
}

/**
 * Records each tool call's permission verdict and each server tool the API ran.
 * An `ask` goes to the mode's decider, which the mod API does not expose, so
 * `duration_ms` spans the decider plus the tool. `check_ms` is the time to the verdict.
 */
export function register(on: On): void {
  const verdicts = new Map<string, Verdict>();

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return started;
  });

  // Both hooks only observe, so a failure lets the call go on as the engine settled it.
  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    if (e.tool_use_id !== undefined) {
      verdicts.set(keyOf(e.agentId, e.tool_use_id), {
        decision: verdict.decision,
        reason: verdict.reason ?? null,
        rule: verdict.rule ?? null,
        hook: verdict.hook ?? null,
        checkedAt: await $.clock.now(),
      });
    }
    return verdict;
  }).catch(($, e, next) => next(e));

  on("tool.call", async ($, e, next) => {
    const key = keyOf(e.agentId, e.tool_use_id);
    const startedAt = await $.clock.now();
    let result: ToolCallResult;
    let verdict: Verdict | undefined;
    try {
      result = await next(e);
    } finally {
      verdict = verdicts.get(key);
      verdicts.delete(key);
    }
    const [finishedAt, sessionId] = await Promise.all([$.clock.now(), $.session.id()]);
    await emit($, {
      kind: "verdict",
      session_id: sessionId,
      tool_use_id: e.tool_use_id,
      agent_id: e.agentId ?? null,
      tool: e.tool,
      interactive: INTERACTIVE.has(e.tool),
      decision: verdict?.decision ?? null,
      rule: verdict?.rule ?? null,
      hook: verdict?.hook ?? null,
      reason: verdict?.reason ?? null,
      started_at: startedAt,
      check_ms: verdict === undefined ? null : verdict.checkedAt - startedAt,
      duration_ms: finishedAt - startedAt,
      outcome: outcomeOf(result),
    });
    return result;
  });

  on("turn.step", async function* ($, e, next) {
    const response = yield* next(e);
    const uses = response.serverToolUses ?? [];
    if (uses.length === 0) return response;
    const sessionId = await $.session.id();
    await Promise.all(
      uses.map((use) =>
        emit($, {
          kind: "server_tool",
          session_id: sessionId,
          tool_use_id: use.id,
          agent_id: e.agentId ?? null,
          tool: use.name,
          turn_id: response.turnId,
          step: response.index,
          started_at: use.startedAt,
          duration_ms: use.endedAt === undefined ? null : use.endedAt - use.startedAt,
        }),
      ),
    );
    return response;
  });
}
