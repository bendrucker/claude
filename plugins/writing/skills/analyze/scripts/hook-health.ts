#!/usr/bin/env bun

import { cli } from "cleye";
import { table } from "table";
import { RunLogEntry, type RunOutcome, resolveLogPath } from "../../../hooks/run-log";

export type CategoryHealth = {
  category: string;
  fired: number;
  suppressed: number;
  share: number;
};

export type HookHealth = {
  total: number;
  spanDays: number;
  runsPerDay: number;
  byOutcome: Record<RunOutcome, number>;
  byTool: Record<string, number>;
  injections: number;
  categories: CategoryHealth[];
  latency: { p50: number; p95: number; max: number; silentP95: number };
};

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

const INJECTION_OUTCOMES = new Set<RunOutcome>(["context", "ask", "deny"]);

export function summarize(entries: RunLogEntry[]): HookHealth {
  const byOutcome: Record<RunOutcome, number> = {
    silent: 0,
    context: 0,
    ask: 0,
    deny: 0,
    "skipped-scratch": 0,
  };
  const byTool: Record<string, number> = {};
  const perCategory = new Map<string, { fired: number; suppressed: number }>();
  const durations: number[] = [];
  const silentDurations: number[] = [];
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    byOutcome[entry.outcome] += 1;
    byTool[entry.tool] = (byTool[entry.tool] ?? 0) + 1;
    durations.push(entry.duration_ms);
    if (entry.outcome === "silent" && !entry.suppressed) silentDurations.push(entry.duration_ms);

    if (entry.category != null && entry.category !== "") {
      const bucket = perCategory.get(entry.category) ?? { fired: 0, suppressed: 0 };
      if (entry.suppressed) {
        bucket.suppressed += 1;
      } else if (INJECTION_OUTCOMES.has(entry.outcome)) {
        bucket.fired += 1;
      }
      perCategory.set(entry.category, bucket);
    }

    const ts = Date.parse(entry.ts);
    if (!Number.isNaN(ts)) {
      firstTs = Math.min(firstTs, ts);
      lastTs = Math.max(lastTs, ts);
    }
  }

  const injections = entries.filter((entry) => INJECTION_OUTCOMES.has(entry.outcome)).length;
  const spanDays =
    entries.length > 0 && lastTs > firstTs ? (lastTs - firstTs) / (24 * 60 * 60 * 1000) : 0;

  durations.sort((a, b) => a - b);
  silentDurations.sort((a, b) => a - b);

  const categories = [...perCategory.entries()]
    .map(([category, counts]) => ({
      category,
      fired: counts.fired,
      suppressed: counts.suppressed,
      share: injections > 0 ? counts.fired / injections : 0,
    }))
    .toSorted((a, b) => (b.fired === a.fired ? b.suppressed - a.suppressed : b.fired - a.fired));

  return {
    total: entries.length,
    spanDays,
    runsPerDay: spanDays > 0 ? entries.length / spanDays : entries.length,
    byOutcome,
    byTool,
    injections,
    categories,
    latency: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations.at(-1) ?? 0,
      silentP95: percentile(silentDurations, 95),
    },
  };
}

const MIN_RUNS = 50;
const MIN_SPAN_DAYS = 3;
const DOMINANT_SHARE = 0.25;
const MIN_FIRES_FOR_SUPPRESSION_SIGNAL = 5;
const SILENT_P95_BUDGET_MS = 100;
const SCRATCH_SHARE_CEILING = 0.6;

