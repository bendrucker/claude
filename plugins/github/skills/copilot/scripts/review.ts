#!/usr/bin/env bun

import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { getBorderCharacters, table } from "table";
import { z } from "zod";

const DEFAULT_MODEL = "gpt-5.6-terra";
const CHEAP_MODEL = "gpt-5.6-luna";
const MAX_ANGLES = 3;

/**
 * Persistent so every run's spend lands in one ledger this path can be audited from, and so
 * `--resume` reaches a warm session instead of paying the cold start again. A home discarded
 * after each run takes its usage rows with it, leaving the API meter as the only record.
 */
const COPILOT_HOME = join(homedir(), ".cache", "claude", "copilot-home");

// Copilot's own per-session cap, which it will not accept below 30. It is soft: a session
// stops only once it observes usage at the cap, so a run can overshoot by one response.
const ONE_SHOT_CAP = 30;
const AGENTIC_CAP = 60;

// Bound on that overshoot. The largest single call across the ledger is 22.65 credits.
const OVERSHOOT = 25;

// The band table's widest column, held fixed so --status reads the same in a terminal and
// in a transcript.
const CRITERIA_WIDTH = 62;

// Below this, no shape is worth a terra call. Degrade rather than refuse.
const DEGRADE_BELOW = 150;

// The plan grants 1500/month and resets on the 1st, so this is the nominal daily allowance that `pace` is judged against.
const NOMINAL_DAILY = 1500 / 31;

// Copilot takes the prompt as an argv value, so the cap has to stay clear of ARG_MAX
// as well as of the plan's credit budget. The budget is the tighter of the two.
const DEFAULT_MAX_BYTES = 120_000;

// --force lifts the budget guard, not the operating-system one. Past this the spawn fails
// with E2BIG and no review runs at all, so refuse with an explanation instead.
const ABSOLUTE_MAX_BYTES = 400_000;

const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export interface Diff {
  base: string;
  patch: string;
  files: string[];
}

export interface Angle {
  id: string;
  title: string;
  focus: string;
}

interface Result {
  angle: Angle;
  exitCode: number;
  output: string;
  credits: number | null;
}

export type Tier = "constrained" | "normal" | "abundant";

export interface Meter {
  used: number;
  remaining: number;
  entitlement: number;
  resetDate: string;
  days: number;
  pace: number;
  tier: Tier;
}

/**
 * Strictness, never a spend target. A target invites manufacturing reviews to hit it. This
 * only moves the bar that arriving changes must clear. It self-corrects in both directions:
 * a burst drains `remaining` and drops the next invocation into a stricter tier, and the
 * month-end tail shrinks `days`, which lifts `pace` and loosens the bar on what is left.
 */
export function resolveTier(pace: number): Tier {
  if (pace < 25) return "constrained";
  if (pace > 60) return "abundant";
  return "normal";
}

/** Whole days from now until the reset, floored at 1 so `pace` stays finite on reset day. */
export function daysUntilReset(resetDate: string, now: Date): number {
  const reset = Date.parse(`${resetDate}T00:00:00Z`);
  if (Number.isNaN(reset)) throw new Error(`Unparseable quota_reset_date: ${resetDate}`);
  return Math.max(1, Math.ceil((reset - now.getTime()) / 86_400_000));
}

const Snapshot = z.looseObject({
  entitlement: z.number(),
  credits_used: z.number().optional().catch(undefined),
  remaining: z.number().optional().catch(undefined),
});
export type Snapshot = z.infer<typeof Snapshot>;

const CopilotUser = z.looseObject({
  quota_reset_date: z.string().optional().catch(undefined),
  quota_snapshots: z.looseObject({ premium_interactions: z.unknown() }).optional().catch(undefined),
});

/**
 * Each figure derives the other, and an absent one must never fall back to a constant.
 * Defaulting a missing credits_used to 0 reads a nearly exhausted account as untouched, and
 * the guard then reserves against nothing and walks the session into billed overage.
 */
