#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SyncHookJSONOutput, UserPromptSubmitHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

interface RateLimitWindow {
  used_percentage?: number;
  resets_at?: number;
}

interface RateLimits {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
}

// Highest announced band per window, keyed to the block it applies to. A changed
// resets_at means the block rolled over, so the band no longer applies.
export interface Marker {
  fiveHourBand: number;
  fiveHourResetsAt: number;
  sevenDayBand: number;
  sevenDayResetsAt: number;
}

export const FIVE_HOUR_THRESHOLDS = [90, 95, 100];
export const SEVEN_DAY_THRESHOLDS = [95];

// Auto-scheduling a wake-up caps out around an hour. Past this horizon the model
// defers to the user instead of scheduling.
const WAKEUP_HORIZON_MS = 55 * 60 * 1000;

// Highest crossed threshold, or 0 when the percentage is below all of them.
export function band(pct: number, thresholds: readonly number[]): number {
  let crossed = 0;
  for (const threshold of thresholds) {
    if (pct >= threshold) crossed = threshold;
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

function fiveHourMessage(bandValue: number, resetsAt: number, nowMs: number): string {
  const reset = formatResetTime(resetsAt);
  switch (bandValue) {
    case 90:
      return `You are at 90% of the current 5-hour usage block (resets ${reset}). Favor efficient work and avoid starting large non-essential tasks.`;
    case 95:
      return `You are at 95% of the current 5-hour usage block (resets ${reset}). Prefer finishing in-flight work over starting anything new, and batch tool calls.`;
    case 100: {
      const withinHorizon = resetsAt * 1000 - nowMs <= WAKEUP_HORIZON_MS;
      const resume = withinHorizon
        ? `then schedule a wake-up for just after ${reset} (no need to ask) so work resumes on a fresh block, and stop`
        : `then tell the user to return at ${reset} to resume on a fresh block, and stop`;
      return `The 5-hour usage block is exhausted (resets ${reset}). Every further request now spends overage credits. Finish only in-flight work, ${resume}. Start no new work.`;
    }
    default:
      return "";
  }
}

function sevenDayMessage(resetsAt: number): string {
  return `You are at 95% of the 7-day usage limit. A 5-hour wait will not restore this. Minimize spend until the weekly reset (${formatResetTime(resetsAt)}).`;
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
  const currentFive = band(fivePct, FIVE_HOUR_THRESHOLDS);
  if (currentFive > priorFiveBand) {
    messages.push(fiveHourMessage(currentFive, fiveResetsAt, nowMs));
    fiveBand = currentFive;
  }

  let sevenBand = priorSevenBand;
  const sevenPct = rl.seven_day?.used_percentage;
  if (typeof sevenPct === "number") {
    const currentSeven = band(sevenPct, SEVEN_DAY_THRESHOLDS);
    if (currentSeven > priorSevenBand) {
      messages.push(sevenDayMessage(sevenResetsAt));
      sevenBand = currentSeven;
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
  const target = process.env.CLAUDE_STATUSLINE_RATE_LIMITS_PATH ?? "~/.vibe-island/cache/rl.json";
  return target.startsWith("~/") ? join(homedir(), target.slice(2)) : target;
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

export async function processInput(
  input: UserPromptSubmitHookInput,
  nowMs: number,
): Promise<SyncHookJSONOutput | null> {
  const sessionId = input.session_id;
  if (!sessionId) return null;

  const rl = await readJson<RateLimits>(rateLimitsPath());
  if (!rl) return null;

  const path = markerPath(sessionId);
  const result = evaluate(rl, await readJson<Marker>(path), nowMs);
  if (!result) return null;

  try {
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, `${JSON.stringify(result.marker)}\n`);
  } catch {
    return null;
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
