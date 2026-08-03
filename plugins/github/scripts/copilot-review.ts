#!/usr/bin/env bun

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";

const DEFAULT_MODEL = "gpt-5.6-terra";
const MAX_ANGLES = 3;

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
  for (const range of [[`${base}...HEAD`], ["HEAD"]]) {
    for (const path of splitPaths(git(["diff", "--name-only", "-z", ...range], cwd))) {
      names.add(path);
    }
  }
  // git diff never lists untracked files, so a pre-commit review would miss new files entirely.
  for (const path of splitPaths(git(["ls-files", "--others", "--exclude-standard", "-z"], cwd))) {
    names.add(path);
  }

  return { base, patch, files: [...names].sort() };
}

const PREAMBLE = `You are reviewing a code change as a second opinion. The author already reviewed it with a different model, so repeating what that model would notice is worthless. Your value is the defect it missed.

Report only defects. For each one give the file and line, what is wrong, and a concrete failure scenario: the inputs or state that trigger it and the wrong result. A finding with no nameable failure is not a finding.`;

const RULES = `Rules:

- Do NOT summarize the change. Do not restate what the diff does. Do not open with an overview.
- Do NOT praise anything or comment on style, naming, or formatting unless it causes a defect.
- Do not speculate about code you cannot see. Everything you are given is below.
- You have no filesystem or network access. Do not attempt to read files or run commands.
- If you genuinely find no defect, say exactly: NO DEFECTS FOUND, then name the two or three places you consider most likely to hide one and why you cleared them.`;

const ALL_CLASSES = `Prioritize, in this order:

1. Unchecked failure. A read, write, fetch, parse, or subprocess whose success is never tested, so a partial or empty result flows onward as if it were real data. Look hard at anything that streams or concatenates without checking each source succeeded.
2. Correctness. Off-by-one, inverted conditions, null or undefined on a reachable path, falsy-zero treated as missing, wrong variable, lost error context.
3. Data loss and destructive behavior. Overwrites, truncation, deletes, and any path that can clobber user state.
4. Concurrency and resource handling. Races, unreleased handles, unbounded growth.
5. Security. Injection, path traversal, secrets in output or arguments, unsafe defaults.
6. API and contract misuse. Wrong argument order, ignored return values, violated invariants stated in nearby comments or docs.`;

/**
 * Distinct lenses rather than repeated passes. Three identical reviews mostly agree, which
 * costs three times as much for one review's worth of coverage.
 */
export const ANGLES: Angle[] = [
  {
    id: "failure",
    title: "Unchecked failure and correctness",
    focus: `Look ONLY for these two classes and ignore everything else:

1. Unchecked failure. A read, write, fetch, parse, or subprocess whose success is never tested, so a partial or empty result flows onward as if it were real data. Look hard at anything that streams or concatenates without checking each source succeeded.
2. Correctness. Off-by-one, inverted conditions, null or undefined on a reachable path, falsy-zero treated as missing, wrong variable, lost error context.`,
  },
  {
    id: "safety",
    title: "Data loss and security",
    focus: `Look ONLY for these two classes and ignore everything else:

1. Data loss and destructive behavior. Overwrites, truncation, deletes, and any path that can clobber user state. Include anything that discards data on an error path.
2. Security. Injection, path traversal, symlink following, secrets reaching output, arguments, logs, or a third-party service, and unsafe defaults.`,
  },
  {
    id: "contract",
    title: "Contracts, concurrency, and resources",
    focus: `Look ONLY for these two classes and ignore everything else:

1. API and contract misuse. Wrong argument order, ignored return values, a call whose documented preconditions are not met, and invariants stated in nearby comments or docs that the code violates.
2. Concurrency and resource handling. Races, ordering assumptions between concurrent operations, unreleased handles, unbounded growth.`,
  },
];

export function buildPrompt(
  diff: Diff,
  contents: Map<string, string>,
  skipped: string[],
  focus: string,
): string {
  const parts = [
    PREAMBLE,
    "",
    focus,
    "",
    RULES,
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
 * Copilot refuses to write to ~/.copilot under the sandbox. A throwaway HOME keeps the
 * sandbox intact, and starting it empty also means no hooks, custom instructions, or
 * session history reach the review. No tools are enabled and cwd is outside the repo, so
 * this is one turn against inlined text: Copilot never fans out on its own.
 */
async function runCopilot(prompt: string, model: string, angle: Angle): Promise<Result> {
  const home = mkdtempSync(join(tmpdir(), "copilot-review-"));
  try {
    const child = Bun.spawn(
      [
        "copilot",
        "--model",
        model,
        "--disable-builtin-mcps",
        "--no-ask-user",
        "--no-custom-instructions",
        "-p",
        prompt,
      ],
      {
        cwd: "/",
        env: { ...process.env, HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    const output = [stdout, stderr].filter((part) => part.trim()).join("\n");
    const credits = output.match(/AI Credits\s+([\d.]+)/);

    return { angle, exitCode, output, credits: credits ? Number(credits[1]) : null };
  } finally {
    await $`rm -rf ${home}`.quiet().nothrow();
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
    // Stop at the budget rather than reading every file first. A thousand small changed
    // files can each sit under perFileCap and still blow the prompt in aggregate.
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
    },
  });

  const angleCount = Math.trunc(argv.flags.angles);
  if (!Number.isFinite(angleCount) || angleCount < 1 || angleCount > MAX_ANGLES) {
    console.error(`${RED}--angles must be between 1 and ${MAX_ANGLES}.${RESET}`);
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

  const { contents, skipped } = await collectContents(diff, cwd, maxBytes);

  // One angle reviews everything. More than one splits the classes so the calls do not overlap.
  const angles =
    angleCount === 1
      ? [{ id: "all", title: "All defect classes", focus: ALL_CLASSES }]
      : ANGLES.slice(0, angleCount);

  const prompts = angles.map((angle) => ({
    angle,
    prompt: buildPrompt(diff, contents, skipped, angle.focus),
  }));
  const largest = Math.max(...prompts.map(({ prompt }) => Buffer.byteLength(prompt, "utf8")));
  const total = prompts.reduce((sum, { prompt }) => sum + Buffer.byteLength(prompt, "utf8"), 0);

  console.error(`${CYAN}copilot review${RESET}`);
  console.error(`  model      ${argv.flags.model}`);
  console.error(`  base       ${base}`);
  console.error(
    `  files      ${diff.files.length}${skipped.length ? ` (${skipped.length} body omitted)` : ""}`,
  );
  console.error(`  angles     ${angles.length} (${angles.map((angle) => angle.id).join(", ")})`);
  console.error(
    `  prompt     ${total.toLocaleString()} bytes total, roughly ${Math.round(total / 4).toLocaleString()} tokens`,
  );
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
  const results = await Promise.all(
    prompts.map(({ angle, prompt }) => runCopilot(prompt, argv.flags.model, angle)),
  );

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

  if (angles.length > 1) {
    console.error("");
    console.error(
      `${CYAN}Total AI credits ${spent.toFixed(2)} across ${angles.length} calls${RESET}`,
    );
  }

  process.exit(failed ? 1 : 0);
}

if (import.meta.main) {
  main();
}