export function deriveUsage(
  snapshot: Snapshot,
  entitlement: number,
): { used: number; remaining: number } {
  if (snapshot.credits_used !== undefined) {
    const used = snapshot.credits_used;
    return { used, remaining: snapshot.remaining ?? entitlement - used };
  }
  if (snapshot.remaining !== undefined) {
    return { used: entitlement - snapshot.remaining, remaining: snapshot.remaining };
  }
  throw new Error("premium_interactions quota reports neither credits_used nor remaining.");
}

/**
 * A read that fails stops the run rather than waving it through, since the meter is the only
 * thing governing spend. That fail-closed default is also what keeps a machine without
 * personal Copilot entitlement inert: no premium_interactions quota, no run.
 */
export function readMeter(now: Date): Meter {
  const result = Bun.spawnSync(["gh", "api", "/copilot_internal/user"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh api /copilot_internal/user failed: ${result.stderr.toString().trim()}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout.toString());
  } catch {
    throw new Error("gh api /copilot_internal/user returned output that is not JSON.");
  }
  const payload = CopilotUser.parse(raw);

  const snapshot = Snapshot.safeParse(payload.quota_snapshots?.premium_interactions);
  if (!snapshot.success) {
    throw new Error("No premium_interactions quota on this account.");
  }

  const entitlement = snapshot.data.entitlement;
  const { used, remaining } = deriveUsage(snapshot.data, entitlement);
  const resetDate = payload.quota_reset_date ?? "";
  const days = daysUntilReset(resetDate, now);
  const pace = remaining / days;

  return { used, remaining, entitlement, resetDate, days, pace, tier: resolveTier(pace) };
}

/**
 * The plan permits overage (2000 more credits, billed) and this is the only thing standing
 * between a run and that bill. Reserve the whole planned session cap rather than an estimate,
 * because a session is free to spend up to its cap and the cap is soft by one response.
 *
 * The overshoot reserve scales with `sessions` because each spawn observes its own cap
 * independently. Three angles are three sessions that can each overrun by one response, so
 * reserving a single overshoot for the run would leave two of them unfunded.
 *
 * Stranding is the accepted cost: a 3-angle run refuses once `used` passes 1335, leaving at
 * most ~165 credits unspent in a month that actually reaches the wall.
 */
export function exceedsEntitlement(meter: Meter, plannedCap: number, sessions: number): boolean {
  return meter.used + plannedCap + OVERSHOOT * sessions > meter.entitlement;
}

interface Band {
  band: string;
  criteria: string;
  shape: string;
  cost: string;
}

/**
 * Reuses the ship skill's Bot Review Gate spend list, so one set of criteria decides both.
 * Costs are measured at the median PR (96 changed lines across 3 files) through p90 (381 lines).
 */
const BANDS: Band[] = [
  {
    band: "skip",
    criteria: "bot bumps, docs/prose-only, lockfiles, reverts, config off the risk surfaces",
    shape: "none",
    cost: "0",
  },
  {
    band: "deep",
    criteria:
      "runtime surface, auth/sandbox/permissions/secrets/egress, >~200 lines or 8 files excl. tests/docs/lockfiles, a bug review:code confirmed, session drift",
    shape: "terra, 1 angle",
    cost: "7.6-12.4",
  },
  {
    band: "deep+",
    criteria: "risk-surface hits, abundant only",
    shape: "terra, 3 angles",
    cost: "~22.7",
  },
  {
    band: "agentic",
    criteria: "destructive, concurrent, or auth changes, abundant only",
    shape: "capped session",
    cost: "<= 60",
  },
];

const TIER_GATES: Record<Tier, string> = {
  constrained: "terra only on risk-surface hits, luna one-shot otherwise",
  normal: "terra one-shot on gate-worthy changes, skip the rest",
  abundant:
    "terra one-shot on any substantial human change, 3 angles on the risk class, agentic available",
};

