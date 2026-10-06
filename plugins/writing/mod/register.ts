import type { EngineInterface, On } from "claude-code";
import {
  type Meter,
  type Score,
  createMeter,
  parseReport,
  record,
  replyText,
  startTurn,
} from "./meter.ts";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

const MOD = "writing";
const SCAN = "skills/scan/scripts/scan.ts";
const TIMEOUT_MS = 8_000;

async function scan($: EngineInterface, text: string): Promise<Score | string> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ["bun", `${$.plugin.root}/${SCAN}`, "score", "--json", "--no-comments"],
      { stdin: text, timeoutMs: TIMEOUT_MS },
    );
    if (exitCode !== 0) return `scan exited ${exitCode}: ${stderr.trim().slice(0, 200)}`;
    return parseReport(stdout) ?? "scan printed no report";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function measure($: EngineInterface, meter: Meter, uuid: string, text: string) {
  const generation = meter.generation;
  let result: Score | string;
  let ms: number | undefined;
  try {
    const started = await $.clock.now();
    result = await scan($, text);
    ms = (await $.clock.now()) - started;
  } catch (error) {
    result = error instanceof Error ? error.message : String(error);
  }
  const { event, status } = record(meter, generation, uuid, result);
  const input: ModEventsInput = { mod: MOD, ...event };
  if (ms !== undefined) input.ms = ms;
  void $.modEvents.emit(input);
  if (status !== null) $.ui.status(status);
}

/**
 * Scores each main-loop reply's prose with the writing scan engine and shows the turn's
 * trope density in the status line. Display only: nothing reaches the model.
 */
export function register(on: On): void {
  const meter = createMeter();

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return started;
  });

  on("turn.start", ($, e, next) => {
    startTurn(meter);
    return next(e);
  });

  on("session.append", { door: "response" }, async ($, e, next) => {
    const stored = await next(e);
    if (e.agentId !== undefined || meter.unavailable) return stored;
    const text = replyText(e.message.content);
    // Detached so a scan never holds up the rows after this one.
    if (text !== "") void measure($, meter, e.uuid, text);
    return stored;
  }).catch(($, e, next) => next(e));
}
