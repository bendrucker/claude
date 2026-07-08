#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SyncHookJSONOutput, UserPromptSubmitHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { expandTilde, type RateLimits } from "../../scripts/rate-limits";

// Highest announced band per window, keyed to the block it applies to. A changed
// resets_at means the block rolled over, so the band no longer applies.
export interface Marker {
  fiveHourBand: number;
  fiveHourResetsAt: number;
  sevenDayBand: number;
  sevenDayResetsAt: number;
}

// A band pairs its threshold with the message emitted on crossing, so a threshold
// can never exist without a message (no silent empty injection). Adding one is a
// single entry.
interface Band {
  threshold: number;
  message: (resetsAt: number, nowMs: number) => string;
}

// Auto-scheduling a wake-up caps out around an hour. Past this horizon the model
// defers to the user instead of scheduling.
const WAKEUP_HORIZON_MS = 55 * 60 * 1000;

export const FIVE_HOUR_BANDS: Band[] = [
  {
    threshold: 90,
    message: (resetsAt) =>
      `You are at 90% of the current 5-hour usage block (resets ${formatResetTime(resetsAt)}). Favor efficient work and avoid starting large non-essential tasks.`,
  },
  {
    threshold: 95,
    message: (resetsAt) =>
      `You are at 95% of the current 5-hour usage block (resets ${formatResetTime(resetsAt)}). Prefer finishing in-flight work over starting anything new, and batch tool calls.`,
  },
  {
    threshold: 100,
    message: (resetsAt, nowMs) => {
      const reset = formatResetTime(resetsAt);
      const withinHorizon = resetsAt * 1000 - nowMs <= WAKEUP_HORIZON_MS;
      const resume = withinHorizon
        ? `then schedule a wake-up for just after ${reset} (no need to ask) so work resumes on a fresh block, and stop`
        : `then tell the user to return at ${reset} to resume on a fresh block, and stop`;
      return `The 5-hour usage block is exhausted (resets ${reset}). Every further request now spends overage credits. Finish only in-flight work, ${resume}. Start no new work.`;
    },
  },
];

export const SEVEN_DAY_BANDS: Band[] = [
  {
    threshold: 95,
    message: (resetsAt) =>
      `You are at 95% of the 7-day usage limit. A 5-hour wait will not restore this. Minimize spend until the weekly reset (${formatResetTime(resetsAt)}).`,
  },
];

// Highest band whose threshold the percentage has crossed, or null when below all.
export function crossedBand(pct: number, bands: Band[]): Band | null {
  let crossed: Band | null = null;
  for (const band of bands) {
    if (pct >= band.threshold) crossed = band;
  }
  return crossed;
}

export function formatResetTime(resetsAt: number): string {
  return new Date(resetsAt * 1000).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function evaluate(
  rl: RateLimits,
  prev: Marker | null,
  nowMs: number,
): { marker: Marker; messages: string[] } | null {
  const fivePct = rl.five_hour?.used_percentage;
  if (typeof fivePct !== "number") return null;

  const fiveResetsAt = rl.five_hour?.resets_at ?? 0;
  const sevenResetsAt = rl.seven_day?.resets_at ?? 0;

  const priorFiveBand = prev && prev.fiveHourResetsAt === fiveResetsAt ? prev.fiveHourBand : 0;
  const priorSevenBand = prev && prev.sevenDayResetsAt === sevenResetsAt ? prev.sevenDayBand : 0;

  const messages: string[] = [];

  let fiveBand = priorFiveBand;
  const crossedFive = crossedBand(fivePct, FIVE_HOUR_BANDS);
  if (crossedFive && crossedFive.threshold > priorFiveBand) {
    messages.push(crossedFive.message(fiveResetsAt, nowMs));
    fiveBand = crossedFive.threshold;
  }

  let sevenBand = priorSevenBand;
  const sevenPct = rl.seven_day?.used_percentage;
  if (typeof sevenPct === "number") {
    const crossedSeven = crossedBand(sevenPct, SEVEN_DAY_BANDS);
    if (crossedSeven && crossedSeven.threshold > priorSevenBand) {
      messages.push(crossedSeven.message(sevenResetsAt, nowMs));
      sevenBand = crossedSeven.threshold;
    }
  }

  return {
    marker: {
      fiveHourBand: fiveBand,
      fiveHourResetsAt: fiveResetsAt,
      sevenDayBand: sevenBand,
      sevenDayResetsAt: sevenResetsAt,
    },
    messages,
  };
}

function rateLimitsPath(): string {
  return expandTilde(
    process.env.CLAUDE_STATUSLINE_RATE_LIMITS_PATH ?? "~/.vibe-island/cache/rl.json",
  );
}

function markerPath(sessionId: string): string {
  const root = process.env.CLAUDE_SESSION_LIMIT_MARKER_ROOT ?? "/tmp/claude";
  return join(root, sessionId, "session-limit.json");
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Bun.file(path).text()) as T;
  } catch {
    return null;
  }
}

function markerChanged(prev: Marker | null, next: Marker): boolean {
  return (
    !prev ||
    prev.fiveHourBand !== next.fiveHourBand ||
    prev.fiveHourResetsAt !== next.fiveHourResetsAt ||
    prev.sevenDayBand !== next.sevenDayBand ||
    prev.sevenDayResetsAt !== next.sevenDayResetsAt
  );
}

export async function processInput(
  input: UserPromptSubmitHookInput,
  nowMs: number,
): Promise<SyncHookJSONOutput | null> {
  const sessionId = input.session_id;
  if (!sessionId) return null;

  const rl = await readJson<RateLimits>(rateLimitsPath());
  if (!rl) return null;

  const path = markerPath(sessionId);
  const prev = await readJson<Marker>(path);
  const result = evaluate(rl, prev, nowMs);
  if (!result) return null;

  // Below thresholds and within the same block the marker is unchanged, so skip
  // the write. This keeps the hook near-zero cost on the common per-prompt path.
  if (markerChanged(prev, result.marker)) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      await Bun.write(path, `${JSON.stringify(result.marker)}\n`);
    } catch {
      return null;
    }
  }

  if (result.messages.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: result.messages.join("\n\n"),
    },
  };
}

async function main(): Promise<void> {
  let input: UserPromptSubmitHookInput;
  try {
    input = await readStdinJson<UserPromptSubmitHookInput>();
  } catch (error) {
    console.error(
      `[session-limit] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input, Date.now());
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
