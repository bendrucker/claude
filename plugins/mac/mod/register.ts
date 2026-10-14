import type { On } from "claude-code";

const MOD = "mac";

const SEPARATORS = new Set([";", "|", "&", "\n", "(", ")"]);
const WHITESPACE = new Set([" ", "\t", "\r"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
// Words that stand ahead of the command they run, along with their options.
const PREFIXES = new Set(["env", "time", "nohup", "exec", "command", "sudo"]);
const EXEMPT = new Map([["bun", new Set(["install", "i"])]]);

export interface Command {
  verb: string;
  subcommand: string | undefined;
}

/** Splits a command into segments of words, honoring quotes and backslash escapes. */
function segmentsOf(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  let quote: string | undefined;
  const flush = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i);
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else if (quote === '"' && ch === "\\") word = (word ?? "") + command.charAt(++i);
      else word = (word ?? "") + ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= "";
    } else if (ch === "\\") {
      word = (word ?? "") + command.charAt(++i);
    } else if (WHITESPACE.has(ch)) {
      flush();
    } else if (
      SEPARATORS.has(ch) &&
      !(ch === "&" && (word?.endsWith(">") || command.charAt(i + 1) === ">"))
    ) {
      flush();
      if (words.length > 0) segments.push(words);
      words = [];
    } else {
      word = (word ?? "") + ch;
    }
  }
  flush();
  if (words.length > 0) segments.push(words);
  return segments;
}

/** The first segment that does more than change directory, past assignments and prefixes. */
export function commandOf(command: string): Command | undefined {
  for (const words of segmentsOf(command)) {
    let start = 0;
    for (let word = words[start]; word !== undefined; word = words[start]) {
      if (ASSIGNMENT.test(word)) start++;
      else if (PREFIXES.has(word)) while (words[++start]?.startsWith("-")) continue;
      else break;
    }
    const word = words[start];
    if (word === undefined || word === "cd") continue;
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
 * verb fail sandboxed, and records whether the denied command's sandboxed retry succeeded.
 *
 * An experiment: remove it if fewer than ~50% of `bypass.deny` events are
 * followed by a successful `bypass.retry` over two weeks.
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
    const key = `${e.agentId ?? ""}\0${e.command}`;
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
