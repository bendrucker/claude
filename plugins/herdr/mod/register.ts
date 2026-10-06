import type { EngineInterface, On } from "claude-code";

const MOD = "herdr";
const SOURCE = "bendrucker:herdr";
const AGENT = "claude";

type State = "idle" | "working" | "blocked";

// A /clear or /resume ends the conversation, not the process, and no
// session.start follows it.
const CONTINUING = new Set(["clear", "resume"]);

interface Beacon {
  pane: { bin: string; id: string } | undefined;
  seq: number;
}

// herdr drops a report whose seq is not above the last one, and the spawns land
// in any order, so each report takes its seq synchronously when it is made.
function nextSeq(beacon: Beacon): string {
  beacon.seq += 1;
  return String(beacon.seq);
}

async function send($: EngineInterface, beacon: Beacon, args: string[]): Promise<void> {
  const pane = beacon.pane;
  if (pane === undefined) return;
  const seq = nextSeq(beacon);
  const command = args[0];
  const started = await $.clock.now();
  let detail: Record<string, unknown>;
  let ok = false;
  try {
    const argv = [
      pane.bin,
      "pane",
      ...args,
      "--source",
      SOURCE,
      "--agent",
      AGENT,
      "--seq",
      seq,
      pane.id,
    ];
    const { exitCode, stderr } = await $.process.run(argv);
    if (exitCode !== 0) $.ui.log(`herdr ${command} failed: ${stderr.trim()}`, { to: "debug" });
    ok = exitCode === 0;
    detail = { command, args: args.slice(1), exitCode, stderr: stderr.trim() };
  } catch (error) {
    $.ui.log(`herdr ${command} failed: ${String(error)}`, { to: "debug" });
    detail = { command, args: args.slice(1), error: String(error) };
  }
  const ms = (await $.clock.now()) - started;
  void $.modEvents.emit({ mod: MOD, event: "herdr.call", ok, ms, detail });
}

function report($: EngineInterface, beacon: Beacon, state: State): void {
  void send($, beacon, ["report-agent", "--state", state]);
}

/**
 * Reports this session's lifecycle to the herdr pane hosting it. Permission
 * dialogs are left to herdr's visible-blocker override, since no event marks
 * one closing.
 */
export function register(on: On): void {
  const beacon: Beacon = { pane: undefined, seq: 0 };

  on("session.start", async ($, e, next) => {
    const [env, id, bin, now] = await Promise.all([
      $.env.get("HERDR_ENV"),
      $.env.get("HERDR_PANE_ID"),
      $.env.get("HERDR_BIN_PATH"),
      $.clock.now(),
    ]);
    // Clock-based, so a restarted session's seqs stay above the last one's.
    beacon.seq = Math.max(beacon.seq, now * 1000);
    const isHosted = env === "1" && id !== undefined && id !== "" && e.isInteractive;
    beacon.pane = isHosted
      ? { bin: bin === undefined || bin === "" ? "herdr" : bin, id }
      : undefined;
    void $.modEvents.emit({ mod: MOD, event: "session.start", detail: { isHosted } });
    report($, beacon, "idle");
    return next(e);
  });

  on("turn.start", ($, e, next) => {
    report($, beacon, "working");
    return next(e);
  });

  on("turn.complete", ($, e, next) => {
    if (e.agentId === undefined) report($, beacon, "idle");
    return next(e);
  });

  on("tool.call", { tool: "AskUserQuestion" }, async ($, e, next) => {
    report($, beacon, "blocked");
    try {
      return await next(e);
    } finally {
      report($, beacon, "working");
    }
  }).catch(($, e, next) => next(e));

  on("session.end", async ($, e, next) => {
    if (CONTINUING.has(e.reason)) {
      report($, beacon, "idle");
      return next(e);
    }
    await send($, beacon, ["release-agent"]);
    beacon.pane = undefined;
    return next(e);
  });
}
