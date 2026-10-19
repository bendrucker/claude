import type { EngineInterface, On, Settings } from "claude-code";
import { judge, message } from "./scaffold";

const MOD = "sandbox";

function failed($: EngineInterface, hook: string, kind: string, text?: string): void {
  $.modEvents
    .emit({ mod: MOD, event: "error", ok: false, detail: { hook, kind, message: text ?? null } })
    .catch(() => undefined);
}

const SOURCES = ["user", "project", "local", "flag", "policy"] as const;

function sandboxOf(settings: Settings): Record<string, unknown> {
  const sandbox: unknown = settings.sandbox;
  return sandbox !== null && typeof sandbox === "object" ? { ...sandbox } : {};
}

/**
 * The active `sandbox.excludedCommands`, or none while the sandbox is off and
 * the flag is a no-op. The engine concatenates the list across sources and
 * takes `enabled` from the highest one that sets it, so each source is read
 * on its own rather than through one merged `sandbox` key.
 */
async function excluded($: EngineInterface): Promise<string[]> {
  const sources = (await Promise.all(SOURCES.map((source) => $.settings.read({ source })))).map(
    sandboxOf,
  );
  const enabled = sources.findLast((sandbox) => typeof sandbox.enabled === "boolean")?.enabled;
  if (enabled !== true) return [];
  const entries = sources.flatMap(({ excludedCommands }) =>
    Array.isArray(excludedCommands) ? excludedCommands : [],
  );
  return [
    ...new Set(
      entries.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== ""),
    ),
  ];
}

export function register(on: On): void {
  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return next(e);
  });

  // Reminders already given per loop, so a repeat after one shows the note did not land.
  const reminded = new Map<string, number>();

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (e.dangerouslyDisableSandbox !== true) return next(e);
    const patterns = await excluded($);
    if (patterns.length === 0) return next(e);

    // A subagent's shell may start in its own worktree, which the session's
    // cwd does not name, so a `cd` there is never judged redundant.
    const cwd = e.agentId === undefined ? await $.session.cwd() : null;
    const verdict = judge(e.command, patterns, cwd);
    const agent = e.agentId ?? null;
    const repeat = reminded.get(agent ?? "") ?? 0;
    if (verdict.escapes) reminded.set(agent ?? "", repeat + 1);
    void $.modEvents.emit({
      mod: MOD,
      event: "bypass",
      detail: {
        verdict: verdict.escapes ? "remind" : "allow",
        reason: verdict.escapes ? null : verdict.reason,
        scaffolds: verdict.escapes ? [...new Set(verdict.scaffolds.map((s) => s.kind))] : [],
        verbs: verdict.verbs,
        agent,
        repeat: verdict.escapes ? repeat : null,
      },
    });
    // A deny costs a turn on every call it fires on, so the bypass runs and
    // the rewrite rides along for next time.
    const result = await next(e);
    if (!verdict.escapes || result.deny !== undefined) return result;
    return { ...result, context: [...(result.context ?? []), message(verdict)] };
    // Fails open: a broken parse must never block a bypass the person allowed.
  }).catch(($, e, next) => {
    failed($, "tool.call", next.error.kind, next.error.message);
    return next(e);
  });
}
