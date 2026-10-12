import { type Segment, splitPrefix } from "./command";

export type Effect = "launch" | "close" | "close-all" | "none";

export interface BrowserCall {
  session: string;
  effect: Effect;
}

const RUNNERS = new Set(["npx", "bunx", "pnpx"]);

// Options whose value is a separate word.
const VALUED = new Set([
  "--session",
  "--namespace",
  "--profile",
  "--session-name",
  "--state",
  "--headers",
  "--executable-path",
  "--extension",
  "--init-script",
  "--enable",
  "--args",
  "--user-agent",
  "--proxy",
  "--proxy-bypass",
  "--ca-cert",
  "--cdp",
  "-p",
  "--provider",
  "--device",
  "--screenshot-dir",
  "--screenshot-quality",
  "--screenshot-format",
  "--input-mode",
  "--idle-timeout",
  "--restore-save",
  "--model",
]);

const INERT = new Set([
  "session",
  "skills",
  "help",
  "install",
  "upgrade",
  "doctor",
  "dashboard",
  "profiles",
  "auth",
  "plugin",
  "mcp",
]);

const INERT_FLAGS = new Set(["--help", "-h", "--version", "-V"]);

function isAgentBrowser(word: string | undefined): boolean {
  return word !== undefined && (word === "agent-browser" || word.endsWith("/agent-browser"));
}

function parse(argv: string[], envSession: string | undefined): BrowserCall {
  let session = envSession;
  let subcommand: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] ?? "";
    if (word.startsWith("--session=")) {
      session = word.slice("--session=".length);
    } else if (word === "--session") {
      session = argv[i + 1];
      i++;
    } else if (VALUED.has(word)) {
      i++;
    } else if (subcommand === undefined && !word.startsWith("-")) {
      subcommand = word;
    } else {
      rest.push(word);
    }
  }
  const resolved = session === undefined || session === "" ? "default" : session;
  if (subcommand === "close") {
    return { session: resolved, effect: rest.includes("--all") ? "close-all" : "close" };
  }
  const isInert =
    subcommand === undefined || INERT.has(subcommand) || rest.some((word) => INERT_FLAGS.has(word));
  return { session: resolved, effect: isInert ? "none" : "launch" };
}

export function browserCalls(segments: Segment[]): BrowserCall[] {
  const calls: BrowserCall[] = [];
  for (const { words } of segments) {
    const { env, argv } = splitPrefix(words);
    let start = 0;
    if (RUNNERS.has(argv[0] ?? "")) {
      start = 1;
      while ((argv[start] ?? "").startsWith("-")) start++;
    }
    if (!isAgentBrowser(argv[start])) continue;
    calls.push(parse(argv.slice(start + 1), env.get("AGENT_BROWSER_SESSION")));
  }
  return calls;
}

export interface Verdict {
  deny?: string;
  reason?: "owned" | "cap" | "close-all" | "dynamic";
}

export interface Census {
  live: Set<string>;
  /** Allowed to launch, call not yet returned. */
  pending: Set<string>;
  mine: Set<string>;
  others: Set<string>;
}

export const MAX_DAEMONS = 3;

const list = (sessions: Iterable<string>) => [...sessions].map((s) => `\`${s}\``).join(", ");

export function judge(calls: BrowserCall[], census: Census): Verdict {
  if (calls.some((call) => call.effect === "close-all") && census.others.size > 0) {
    return {
      reason: "close-all",
      deny: `\`agent-browser close --all\` would close browser sessions other agents are using (${list(census.others)}). Close only your own: \`agent-browser --session <name> close\`.`,
    };
  }
  const dynamic = calls.find((call) => call.effect === "launch" && call.session.includes("$"));
  if (dynamic !== undefined) {
    return {
      reason: "dynamic",
      deny: `Browser session \`${dynamic.session}\` is named by a shell expansion, so each run can start another browser. Name one session for this agent literally and navigate it from item to item.`,
    };
  }
  const launching = new Set(
    calls
      .filter((call) => call.effect === "launch" && !census.live.has(call.session))
      .map((call) => call.session),
  );
  const mine = new Set(census.mine);
  const pending = new Set(census.pending);
  for (const session of launching) {
    if (pending.has(session)) continue;
    const held = [...mine].filter((owned) => owned !== session);
    if (held.length > 0) {
      return {
        reason: "owned",
        deny: `You already have browser session ${list(held)} open. Reuse it for this item with \`--session ${held[0]}\` (navigate it to the next page), or run \`agent-browser --session ${held[0]} close\` before starting \`${session}\`. Keep one browser session per agent.`,
      };
    }
    const running = new Set([...census.live, ...pending]);
    if (running.size >= MAX_DAEMONS) {
      return {
        reason: "cap",
        deny: `${running.size} browser sessions are already running on this machine (${list(running)}), the limit is ${MAX_DAEMONS}. Reuse one you own, close one you are done with, or finish this item without a browser and retry once another agent finishes.`,
      };
    }
    mine.add(session);
    pending.add(session);
  }
  return {};
}