// Each opportunity names a concrete fix, mirroring the curation principle:
// the log exists so audits read over/under-firing directly instead of
// inferring it from transcripts.
export function opportunities(health: HookHealth): string[] {
  const found: string[] = [];

  if (health.total < MIN_RUNS || health.spanDays < MIN_SPAN_DAYS) {
    found.push(
      `Evidence still accumulating (${health.total} runs over ${health.spanDays.toFixed(1)} days). Re-run once the log spans at least ${MIN_SPAN_DAYS} days and ${MIN_RUNS} runs.`,
    );
    return found;
  }

  for (const cat of health.categories) {
    if (cat.share >= DOMINANT_SHARE) {
      found.push(
        `"${cat.category}" is ${Math.round(cat.share * 100)}% of injections. Audit its precision: sample recent firings from session history and demote, narrow, or retire the rule if hits are unactionable.`,
      );
    }
    if (cat.fired >= MIN_FIRES_FOR_SUPPRESSION_SIGNAL && cat.suppressed >= cat.fired) {
      found.push(
        `"${cat.category}" is suppressed as often as it fires (${cat.fired} fired, ${cat.suppressed} suppressed). The reminder is not changing behavior within sessions. Consider a stronger message or retiring the rule.`,
      );
    }
  }

  if (health.byOutcome.ask > 0) {
    found.push(
      `${health.byOutcome.ask} ask outcomes recorded. Asks block background jobs and the numbering demotion expected zero. Find the emitting rule and demote it.`,
    );
  }

  if (health.latency.silentP95 > SILENT_P95_BUDGET_MS) {
    found.push(
      `Silent-run p95 latency is ${health.latency.silentP95}ms (budget ${SILENT_P95_BUDGET_MS}ms). The no-finding path runs on every file op. Profile the dispatcher's checker order and prefilters.`,
    );
  }

  const scratchShare = health.total > 0 ? health.byOutcome["skipped-scratch"] / health.total : 0;
  if (scratchShare > SCRATCH_SHARE_CEILING) {
    found.push(
      `${Math.round(scratchShare * 100)}% of runs are skipped-scratch. Verify the scratch heuristic is not swallowing durable prose (check recent Write paths in session history against isScratchPath).`,
    );
  }

  if (found.length === 0) {
    found.push(
      "No issues raised. After two consecutive stable audits, flip the WRITING_HOOKS_LOG default to off (see README Run Log).",
    );
  }

  return found;
}

function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function renderReport(health: HookHealth): string {
  const lines: string[] = [];

  lines.push(
    table([
      ["runs", String(health.total)],
      ["span (days)", health.spanDays.toFixed(1)],
      ["runs/day", health.runsPerDay.toFixed(1)],
      ["injections", String(health.injections)],
      [
        "outcomes",
        Object.entries(health.byOutcome)
          .filter(([, count]) => count > 0)
          .map(([outcome, count]) => `${outcome}=${count}`)
          .join(" "),
      ],
      [
        "tools",
        Object.entries(health.byTool)
          .map(([tool, count]) => `${tool}=${count}`)
          .join(" "),
      ],
      [
        "latency (ms)",
        `p50=${health.latency.p50} p95=${health.latency.p95} max=${health.latency.max} silent-p95=${health.latency.silentP95}`,
      ],
    ]),
  );

  if (health.categories.length > 0) {
    lines.push(
      table([
        ["category", "fired", "suppressed", "share of injections"],
        ...health.categories.map((cat) => [
          cat.category,
          String(cat.fired),
          String(cat.suppressed),
          formatShare(cat.share),
        ]),
      ]),
    );
  }

  lines.push("Opportunities:");
  for (const opportunity of opportunities(health)) {
    lines.push(`- ${opportunity}`);
  }

  return lines.join("\n");
}

async function readLog(path: string, since?: string): Promise<RunLogEntry[]> {
  const texts: string[] = [];
  for (const candidate of [`${path}.1`, path]) {
    const file = Bun.file(candidate);
    // oxlint-disable-next-line no-await-in-loop -- the rotated log and the live log concatenate in that order.
    if (await file.exists()) texts.push(await file.text());
  }
  let entries = parseLog(texts.join("\n"));
  if (since != null && since !== "") {
    const cutoff = Date.parse(since);
    if (!Number.isNaN(cutoff)) {
      entries = entries.filter((entry) => Date.parse(entry.ts) >= cutoff);
    }
  }
  return entries;
}

if (import.meta.main) {
  const argv = cli({
    name: "hook-health",
    help: {
      description:
        "Read the writing-hooks run log and report volume, latency, per-rule fire/suppress counts, and fix opportunities.",
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
    console.error(`No log entries at ${path}. The dispatcher writes one line per hook run.`);
    process.exit(1);
  }

  const health = summarize(entries);
  if (argv.flags.json) {
    console.log(JSON.stringify({ ...health, opportunities: opportunities(health) }, null, 2));
  } else {
    console.log(renderReport(health));
  }
}
