#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: --ssh pulls a read-only remote plan corpus over ssh (Secretive agent needs the sandbox off)
/**
 * Baseline scanner for the "Alternatives" plan convention. Reads a
 * directory of plan markdown and, per plan, classifies declined-alternative
 * signal as quarantined (inside a dedicated `Alternatives` section) or
 * leaked (anywhere else in the body). Prints an aggregate leak rate: the
 * share of plans that carry roads-not-taken inline instead of under a
 * named section.
 *
 * This is a coarse STRUCTURAL PROXY. It matches phrasing, never meaning. The
 * rejection signals (`rejected`, `instead of`, ...) also fire on incidental
 * contrastive phrasing ("instead of hardcoded SQL"), so the raw line counts
 * overstate genuine alternatives. The value here is a re-runnable trend
 * line over the real corpus, not an exact count. The seeded A/B in
 * `../evals/` carries the real verdict on whether the guidance changes
 * behavior.
 *
 * Local only. Plan content never leaves the machine: corpus artifacts go to
 * tmp/ and only aggregate numbers are safe to share. `--ssh <host>` reads
 * the work-machine corpus over ssh, read-only.
 */
import { mkdirSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { cli } from "cleye";
import { table } from "table";

export interface PlanClassification {
  /** A dedicated `Alternatives` (or `Alternatives Considered`) heading exists. */
  hasAlternativesSection: boolean;
  /** Rejection-signal lines inside the Alternatives section. */
  quarantined: number;
  /** Rejection-signal lines elsewhere in the body. */
  leaked: number;
}

/**
 * Phrases that mark a road not taken. Coarse by design: contrastive
 * phrasing unrelated to a rejected alternative also matches.
 */
export const REJECTION_SIGNALS: RegExp[] = [
  /\brejected\b/i,
  /\bdecided\s+against\b/i,
  /\bchose\s+not\b/i,
  /\brather\s+than\b/i,
  /\binstead\s+of\b/i,
];

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const ALTERNATIVES_HEADING = /^alternatives(\s+considered)?$/i;

/**
 * Classify one plan. Walks lines tracking fenced-code state and the depth
 * of an open Alternatives section. A heading at the section's depth or
 * shallower closes it. Signal lines inside fenced code are ignored (they
 * are example text, not plan prose).
 */
export function classifyPlan(markdown: string): PlanClassification {
  let inFence = false;
  let altDepth = 0;
  let hasAlternativesSection = false;
  let quarantined = 0;
  let leaked = 0;

  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(HEADING);
    if (heading) {
      const [, hashes, rawText] = heading;
      if (hashes === undefined || rawText === undefined) continue;
      const depth = hashes.length;
      const text = rawText.trim();
      if (altDepth > 0 && depth <= altDepth) altDepth = 0;
      if (ALTERNATIVES_HEADING.test(text)) {
        hasAlternativesSection = true;
        altDepth = depth;
      }
      continue;
    }

    if (REJECTION_SIGNALS.some((signal) => signal.test(line))) {
      if (altDepth > 0) quarantined++;
      else leaked++;
    }
  }

  return { hasAlternativesSection, quarantined, leaked };
}

export interface Aggregate {
  plans: number;
  withSignal: number;
  withSection: number;
  quarantining: number;
  leaking: number;
  leakedLines: number;
  quarantinedLines: number;
  /** Share of signal-carrying plans that leak roads-not-taken inline. */
  leakRate: number;
}

export function aggregate(classifications: PlanClassification[]): Aggregate {
  let withSignal = 0;
  let withSection = 0;
  let quarantining = 0;
  let leaking = 0;
  let leakedLines = 0;
  let quarantinedLines = 0;

  for (const c of classifications) {
    if (c.hasAlternativesSection) withSection++;
    if (c.quarantined > 0) quarantining++;
    if (c.leaked > 0) leaking++;
    if (c.quarantined + c.leaked > 0) withSignal++;
    leakedLines += c.leaked;
    quarantinedLines += c.quarantined;
  }

  return {
    plans: classifications.length,
    withSignal,
    withSection,
    quarantining,
    leaking,
    leakedLines,
    quarantinedLines,
    leakRate: withSignal > 0 ? leaking / withSignal : 0,
  };
}

/** Wilson score interval for a binomial proportion (95%). */
export function wilson(successes: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + z ** 2 / n;
  const center = (p + z ** 2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z ** 2 / (4 * n ** 2))) / denom;
  return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}

export interface PlanDoc {
  name: string;
  text: string;
}

async function corpusFromDir(dir: string): Promise<PlanDoc[]> {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      text: await Bun.file(path.join(dir, name)).text(),
    })),
  );
}

