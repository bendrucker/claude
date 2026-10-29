#!/usr/bin/env bun

import { cli } from "cleye";
import { table } from "table";
import { emittedOf, RunLogEntry, type RunOutcome, resolveLogPath } from "../../../hooks/run-log";

export interface Acceptance {
  /** Shown alerts followed by a whole-file re-lint of the same file. */
  revisited: number;
  /** Revisited alerts the re-lint no longer raised. */
  accepted: number;
  /** Shown alerts no whole-file re-lint reached, leaving nothing that decides them. */
  unconfirmed: number;
}

export interface CheckHealth extends Acceptance {
  check: string;
  fired: number;
}

export interface HookHealth {
  total: number;
  byOutcome: Record<RunOutcome, number>;
  checks: CheckHealth[];
  latency: { p50: number; p95: number; silentP95: number };
}

export function parseLog(text: string): RunLogEntry[] {
  const entries: RunLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = RunLogEntry.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // A torn write from a concurrent session produces a partial line.
    }
  }
  return entries;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

// A PostToolUse run lints the saved file, so its `checks` speak to the file an
// alert named. Before that move, only a Write linted the whole file.
function isWholeFile(entry: RunLogEntry): boolean {
  return entry.event === "PostToolUse" || (entry.event === undefined && entry.tool === "Write");
}

// Pairing each shown alert with the next whole-file re-lint of the same file
// tells whether it was acted on: a check missing from the re-lint's `checks`
// was fixed, one still present was written past.
function tally(
  counts: Map<string, Acceptance>,
  check: string,
  rescanned: string[] | undefined,
): void {
  const bucket = counts.get(check) ?? { revisited: 0, accepted: 0, unconfirmed: 0 };
  if (rescanned == null) {
    bucket.unconfirmed += 1;
  } else {
    bucket.revisited += 1;
    if (!rescanned.includes(check)) bucket.accepted += 1;
  }
  counts.set(check, bucket);
}

export function acceptance(entries: RunLogEntry[]): Map<string, Acceptance> {
  const byTarget = new Map<string, RunLogEntry[]>();
  for (const entry of entries) {
    if (entry.target == null || entry.target === "") continue;
    const key = `${entry.session_id}\u0000${entry.target}`;
    const group = byTarget.get(key) ?? [];
    group.push(entry);
    byTarget.set(key, group);
  }

  const counts = new Map<string, Acceptance>();
  for (const group of byTarget.values()) {
    const ordered = group.toSorted((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    for (const [index, entry] of ordered.entries()) {
      const shown = emittedOf(entry);
      if (shown.length === 0) continue;
      const rescan = ordered
        .slice(index + 1)
        .find((next) => next.checks != null && isWholeFile(next));
      for (const check of shown) tally(counts, check, rescan?.checks);
    }
  }
  return counts;
}

export function summarize(entries: RunLogEntry[]): HookHealth {
  const byOutcome: Record<RunOutcome, number> = {
    silent: 0,
    context: 0,
    ask: 0,
    deny: 0,
    "skipped-scratch": 0,
    error: 0,
  };
  const fired = new Map<string, number>();
  const durations: number[] = [];
  const silentDurations: number[] = [];

  for (const entry of entries) {
    byOutcome[entry.outcome] += 1;
    durations.push(entry.duration_ms);
    if (entry.outcome === "silent" && !entry.suppressed) silentDurations.push(entry.duration_ms);
    for (const check of emittedOf(entry)) fired.set(check, (fired.get(check) ?? 0) + 1);
  }

  durations.sort((a, b) => a - b);
  silentDurations.sort((a, b) => a - b);

  const accepts = acceptance(entries);
  const checks = [...fired.entries()]
    .map(([check, count]) => ({
      check,
      fired: count,
      revisited: accepts.get(check)?.revisited ?? 0,
      accepted: accepts.get(check)?.accepted ?? 0,
      unconfirmed: accepts.get(check)?.unconfirmed ?? 0,
    }))
    .toSorted((a, b) => b.fired - a.fired);

  return {
    total: entries.length,
    byOutcome,
    checks,
    latency: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      silentP95: percentile(silentDurations, 95),
    },
  };
}

function actedOn(cat: CheckHealth): string {
  if (cat.revisited === 0) return "n/a";
  return `${cat.accepted}/${cat.revisited} ${Math.round((cat.accepted / cat.revisited) * 100)}%`;
}

export function renderReport(health: HookHealth): string {
  const outcomes = Object.entries(health.byOutcome)
    .filter(([, count]) => count > 0)
    .map(([outcome, count]) => `${outcome}=${count}`)
    .join(" ");
  const { p50, p95, silentP95 } = health.latency;
  const summary = table([
    ["runs", String(health.total)],
    ["outcomes", outcomes],
    ["latency (ms)", `p50=${p50} p95=${p95} silent-p95=${silentP95}`],
  ]);
  if (health.checks.length === 0) return summary;
  const checks = table([
    ["check", "fired", "acted on", "unconfirmed"],
    ...health.checks.map((cat) => [
      cat.check,
      String(cat.fired),
      actedOn(cat),
      String(cat.unconfirmed),
    ]),
  ]);
  return `${summary}\n${checks}`;
}

export async function readLog(path: string, since?: string): Promise<RunLogEntry[]> {
  // The rotated log precedes the live one.
  const texts = await Promise.all(
    [`${path}.1`, path].map(async (candidate) => {
      const file = Bun.file(candidate);
      return (await file.exists()) ? file.text() : "";
    }),
  );
  const entries = parseLog(texts.join("\n"));
  const cutoff = since == null ? Number.NaN : Date.parse(since);
  return Number.isNaN(cutoff) ? entries : entries.filter((entry) => Date.parse(entry.ts) >= cutoff);
}

if (import.meta.main) {
  const argv = cli({
    name: "hook-health",
    help: {
      description:
        "Read the writing-hooks run log and report outcomes, latency, and how often each check's alerts were acted on.",
    },
    flags: {
      log: {
        type: String,
        description: "Log path (default: WRITING_HOOKS_LOG or ~/.claude/writing-hooks/log.jsonl)",
      },
      since: {
        type: String,
        description: "Only count entries at or after this date (ISO)",
      },
      json: {
        type: Boolean,
        description: "Emit the summary as JSON instead of tables",
      },
    },
  });

  const path = argv.flags.log ?? resolveLogPath();
  if (path == null || path === "") {
    console.error("Logging is disabled (WRITING_HOOKS_LOG). Pass --log <path>.");
    process.exit(1);
  }

  const entries = await readLog(path, argv.flags.since);
  if (entries.length === 0) {
    console.error(`No log entries at ${path}. The hook writes one line per run.`);
    process.exit(1);
  }

  const health = summarize(entries);
  console.log(argv.flags.json ? JSON.stringify(health, null, 2) : renderReport(health));
}