function printStatus(meter: Meter): void {
  console.error(`${CYAN}copilot budget${RESET}`);
  console.error(`  tier       ${BOLD}${meter.tier}${RESET}`);
  console.error(`  remaining  ${meter.remaining} of ${meter.entitlement} (${meter.used} used)`);
  console.error(
    `  resets     ${meter.resetDate} (${meter.days} day${meter.days === 1 ? "" : "s"})`,
  );
  console.error(
    `  pace       ${meter.pace.toFixed(1)}/day against a nominal ${NOMINAL_DAILY.toFixed(1)}`,
  );
  console.error(`${DIM}  gate       ${TIER_GATES[meter.tier]}${RESET}`);
  console.error("");

  console.error(
    table(
      [
        ["band", "shape", "cost", "criteria"],
        ...BANDS.map((entry) => [entry.band, entry.shape, entry.cost, entry.criteria]),
      ],
      {
        border: getBorderCharacters("norc"),
        // Fixed rather than read from the terminal: this output lands in a transcript as
        // often as it lands on a screen, so a predictable width beats a fitted one.
        columns: { 2: { alignment: "right" }, 3: { width: CRITERIA_WIDTH, wrapWord: true } },
      },
    ),
  );

  // The allotment does not roll over, so credits alive on the last day are credits lost.
  // A suggestion only: an automated sweep would manufacture review events to consume them.
  if (meter.days <= 3 && meter.remaining >= 150) {
    console.error("");
    console.error(
      `${YELLOW}${meter.remaining} credits expire in ${meter.days} day${meter.days === 1 ? "" : "s"}. A luna sweep of recently merged PRs via --base costs ~1-3 each, if you want them.${RESET}`,
    );
  }
}

