import type { EngineInterface, On, ToolCallResult } from "claude-code";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

const MOD = "classifier-telemetry";

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

function keyOf(agentId: string | undefined, toolUseId: string): string {
  return `${agentId ?? ""}/${toolUseId}`;
}

function outcomeOf(result: ToolCallResult): "ok" | "error" | "deny" {
  if (result.deny !== undefined) return "deny";
  if (result.isError) return "error";
  return "ok";
}

/**
 * Records each tool call's permission verdict and each server tool the API ran.
 * An `ask` goes to the mode's decider, which the mod API does not expose, so
 * a verdict's `ms` spans the decider plus the tool. `check_ms` is the time to the verdict.
 */
export function register(on: On): void {
  const verdicts = new Map<string, Verdict>();

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return next(e);
  });

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
    const settled: { result: ToolCallResult } | { thrown: unknown } = await next(e).then(
      (result: ToolCallResult) => ({ result }),
      (thrown: unknown) => ({ thrown }),
    );
    const verdict = verdicts.get(key);
    verdicts.delete(key);
    const finishedAt = await $.clock.now();
    const outcome = "result" in settled ? outcomeOf(settled.result) : "throw";
    void $.modEvents.emit({
      mod: MOD,
      event: "tool.verdict",
      ok: outcome === "ok",
      ms: finishedAt - startedAt,
      detail: {
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
        outcome,
      },
    });
    if ("thrown" in settled) throw settled.thrown;
    return settled.result;
  });

  on("turn.step", async function* ($, e, next) {
    const response = yield* next(e);
    const events: ModEventsInput[] = [];
    for (const use of response.serverToolUses ?? []) {
      const event: ModEventsInput = {
        mod: MOD,
        event: "server.tool",
        detail: {
          tool_use_id: use.id,
          agent_id: e.agentId ?? null,
          tool: use.name,
          turn_id: response.turnId,
          step: response.index,
          started_at: use.startedAt,
        },
      };
      if (use.endedAt !== undefined) event.ms = use.endedAt - use.startedAt;
      events.push(event);
    }
    await Promise.all(events.map((event) => $.modEvents.emit(event)));
    return response;
  });
}