const FILE_MARKER = "===ALT-SCAN-FILE===";

/**
 * Pull the remote plan corpus in a single ssh connection. Each file is
 * framed by a marker line so one stream yields every plan. Read-only.
 */
async function corpusFromSsh(host: string, dir: string): Promise<PlanDoc[]> {
  // `[ -e "$f" ] || continue` skips the literal pattern an empty dir leaves
  // unexpanded, so a corpus with no .md files yields empty output and hits the
  // clean empty-corpus guard instead of a confusing `cat: ...: No such file`.
  const remote = `for f in ${dir}/*.md; do [ -e "$f" ] || continue; echo "${FILE_MARKER}$f"; cat "$f"; done`;
  const proc = Bun.spawn(["ssh", host, remote], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exit !== 0) {
    throw new Error(`ssh ${host} failed (exit ${exit}): ${stderr.trim()}`);
  }

  const docs: PlanDoc[] = [];
  let current: PlanDoc | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith(FILE_MARKER)) {
      if (current) docs.push(current);
      current = { name: path.basename(line.slice(FILE_MARKER.length)), text: "" };
      continue;
    }
    if (current) current.text += `${line}\n`;
  }
  if (current) docs.push(current);
  return docs;
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";

async function main(): Promise<void> {
  const argv = cli({
    name: "alternatives-scan",
    flags: {
      dir: {
        type: String,
        description:
          "Directory of plan markdown (default: ~/.claude/plans, resolved on the target)",
      },
      ssh: {
        type: String,
        description: "Read the corpus from <host> over ssh (read-only) instead of --dir",
      },
      out: {
        type: String,
        description: "Output directory for the per-plan artifact",
        default: "tmp",
      },
    },
  });

  // The local default bakes in this machine's HOME, which is wrong for a
  // remote host. Over ssh, let the remote shell expand ~ against its own HOME.
  const dir =
    argv.flags.dir ??
    (argv.flags.ssh ? "~/.claude/plans" : path.join(process.env.HOME ?? "", ".claude", "plans"));

  const corpus = argv.flags.ssh
    ? await corpusFromSsh(argv.flags.ssh, dir)
    : await corpusFromDir(dir);

  if (corpus.length === 0) {
    console.error(`No .md plans found in ${argv.flags.ssh ? `${argv.flags.ssh}:${dir}` : dir}`);
    process.exit(1);
  }

  const classified = corpus.map((doc) => ({ ...doc, ...classifyPlan(doc.text) }));
  const stats = aggregate(classified);

  mkdirSync(argv.flags.out, { recursive: true });
  const artifact = path.join(argv.flags.out, "alternatives-scan.tsv");
  await Bun.write(
    artifact,
    `# name\thasSection\tquarantined\tleaked\n${classified
      .map((c) => `${c.name}\t${c.hasAlternativesSection}\t${c.quarantined}\t${c.leaked}`)
      .join("\n")}\n`,
  );

  const source = argv.flags.ssh ? `${argv.flags.ssh}:${dir}` : dir;
  const ci = wilson(stats.leaking, stats.withSignal);

  // With no signal-carrying plans the leak/quarantine shares are undefined, so
  // print a dash rather than a misleading 0.0% / 100.0% split over zero plans.
  const leakShare = stats.withSignal > 0 ? percent(stats.leakRate) : "—";
  const quarantineShare = stats.withSignal > 0 ? percent(1 - stats.leakRate) : "—";

  console.log(`${BOLD}Alternatives scan${RESET} ${DIM}(${source}, ${stats.plans} plans)${RESET}`);
  console.log(
    table([
      ["metric", "count", "share of signal-carrying"],
      ["plans with declined-alternative signal", String(stats.withSignal), "—"],
      ["leak it inline", String(stats.leaking), leakShare],
      ["quarantine it in a section", String(stats.quarantining), quarantineShare],
      ["have a dedicated Alternatives section", String(stats.withSection), "—"],
    ]),
  );
  console.log(
    `Inline leak rate: ${BOLD}${percent(stats.leakRate)}${RESET} ` +
      `(95% CI ${percent(ci.lo)}..${percent(ci.hi)}); ` +
      `${stats.leakedLines} leaked vs ${stats.quarantinedLines} quarantined signal lines.`,
  );
  console.log(
    `${DIM}Coarse structural proxy: contrastive phrasing inflates the raw line counts. ` +
      `The A/B in ../evals/ carries the real verdict.${RESET}`,
  );
  console.error(
    `${DIM}Per-plan artifact: ${artifact} (local only; never commit or paste).${RESET}`,
  );
}

if (import.meta.main) {
  await main();
}
