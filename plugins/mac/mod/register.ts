import type { On } from "claude-code";

const MOD = "mac";

const SEPARATOR = /&&|\|\||[;|&\n]/;
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
// Words that stand ahead of the command they run.
const PREFIXES = new Set(["env", "time", "nohup", "exec", "command", "sudo"]);
const EXEMPT = new Map([["bun", new Set(["install", "i"])]]);

export interface Command {
  verb: string;
  subcommand: string | undefined;
}

/** The first segment that does more than change directory, past assignments and prefixes. */
export function commandOf(command: string): Command | undefined {
  for (const segment of command.split(SEPARATOR)) {
    const words = segment.trim().split(/\s+/);
    const start = words.findIndex((word) => !ASSIGNMENT.test(word) && !PREFIXES.has(word));
    const word = words[start];
    if (word === undefined || word === "" || word === "cd") continue;
    return { verb: word.slice(word.lastIndexOf("/") + 1), subcommand: words[start + 1] };
  }
  return undefined;
}

function isExempt({ verb, subcommand }: Command): boolean {
  return EXEMPT.get(verb)?.has(subcommand ?? "") ?? false;
}

export function denyReason(verb: string): string {
  return `Run this \`${verb}\` command sandboxed first: drop \`dangerouslyDisableSandbox\` and retry. Once a sandboxed \`${verb}\` fails in this session, a bypass for \`${verb}\` goes through.`;
}

/**
 * Holds back a Bash sandbox bypass until the session has seen that command's
 * verb fail sandboxed, and records whether the sandboxed retry succeeded.
 */
export function register(on: On): void {
  const failed = new Set<string>();
  const pending = new Set<string>();

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const parsed = commandOf(e.command);
    if (parsed === undefined) return next(e);
    const { verb } = parsed;
    const key = `${e.agentId ?? ""}/${verb}`;
    const detail = { verb, agent_id: e.agentId ?? null };

    if (e.dangerouslyDisableSandbox === true) {
      if (isExempt(parsed) || failed.has(verb)) {
        void $.modEvents.emit({
          mod: MOD,
          event: "bypass.allow",
          detail: { ...detail, reason: failed.has(verb) ? "failed" : "exempt" },
        });
        return next(e);
      }
      void $.modEvents.emit({
        mod: MOD,
        event: "bypass.deny",
        detail: { ...detail, repeat: pending.has(key) },
      });
      pending.add(key);
      return { deny: denyReason(verb) };
    }

    const result = await next(e);
    if (result.deny !== undefined) return result;
    const ok = result.isError !== true;
    if (!ok) failed.add(verb);
    if (pending.delete(key)) void $.modEvents.emit({ mod: MOD, event: "bypass.retry", ok, detail });
    return result;
  }).catch(($, e, next) => next(e));
}