function git(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function gitOk(args: string[], cwd: string): boolean {
  return (
    Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" }).exitCode === 0
  );
}

/** Prefer the remote tracking ref so the review sees what the PR would merge. */
function resolveBase(cwd: string): string {
  for (const ref of ["@{upstream}", "origin/main", "origin/master", "main", "master"]) {
    if (gitOk(["rev-parse", "--verify", "--quiet", ref], cwd)) return ref;
  }
  return "HEAD~1";
}

/**
 * Read NUL-delimited git output. Plain newline output is unusable here: with the default
 * core.quotePath, git escapes a name like café.ts and wraps it in quotes, and a filename
 * may legally contain a newline. Either one yields a path that does not exist on disk.
 */
export function splitPaths(output: string): string[] {
  return output.split("\0").filter((path) => path.length > 0);
}

function collectDiff(base: string, cwd: string): Diff {
  const committed = git(["diff", `${base}...HEAD`], cwd);
  const working = git(["diff", "HEAD"], cwd);
  const patch = [committed, working].filter((part) => part.trim()).join("\n");

  const names = new Set<string>();
  for (const range of [`${base}...HEAD`, "HEAD"]) {
    for (const path of splitPaths(git(["diff", "--name-only", "-z", range], cwd))) {
      names.add(path);
    }
  }
  // git diff never lists untracked files, so a pre-commit review would miss new files entirely.
  for (const path of splitPaths(git(["ls-files", "--others", "--exclude-standard", "-z"], cwd))) {
    names.add(path);
  }

  return { base, patch, files: [...names].toSorted() };
}

const PREAMBLE = `You are reviewing a code change as a second opinion. The author already reviewed it with a different model, so repeating what that model would notice is worthless. Your value is the defect it missed.

Report only defects. For each one give the file and line, what is wrong, and a concrete failure scenario: the inputs or state that trigger it and the wrong result. A finding with no nameable failure is not a finding.`;

const INLINE_ACCESS = [
  "- Do not speculate about code you cannot see. Everything you are given is below.",
  "- You have no filesystem or network access. Do not attempt to read files or run commands.",
];

const AGENTIC_ACCESS = [
  "- You are in a disposable checkout of this repository at the reviewed commit. Read whatever the diff makes you want to check: callers, tests, adjacent modules, history.",
  "- Do NOT edit, create, or delete any file, and do not push, publish, or reach the network. You are reviewing, not fixing.",
  "- Ground each finding in code you actually opened, and name the file and line where you read it. The point of having the repository is findings the diff alone cannot support.",
];

function rulesFor(agentic: boolean): string {
  return [
    "Rules:",
    "",
    "- Do NOT summarize the change. Do not restate what the diff does. Do not open with an overview.",
    "- Do NOT praise anything or comment on style, naming, or formatting unless it causes a defect.",
    ...(agentic ? AGENTIC_ACCESS : INLINE_ACCESS),
    "- If you genuinely find no defect, say exactly: NO DEFECTS FOUND, then name the two or three places you consider most likely to hide one and why you cleared them.",
  ].join("\n");
}

/**
 * One definition per defect class, because both prompt shapes below are built from these. A
 * second hand-written copy for the single-angle prompt drifts weaker over time, and the
 * default is the single angle, so the drift lands on almost every run.
 */
const CLASSES = {
  failure:
    "Unchecked failure. A read, write, fetch, parse, or subprocess whose success is never tested, so a partial or empty result flows onward as if it were real data. Look hard at anything that streams or concatenates without checking each source succeeded.",
  correctness:
    "Correctness. Off-by-one, inverted conditions, null or undefined on a reachable path, falsy-zero treated as missing, wrong variable, lost error context.",
  loss: "Data loss and destructive behavior. Overwrites, truncation, deletes, and any path that can clobber user state. Include anything that discards data on an error path.",
  security:
    "Security. Injection, path traversal, symlink following, secrets reaching output, arguments, logs, or a third-party service, and unsafe defaults.",
  contract:
    "API and contract misuse. Wrong argument order, ignored return values, a call whose documented preconditions are not met, and invariants stated in nearby comments or docs that the code violates.",
  concurrency:
    "Concurrency and resource handling. Races, ordering assumptions between concurrent operations, unreleased handles, unbounded growth.",
} as const;

type ClassName = keyof typeof CLASSES;

function listClasses(...names: ClassName[]): string {
  return names.map((name, index) => `${index + 1}. ${CLASSES[name]}`).join("\n");
}

export const ALL_CLASSES = `Prioritize, in this order:

${listClasses("failure", "correctness", "loss", "concurrency", "security", "contract")}`;

const SPLIT_HEADER = "Look ONLY for these two classes and ignore everything else:";

/**
 * Three identical reviews mostly agree, which costs three times as much for one review's
 * worth of coverage.
 */
export const ANGLES: Angle[] = [
  {
    id: "failure",
    title: "Unchecked failure and correctness",
    focus: `${SPLIT_HEADER}\n\n${listClasses("failure", "correctness")}`,
  },
  {
    id: "safety",
    title: "Data loss and security",
    focus: `${SPLIT_HEADER}\n\n${listClasses("loss", "security")}`,
  },
  {
    id: "contract",
    title: "Contracts, concurrency, and resources",
    focus: `${SPLIT_HEADER}\n\n${listClasses("contract", "concurrency")}`,
  },
];

export function buildPrompt(
  diff: Diff,
  contents: Map<string, string>,
  skipped: string[],
  focus: string,
  agentic = false,
): string {
  const parts = [
    PREAMBLE,
    "",
    focus,
    "",
    rulesFor(agentic),
    "",
    `## Diff (against ${diff.base})`,
    "",
    "```diff",
    diff.patch,
    "```",
  ];

  if (contents.size > 0) {
    parts.push("", "## Full contents of the changed files", "");
    for (const [path, body] of contents) {
      parts.push(`### ${path}`, "", "```", body, "```", "");
    }
  }

  if (skipped.length > 0) {
    parts.push(
      "",
      `Not included in full because of size: ${skipped.join(", ")}. Review those from the diff alone and say so if that limits a finding.`,
    );
  }

  return parts.join("\n");
}

/**
 * Denial beats --allow-all-tools, so this list holds whatever the model asks for. It is not
 * the write barrier: `copilot help permissions` says write() matches file-modifying tools
 * "except shell tool invocations", so shell redirection stays open and the disposable
 * worktree is what actually contains writes. The Claude Code Bash sandbox bounds the
 * filesystem and network underneath, which is why no second harness is configured here.
 * These closing denies cover the two outbound paths the sandbox cannot: github.com is
 * allowlisted and gh credentials resolve, so push and gh would otherwise reach the network.
 */
export const AGENTIC_TOOL_ARGS = [
  "--allow-all-tools",
  "--deny-tool",
  "write",
  "--deny-tool",
  "url",
  "--deny-tool",
  "shell(git push)",
  "--deny-tool",
  "shell(gh:*)",
  "--deny-tool",
  "shell(curl:*)",
  "--deny-tool",
  "shell(wget:*)",
];

interface RunOptions {
  model: string;
  cap: number;
  cwd: string;
  agentic: boolean;
}

/**
 * Copilot refuses to write to ~/.copilot under the sandbox, so it gets a HOME the sandbox
 * allows. That home persists, which makes this path the ledger of record for what it spent.
 * --no-custom-instructions keeps the repo's own instructions out of the review, and memory
 * is off in prompt mode, so a shared home carries session history and nothing else.
 *
 * A one-shot run enables no tools and sits outside the repo, so it is one turn against
 * inlined text and Copilot never fans out. An agentic run trades that for a capped session
 * inside a throwaway checkout.
 */
export function copilotArgs(prompt: string, options: RunOptions): string[] {
  return [
    "copilot",
    "--model",
    options.model,
    // Never omitted. It is the only per-session ceiling, and the preflight guard reserves
    // exactly this number against the entitlement before the spawn.
    "--max-ai-credits",
    String(options.cap),
    "--disable-builtin-mcps",
    "--no-ask-user",
    "--no-custom-instructions",
    ...(options.agentic ? AGENTIC_TOOL_ARGS : []),
    "-p",
    prompt,
  ];
}

async function runCopilot(prompt: string, angle: Angle, options: RunOptions): Promise<Result> {
  const args = copilotArgs(prompt, options);

  const child = Bun.spawn(args, {
    cwd: options.cwd,
    env: { ...process.env, HOME: COPILOT_HOME },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  const output = [stdout, stderr].filter((part) => part.trim()).join("\n");
  const credits = output.match(/AI Credits\s+([\d.]+)/);

  return { angle, exitCode, output, credits: credits ? Number(credits[1]) : null };
}

/**
 * The write barrier for agentic mode, and also what makes its reads trustworthy: Copilot's
 * default path restriction is cwd plus subdirectories, so a checkout of the reviewed commit
 * is both the sandbox and the thing being reviewed. It shares the parent's .git, which is the
 * documented residual gap.
 */
async function withAgenticWorktree<T>(
  cwd: string,
  run: (worktree: string) => Promise<T>,
): Promise<T> {
  const head = git(["rev-parse", "--short", "HEAD"], cwd).trim();
  const worktree = join(cwd, "tmp", `copilot-agentic-${head}`);

  // The path is keyed to the commit, so a previous run's failed cleanup would block every
  // later review of that commit. `worktree remove` clears a leftover checkout and its
  // registration together, and prune drops an entry whose directory is already gone. Neither
  // touches a directory git does not own, so anything else sitting at that path survives and
  // fails the add below instead of being deleted.
  await $`git -C ${cwd} worktree remove --force ${worktree}`.quiet().nothrow();
  await $`git -C ${cwd} worktree prune`.quiet().nothrow();
  mkdirSync(dirname(worktree), { recursive: true });
  git(["worktree", "add", "--detach", worktree, "HEAD"], cwd);
  try {
    return await run(worktree);
  } finally {
    const removal = await $`git -C ${cwd} worktree remove --force ${worktree}`.quiet().nothrow();
    // Silence here would report a successful review over a checkout still on disk.
    if (removal.exitCode !== 0) {
      console.error(
        `${YELLOW}Left the agentic worktree at ${worktree}: ${removal.stderr.toString().trim()}${RESET}`,
      );
    }
  }
}

async function collectContents(diff: Diff, cwd: string, maxBytes: number) {
  // One file at a time so a single large file loses its body rather than the whole set.
  const perFileCap = Math.floor(maxBytes / 3);
  const contents = new Map<string, string>();
  const skipped: string[] = [];
  const root = realpathSync(cwd);

  let running = 0;
  for (const path of diff.files) {
    let resolved: string;
    try {
      resolved = realpathSync(join(cwd, path));
    } catch {
      // Deleted in this change. The diff already carries what it used to say.
      continue;
    }
    // The prompt goes to a third-party service, and a repo symlink can point anywhere:
    // a dotfiles checkout linking to ~/.ssh would otherwise inline a private key. The diff
    // still shows the link itself, which is the reviewable part.
    if (resolved !== root && !resolved.startsWith(root + sep)) continue;

    const file = Bun.file(resolved);
    if (file.size === 0) continue;
    // A thousand small changed files can each sit under perFileCap and still blow the prompt in aggregate.
    if (file.size > perFileCap || running + file.size > maxBytes) {
      skipped.push(path);
      continue;
    }
    running += file.size;
    contents.set(path, await file.text());
  }

  return { contents, skipped };
}

async function main(): Promise<void> {
  const argv = cli({
    name: "copilot-review",
    flags: {
      base: {
        type: String,
        description: "Base ref to diff against (default: upstream, then origin/main)",
      },
      model: {
        type: String,
        description: "Copilot model",
        default: DEFAULT_MODEL,
      },
      angles: {
        type: Number,
        description: `Independent review angles to run, 1 to ${MAX_ANGLES}. Each is one more billed call`,
        default: 1,
      },
      maxBytes: {
        type: Number,
        description: "Refuse a prompt larger than this many bytes",
        default: DEFAULT_MAX_BYTES,
      },
      dryRun: {
        type: Boolean,
        description: "Print the prompts and their size, spend nothing",
        default: false,
      },
      force: {
        type: Boolean,
        description: "Run even when a prompt exceeds --max-bytes",
        default: false,
      },
      status: {
        type: Boolean,
        description: "Print the budget tier and the band table, spend nothing",
        default: false,
      },
      agentic: {
        type: Boolean,
        description:
          "Review from a disposable checkout with tools, not inlined text. Abundant tier only",
        default: false,
      },
    },
  });

  if (argv.flags.status) {
    printStatus(readMeter(new Date()));
    return;
  }

  const angleCount = Math.trunc(argv.flags.angles);
  if (!Number.isFinite(angleCount) || angleCount < 1 || angleCount > MAX_ANGLES) {
    console.error(`${RED}--angles must be between 1 and ${MAX_ANGLES}.${RESET}`);
    process.exit(1);
  }

  if (argv.flags.agentic && angleCount > 1) {
    console.error(
      `${RED}--agentic is one capped session, so it cannot be split across angles.${RESET}`,
    );
    process.exit(1);
  }

  const maxBytes = Math.trunc(argv.flags.maxBytes);
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    console.error(`${RED}--max-bytes must be a positive number.${RESET}`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const base = argv.flags.base ?? resolveBase(cwd);
  // An unverified base reaches git as an option, not a revision: --base=--output=/tmp/x
  // turns the diff into a file write. rev-parse rejects anything that is not a revision.
  if (!gitOk(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], cwd)) {
    console.error(`${RED}--base ${base} is not a revision in this repository.${RESET}`);
    process.exit(1);
  }
  const diff = collectDiff(base, cwd);

  if (!diff.patch.trim() && diff.files.length === 0) {
    console.error(`Nothing to review against ${base}.`);
    process.exit(1);
  }

  // The agentic worktree is checked out at HEAD, so uncommitted work would put the reviewer
  // in front of code that does not match the diff it was handed, and every finding it read
  // out of a file would be suspect.
  if (argv.flags.agentic && git(["status", "--porcelain"], cwd).trim()) {
    console.error(`${RED}--agentic needs a clean tree: it reviews a checkout of HEAD.${RESET}`);
    console.error(`${YELLOW}Commit the working changes, or run the one-shot shape.${RESET}`);
    process.exit(1);
  }

  // Settle the shape before assembling anything. A degrade moves the model and the angle
  // count, which changes both the prompts and the cap the guard has to reserve.
  let model = argv.flags.model;
  let plannedAngles = angleCount;
  let meter: Meter | null = null;

  // A dry run spends nothing, so it neither needs the meter nor should fail without one.
  if (!argv.flags.dryRun) {
    try {
      meter = readMeter(new Date());
    } catch (error) {
      console.error(`${RED}Cannot read the Copilot credit meter, so refusing to spend.${RESET}`);
      console.error(`${YELLOW}${error instanceof Error ? error.message : String(error)}${RESET}`);
      console.error(
        `${DIM}An account with no premium_interactions quota has no budget for this guard to govern.${RESET}`,
      );
      process.exit(1);
    }

    if (argv.flags.agentic && meter.tier !== "abundant") {
      console.error(
        `${RED}--agentic needs the abundant tier. Pace is ${meter.pace.toFixed(1)}/day, which reads ${meter.tier}.${RESET}`,
      );
      console.error(`${YELLOW}Run the one-shot shape, or --status for the bands.${RESET}`);
      process.exit(1);
    }

    // A cheap look still finds things, and luna prices every token class at a tenth of terra,
    // so the same review costs about 0.76 instead of 7.58.
    if (meter.remaining < DEGRADE_BELOW && model === DEFAULT_MODEL) {
      console.error(
        `${YELLOW}${meter.remaining} credits left, under ${DEGRADE_BELOW}. Degrading to ${CHEAP_MODEL}, one angle.${RESET}`,
      );
      model = CHEAP_MODEL;
      plannedAngles = 1;
    }

    const sessions = argv.flags.agentic ? 1 : plannedAngles;
    const plannedCap = argv.flags.agentic ? AGENTIC_CAP : plannedAngles * ONE_SHOT_CAP;
    if (exceedsEntitlement(meter, plannedCap, sessions)) {
      console.error(
        `${RED}Refusing: ${meter.used} used plus a ${plannedCap} credit session cap plus ${OVERSHOOT * sessions} of soft-cap overshoot would pass the ${meter.entitlement} entitlement.${RESET}`,
      );
      console.error(
        `${YELLOW}Past that the plan bills overage. Run fewer angles, or wait for ${meter.resetDate}.${RESET}`,
      );
      process.exit(1);
    }
  }

  // Agentic opens the files itself, so inlining their bodies would pay cache_write for text
  // it can read for free.
  const { contents, skipped } = argv.flags.agentic
    ? { contents: new Map<string, string>(), skipped: [] as string[] }
    : await collectContents(diff, cwd, maxBytes);

  // One angle reviews everything. More than one splits the classes so the calls do not overlap.
  const angles =
    plannedAngles === 1
      ? [{ id: "all", title: "All defect classes", focus: ALL_CLASSES }]
      : ANGLES.slice(0, plannedAngles);

  const prompts = angles.map((angle) => ({
    angle,
    prompt: buildPrompt(diff, contents, skipped, angle.focus, argv.flags.agentic),
  }));
  const largest = Math.max(...prompts.map(({ prompt }) => Buffer.byteLength(prompt, "utf8")));
  const total = prompts.reduce((sum, { prompt }) => sum + Buffer.byteLength(prompt, "utf8"), 0);

  const cap = argv.flags.agentic ? AGENTIC_CAP : ONE_SHOT_CAP;

  console.error(`${CYAN}copilot review${RESET}`);
  console.error(`  model      ${model}`);
  console.error(`  shape      ${argv.flags.agentic ? "agentic, capped session" : "one-shot"}`);
  console.error(`  base       ${base}`);
  console.error(
    `  files      ${diff.files.length}${skipped.length ? ` (${skipped.length} body omitted)` : ""}`,
  );
  console.error(`  angles     ${angles.length} (${angles.map((angle) => angle.id).join(", ")})`);
  console.error(
    `  prompt     ${total.toLocaleString()} bytes total, roughly ${Math.round(total / 4).toLocaleString()} tokens`,
  );
  if (meter) {
    console.error(
      `  budget     ${meter.tier}, ${meter.remaining} left, capped at ${cap} per session`,
    );
  }
  console.error(
    `${DIM}  ${angles.length} billed call${angles.length === 1 ? "" : "s"} against a fixed plan budget. Credits spent print below.${RESET}`,
  );

  if (argv.flags.dryRun) {
    for (const { angle, prompt } of prompts) {
      console.error("");
      console.error(`${BOLD}--- ${angle.id} ---${RESET}`);
      console.log(prompt);
    }
    return;
  }

  if (largest > ABSOLUTE_MAX_BYTES) {
    console.error("");
    console.error(
      `${RED}Refusing: largest prompt is ${largest.toLocaleString()} bytes, past the ${ABSOLUTE_MAX_BYTES.toLocaleString()} argv ceiling that --force cannot lift.${RESET}`,
    );
    console.error(`${YELLOW}Narrow the diff with --base.${RESET}`);
    process.exit(1);
  }

  if (largest > maxBytes && !argv.flags.force) {
    console.error("");
    console.error(
      `${RED}Refusing: largest prompt is ${largest.toLocaleString()} bytes, over the ${maxBytes.toLocaleString()} cap.${RESET}`,
    );
    console.error(
      `${YELLOW}Narrow the diff with --base, or pass --force if this review is worth the spend.${RESET}`,
    );
    process.exit(1);
  }

  console.error("");
  mkdirSync(COPILOT_HOME, { recursive: true });

  // Angles run one at a time because every spawn shares COPILOT_HOME, and Copilot writes its
  // session ledger there. Concurrent writers race for that state, and the ledger is the record
  // this whole guard reads back. Serializing costs only wall-clock: separate spawns are
  // separate sessions that share no prompt cache, so nothing is lost by not overlapping them.
  // cwd stays outside the repository for a one-shot: no tools are granted, so there is
  // nothing to read, and Copilot's default path restriction stays pointed away from the code.
  const spawnAll = async (workdir: string) => {
    const results: Result[] = [];
    for (const { angle, prompt } of prompts) {
      results.push(
        await runCopilot(prompt, angle, { model, cap, cwd: workdir, agentic: argv.flags.agentic }),
      );
    }
    return results;
  };
  const results = argv.flags.agentic
    ? await withAgenticWorktree(cwd, spawnAll)
    : await spawnAll("/");

  let spent = 0;
  let failed = false;
  for (const result of results) {
    if (angles.length > 1) {
      console.log(`\n${BOLD}## ${result.angle.title}${RESET}\n`);
    }
    console.log(result.output.trim());
    if (result.credits !== null) spent += result.credits;
    if (result.exitCode !== 0) failed = true;
  }

  console.error("");
  const across = `across ${angles.length} call${angles.length === 1 ? "" : "s"}`;
  console.error(
    meter
      ? `${CYAN}AI credits ${spent.toFixed(2)} ${across}, roughly ${Math.max(0, Math.round(meter.remaining - spent))} of ${meter.entitlement} left until ${meter.resetDate}${RESET}`
      : `${CYAN}AI credits ${spent.toFixed(2)} ${across}${RESET}`,
  );

  process.exit(failed ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
