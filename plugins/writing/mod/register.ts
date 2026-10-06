import type { EngineInterface, On } from "claude-code";
import {
  type Meter,
  type MeterEvent,
  type Score,
  createMeter,
  parseReport,
  record,
  replyText,
  startTurn,
} from "./meter.ts";

const SCAN = "skills/scan/scripts/scan.ts";
const TIMEOUT_MS = 8_000;

// Placeholder until the mods-observability event writer lands.
function emit($: EngineInterface, event: MeterEvent): void {
  $.ui.log(JSON.stringify(event), { to: "debug" });
}

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
  const { event, status } = record(meter, generation, uuid, await scan($, text));
  emit($, event);
  if (status !== null) $.ui.status(status);
}

/**
 * Scores each main-loop reply's prose with the writing scan engine and shows the turn's
 * trope density in the status line. Display only: nothing reaches the model.
 */
export function register(on: On): void {
  const meter = createMeter();

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
  });
}
