#!/usr/bin/env bun
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { lint, VALE_CONFIG } from "../../skills/scan/scripts/vale";
import { wilson } from "../../../../packages/evals/stats";

export interface CheckScore {
  check: string;
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

// An inherited GIT_DIR or GIT_INDEX_FILE, as a pre-commit hook sets, would override `cwd` and read another repo.
const repoEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

function git(repo: string, args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], {
    cwd: repo,
    env: repoEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
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
 * A config that lints with `rules` alone, under the scopes and ignores of
 * `base`. Each rule keeps its file name as its check name in the `Prompting`
 * style, so a candidate sharing a shipped name stands in for it.
 */
export async function candidateConfig(rules: readonly string[], base: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rule-precision-config-"));
  const style = join(dir, "styles", "Prompting");
  await mkdir(style, { recursive: true });
  await Promise.all(rules.map((rule) => Bun.write(join(style, basename(rule)), Bun.file(rule))));
  const ini = (await Bun.file(base).text()).replace(
    /^StylesPath\s*=.*$/m,
    `StylesPath = ${join(dir, "styles")}`,
  );
  const config = join(dir, ".vale.ini");
  await Bun.write(config, ini);
  return config;
}

interface Document {
  before: string;
  removed: Set<number>;
}

function documents(repo: string, commits: string[], labels: Labels): Document[] {
  const docs: Document[] = [];
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
      for (const [index, text] of before.split("\n").entries()) {
        if (!/\w/.test(text)) continue;
        labels.prose++;
        if (removed.has(index + 1)) labels.deleted++;
      }
      docs.push({ before, removed });
    }
  }
  return docs;
}

export async function measure(
  repo: string,
  commits: string[],
  config: string = VALE_CONFIG,
): Promise<{ scores: CheckScore[]; labels: Labels }> {
  const flagged = new Map<string, number>();
  const confirmed = new Map<string, number>();
  const labels: Labels = { deleted: 0, prose: 0, docs: 0 };
  const docs = documents(repo, commits, labels);

  // Vale lints files, so each pre-image is written out and the set linted in one run.
  const dir = await mkdtemp(join(tmpdir(), "rule-precision-docs-"));
  try {
    const paths = docs.map((_, index) => join(dir, `${index}.md`));
    await Promise.all(docs.map((doc, index) => Bun.write(paths[index] ?? "", doc.before)));
    const alerts = await lint(paths, config);
    for (const [index, doc] of docs.entries()) {
      for (const alert of alerts.get(paths[index] ?? "") ?? []) {
        flagged.set(alert.Check, (flagged.get(alert.Check) ?? 0) + 1);
        if (doc.removed.has(alert.Line)) {
          confirmed.set(alert.Check, (confirmed.get(alert.Check) ?? 0) + 1);
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const scores = [...flagged.entries()]
    .map(([check, total]) => {
      const hits = confirmed.get(check) ?? 0;
      const [low, high] = wilson(hits, total);
      return { check, flagged: total, confirmed: hits, precision: hits / total, low, high };
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
export function verdict(entry: CheckScore, floor: number, minFlagged: number): string {
  if (entry.flagged < minFlagged) return "too few to judge";
  return entry.low >= floor ? "clears" : "unproven";
}

export function render(
  scores: CheckScore[],
  labels: Labels,
  floor: number,
  minFlagged: number,
): string {
  const rows = scores.map((entry) => [
    entry.check,
    String(entry.flagged),
    String(entry.confirmed),
    percent(entry.precision),
    `${percent(entry.low)} - ${percent(entry.high)}`,
    verdict(entry, floor, minFlagged),
  ]);
  const header = ["Check", "Flagged", "Cut by hand", "Precision", "95% interval", "Verdict"];
  const preamble = [
    `ground truth: ${labels.deleted} of ${labels.prose} prose lines removed across ${labels.docs} documents`,
    `a check clears when its interval's lower bound reaches ${percent(floor)} on ${minFlagged}+ hits`,
    "precision here is a lower bound: the human cut what they were looking for, not every defect",
  ].join("\n");
  return `${preamble}\n${table([header, ...rows])}`;
}

if (import.meta.main) {
  const argv = cli({
    name: "rule-precision",
    help: {
      description:
        "Score Vale checks by per-line precision against commits where a human deleted prose. A check clears when its interval beats the rate at which those commits deleted prose at all. Exits non-zero when a check with enough hits fails to clear.",
    },
    flags: {
      commit: {
        type: [String],
        description: "Commit whose deletions label the ground truth (repeatable, required)",
      },
      rule: {
        type: [String],
        description: "Vale rule file to score instead of the shipped style (repeatable)",
      },
      config: {
        type: String,
        default: VALE_CONFIG,
        description: "Vale config to lint with, such as an overlay of the shipped one",
      },
      repo: { type: String, default: ".", description: "Repository to read history from" },
      minPrecision: {
        type: Number,
        description: "Precision floor, overriding the measured base rate",
      },
      minFlagged: {
        type: Number,
        default: 10,
        description: "Hits a check needs before the labeled history can judge it",
      },
    },
  });

  if (argv.flags.commit.length === 0) {
    console.error("--commit is required. Name a commit where a human deleted prose.");
    process.exit(2);
  }

  const config =
    argv.flags.rule.length > 0
      ? await candidateConfig(argv.flags.rule, argv.flags.config)
      : argv.flags.config;
  const { scores, labels } = await measure(argv.flags.repo, argv.flags.commit, config);
  if (config !== argv.flags.config) await rm(dirname(config), { recursive: true, force: true });

  if (scores.length === 0) {
    console.error("No check matched anything in the labeled history. Nothing was measured.");
    process.exit(1);
  }

  const floor = argv.flags.minPrecision ?? baseRate(labels);
  console.log(render(scores, labels, floor, argv.flags.minFlagged));
  const judged = scores.filter((entry) => entry.flagged >= argv.flags.minFlagged);
  process.exit(judged.some((entry) => entry.low < floor) ? 1 : 0);
}
