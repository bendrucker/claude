import { type RateLimits, readHistory, readRateLimits } from "./history";
import { markerPath, writeMarker } from "./marker";
import { evaluate, formatResetTime, type Projection, project } from "./predict";

export interface StatusResult {
  lines: string[];
  stamped: boolean;
}

function windowLine(label: string, pct: number, resetsAt: number): string {
  const reset = resetsAt ? ` (resets ${formatResetTime(resetsAt)})` : "";
  return `${label}: ${pct}%${reset}`;
}

function projectionLine(proj: Projection, resetSeconds: number): string {
  const perHour = proj.slopePerMs * 60 * 60 * 1000;
  const etaLabel = formatResetTime(Math.round(proj.etaMs / 1000));
  const deltaMin = Math.round((resetSeconds * 1000 - proj.etaMs) / 60000);
  const relation = deltaMin >= 0 ? `${deltaMin} min before reset` : `${-deltaMin} min after reset`;
  return `  burn +${perHour.toFixed(0)}%/hr → exhaust ~${etaLabel}, ${relation}`;
}

export function renderStatus(rl: RateLimits, proj: Projection | null): string[] {
  const lines: string[] = [];

  const fivePct = rl.five_hour?.used_percentage;
  const fiveReset = rl.five_hour?.resets_at ?? 0;
  if (typeof fivePct === "number") {
    lines.push(windowLine("5-hour", fivePct, fiveReset));
    if (proj) {
      lines.push(projectionLine(proj, fiveReset));
    } else if (fivePct < 100) {
      lines.push("  burn: not enough recent history to project yet");
    }
  }

  const sevenPct = rl.seven_day?.used_percentage;
  if (typeof sevenPct === "number") {
    lines.push(windowLine("7-day", sevenPct, rl.seven_day?.resets_at ?? 0));
  }

  return lines;
}

// Reads the mirror and history, renders the current windows and the burn-rate
// projection, and (given a session) stamps the marker to the state the hook
// would compute. Stamping suppresses a redundant alert about a breach the query
// already showed. Returns null when no usage-limit data is available so the
// caller can point at doctor.
export async function runStatus(nowMs: number, sessionId?: string): Promise<StatusResult | null> {
  const rl = await readRateLimits();
  if (!rl || typeof rl.five_hour?.used_percentage !== "number") return null;

  const history = await readHistory();
  const proj = project(history, rl, nowMs);
  const lines = renderStatus(rl, proj);

  let stamped = false;
  if (sessionId) {
    const result = evaluate(history, rl, nowMs, null);
    if (result) {
      await writeMarker(markerPath(sessionId), result.marker);
      stamped = true;
    }
  }

  return { lines, stamped };
}
