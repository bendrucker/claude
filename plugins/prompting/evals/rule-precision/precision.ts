#!/usr/bin/env bun
import { cli } from "cleye";
import { table } from "table";
import {
  type Finding,
  type PatternRule,
  scanPrompt,
  scanWith,
} from "../../skills/scan/scripts/rules";

export interface RuleScore {
  rule: string;
  flagged: number;
  confirmed: number;
  precision: number;
  low: number;
  high: number;
}

export interface Labels {
  /** Prose lines the commits removed, whatever the reason. */
  deleted: number;
  /** Prose lines the commits read, deleted or kept. */
  prose: number;
  docs: number;
}

/**
 * The share of prose these commits deleted. A rule that flagged lines at random
 * would land here, so it is the floor a rule has to beat to carry information.
 */
export function baseRate(labels: Labels): number {
  return labels.prose === 0 ? 0 : labels.deleted / labels.prose;
}

function git(repo: string, args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  return run.success ? run.stdout.toString() : "";
}

/**
 * Old-file line numbers a commit removed or rewrote. A rule that flags one of
 * these lines flagged something a human went on to cut.
 */
export function deletedLines(
  repo: string,
  parent: string,
  commit: string,
  file: string,
): Set<number> {
  const removed = new Set<number>();
  let line = 0;
  for (const text of git(repo, ["diff", "-U0", parent, commit, "--", file]).split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (text.startsWith("---")) continue;
    if (text.startsWith("-")) {
      removed.add(line);
      line++;
    } else if (!text.startsWith("+") && !text.startsWith("\\")) {
      line++;
    }
  }
  return removed;
}

/**
 * Wilson score interval for a proportion. A rule measured on a handful of hits
 * gets a visibly wide interval instead of a number that reads as settled.
 */
export function wilson(hits: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = hits / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const spread =
    (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}

/** A candidate rule given on the command line as `name=/pattern/flags`. */
export function parseRule(spec: string): PatternRule {
  const split = spec.indexOf("=");
  if (split < 1) throw new Error(`rule must be name=/pattern/flags, got: ${spec}`);
  const name = spec.slice(0, split);
  const body = spec.slice(split + 1);
  const parsed = /^\/(.*)\/([gimsuy]*)$/s.exec(body);
  const source = parsed?.[1] ?? "";
  if (source.length === 0) throw new Error(`rule pattern must be /pattern/flags, got: ${body}`);
  const given = parsed?.[2] ?? "";
  const flags = given.includes("g") ? given : `${given}g`;
  return {
    name,
    message: "matched a candidate pattern.",
    pattern: new RegExp(source, flags),
  };
}

function score(source: string, rules?: readonly PatternRule[]): Finding[] {
  return rules ? scanWith(source, rules) : scanPrompt(source);
}

export function measure(
  repo: string,
  commits: string[],
  rules?: readonly PatternRule[],
): { scores: RuleScore[]; labels: Labels } {
  const flagged = new Map<string, number>();
  const confirmed = new Map<string, number>();
  const labels: Labels = { deleted: 0, prose: 0, docs: 0 };

  for (const commit of commits) {
    const parent = git(repo, ["rev-parse", `${commit}^`]).trim();
    if (parent.length === 0) continue;
    const touched = git(repo, ["diff", "--name-only", parent, commit])
      .trim()
      .split("\n")
      .filter((file) => file.endsWith(".md"));

    for (const file of touched) {
      const before = git(repo, ["show", `${parent}:${file}`]);
      if (before.length === 0) continue;
      labels.docs++;
      const removed = deletedLines(repo, parent, commit, file);
      const lines = before.split("\n");
      for (const [index, text] of lines.entries()) {
        if (!/\w/.test(text)) continue;
        labels.prose++;
        if (removed.has(index + 1)) labels.deleted++;
      }
      for (const finding of score(before, rules)) {
        flagged.set(finding.rule, (flagged.get(finding.rule) ?? 0) + 1);
        if (removed.has(finding.line)) {
          confirmed.set(finding.rule, (confirmed.get(finding.rule) ?? 0) + 1);
        }
      }
    }
  }

  const scores = [...flagged.entries()]
    .map(([rule, total]) => {
      const hits = confirmed.get(rule) ?? 0;
      const [low, high] = wilson(hits, total);
      return { rule, flagged: total, confirmed: hits, precision: hits / total, low, high };
    })
    .toSorted((a, b) => b.precision - a.precision);
  return { scores, labels };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/**
 * A rule the labeled history barely exercises cannot be judged by it. Saying so
 * keeps a commit that was not looking for this defect class from reading as
 * evidence against the rule.
 */
export function verdict(entry: RuleScore, floor: number, minFlagged: number): string {
  if (entry.flagged < minFlagged) return "too few to judge";
  return entry.low >= floor ? "clears" : "unproven";
}

export function render(
  scores: RuleScore[],
  labels: Labels,
  floor: number,
  minFlagged: number,
): string {
  const rows = scores.map((entry) => [
    entry.rule,
    String(entry.flagged),
    String(entry.confirmed),
    percent(entry.precision),
    `${percent(entry.low)} - ${percent(entry.high)}`,
    verdict(entry, floor, minFlagged),
  ]);
  const header = ["Rule", "Flagged", "Cut by hand", "Precision", "95% interval", "Verdict"];
  const preamble = [
    `ground truth: ${labels.deleted} of ${labels.prose} prose lines removed across ${labels.docs} documents`,
    `a rule clears when its interval's lower bound reaches ${percent(floor)} on ${minFlagged}+ hits`,
    "precision here is a lower bound: the human cut what they were looking for, not every defect",
  ].join("\n");
  return `${preamble}\n${table([header, ...rows])}`;
}

if (import.meta.main) {
  const argv = cli({
    name: "rule-precision",
    help: {
      description:
        "Score scan rules by per-line precision against commits where a human deleted prose. A rule clears when its interval beats the rate at which those commits deleted prose at all. Exits non-zero when a rule with enough hits fails to clear.",
    },
    flags: {
      commit: {
        type: [String],
        description: "Commit whose deletions label the ground truth (repeatable, required)",
      },
      rule: {
        type: [String],
        description: "Candidate to score instead of the shipped set, as name=/pattern/flags",
      },
      repo: { type: String, default: ".", description: "Repository to read history from" },
      minPrecision: {
        type: Number,
        description: "Precision floor, overriding the measured base rate",
      },
      minFlagged: {
        type: Number,
        default: 10,
        description: "Hits a rule needs before the labeled history can judge it",
      },
    },
  });

  if (argv.flags.commit.length === 0) {
    console.error("--commit is required. Name a commit where a human deleted prose.");
    process.exit(2);
  }

  const candidates = argv.flags.rule.map(parseRule);
  const { scores, labels } = measure(
    argv.flags.repo,
    argv.flags.commit,
    candidates.length > 0 ? candidates : undefined,
  );

  if (scores.length === 0) {
    console.error("No rule matched anything in the labeled history. Nothing was measured.");
    process.exit(1);
  }

  const floor = argv.flags.minPrecision ?? baseRate(labels);
  console.log(render(scores, labels, floor, argv.flags.minFlagged));
  const judged = scores.filter((entry) => entry.flagged >= argv.flags.minFlagged);
  process.exit(judged.some((entry) => entry.low < floor) ? 1 : 0);
}
