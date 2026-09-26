import type { On, ToolCallResult } from "claude-code";

export const DIR = ".claude/classifier-telemetry";

interface Verdict {
  decision: string;
  reason: string | null;
  rule: string | null;
  checkedAt: number;
}

export interface CallRecord {
  session_id: string;
  tool_use_id: string;
  agent_id: string | null;
  tool: string;
  decision: string | null;
  rule: string | null;
  reason: string | null;
  started_at: number;
  check_ms: number | null;
  duration_ms: number;
  outcome: "ok" | "error" | "deny";
}

function outcomeOf(result: ToolCallResult): CallRecord["outcome"] {
  if (result.deny !== undefined) return "deny";
  if (result.isError) return "error";
  return "ok";
}

/**
 * Writes one record per tool call under `~/.claude/classifier-telemetry/<session>/`.
 * An `ask` verdict in auto mode is a call the classifier decided, and `duration_ms`
 * spans the classifier plus the tool itself.
 */
export function register(on: On): void {
  const verdicts = new Map<string, Verdict>();

  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    if (e.tool_use_id !== undefined) {
      verdicts.set(e.tool_use_id, {
        decision: verdict.decision,
        reason: verdict.reason ?? null,
        rule: verdict.rule ?? null,
        checkedAt: await $.clock.now(),
      });
    }
    return verdict;
  });

  on("tool.call", async ($, e, next) => {
    const startedAt = await $.clock.now();
    const result = await next(e);
    const [finishedAt, sessionId, home] = await Promise.all([
      $.clock.now(),
      $.session.id(),
      $.env.get("HOME"),
    ]);

    const verdict = verdicts.get(e.tool_use_id);
    verdicts.delete(e.tool_use_id);
    if (home === undefined) return result;

    const record: CallRecord = {
      session_id: sessionId,
      tool_use_id: e.tool_use_id,
      agent_id: e.agentId ?? null,
      tool: e.tool,
      decision: verdict?.decision ?? null,
      rule: verdict?.rule ?? null,
      reason: verdict?.reason ?? null,
      started_at: startedAt,
      check_ms: verdict === undefined ? null : verdict.checkedAt - startedAt,
      duration_ms: finishedAt - startedAt,
      outcome: outcomeOf(result),
    };
    try {
      await $.fs.write(
        `${home}/${DIR}/${sessionId}/${e.tool_use_id}.json`,
        `${JSON.stringify(record)}\n`,
      );
    } catch {
      // A lost record must not fail a call that already ran.
    }
    return result;
  });
}
