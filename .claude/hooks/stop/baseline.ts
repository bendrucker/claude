import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

const execFileAsync = promisify(execFile);
const VERIFY_TIMEOUT = 60_000;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const SECTION_HEADER = /^(.+?)\.{3,}(?:\(.+?\))?(Passed|Failed|Skipped)$/;
const HOOK_ID = /^- hook id: (.+)$/;
const SECTION_META = /^- (?:exit code|duration): /;

export interface CheckResult {
  name: string;
  id?: string;
  status: "passed" | "failed" | "skipped";
  /** Normalized output lines, used for baseline comparison. */
  lines: string[];
  /** Raw section body, used for display. */
  raw: string;
}

export interface BaselineEntry {
  /** Whether the check failed on the session's baseline commit. */
  failed: boolean;
  /** Normalized failure lines observed at the baseline. */
  lines: string[];
  /** Whether the pre-existing failure has already been surfaced to the user. */
  notified?: boolean;
}

export interface StopState {
  checks: Record<string, BaselineEntry>;
}

export type BaselineVerdict = Pick<BaselineEntry, "failed" | "lines">;

export type BaselineVerifier = (checks: CheckResult[]) => Promise<Map<string, BaselineVerdict>>;

export function normalizeLine(line: string): string {
  return line
    .replace(ANSI, "")
    .replace(/\b\d+(?:\.\d+)?\s*m?s\b/g, "<duration>")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePrekOutput(output: string): CheckResult[] {
  const results: CheckResult[] = [];
  let body: string[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(ANSI, "").replace(/\r$/, "");
    const header = line.match(SECTION_HEADER);
    if (header?.[1] !== undefined && header[2] !== undefined) {
      results.push({
        name: header[1].trim(),
        status: header[2].toLowerCase() as CheckResult["status"],
        lines: [],
        raw: "",
      });
      body = [];
      continue;
    }
    const current = results.at(-1);
    if (!current) continue;

    const id = line.match(HOOK_ID)?.[1];
    if (id !== undefined) {
      current.id = id.trim();
      continue;
    }
    if (SECTION_META.test(line)) continue;
    body.push(line);
    current.raw = body.join("\n").trim();
    current.lines = body.map(normalizeLine).filter((normalized) => normalized !== "");
  }

  return results;
}

function label(check: CheckResult): string {
  return check.id ? `${check.name} (${check.id})` : check.name;
}

/**
 * Applies one prek run to the session baseline and decides the hook outcome.
 * Mutates `state`; the caller persists it.
 *
 * - A check passing tombstones its baseline entry: once the session has seen
 *   it pass, any later failure is the session's to fix.
 * - A failing check without a baseline entry is verified against the
 *   session's baseline commit via `verify`. No verdict means "could not
 *   verify", which is treated as a new failure (the status quo: block).
 * - A failure is pre-existing only if the check failed at the baseline and
 *   every normalized output line was already present there.
 */
export async function evaluateStop(
  state: StopState,
  results: CheckResult[],
  verify: BaselineVerifier,
): Promise<SyncHookJSONOutput | null> {
  for (const result of results) {
    const entry = state.checks[result.name];
    if (result.status === "passed" && entry?.failed) {
      entry.failed = false;
      entry.lines = [];
    }
  }

  const failed = results.filter((result) => result.status === "failed");
  if (failed.length === 0) return null;

  const unverified = failed.filter((result) => !(result.name in state.checks));
  if (unverified.length > 0) {
    const verdicts = await verify(unverified);
    for (const result of unverified) {
      const verdict = verdicts.get(result.name);
      state.checks[result.name] = {
        failed: verdict?.failed ?? false,
        lines: verdict?.lines ?? [],
      };
    }
  }

  const preexisting: CheckResult[] = [];
  const fresh: CheckResult[] = [];
  for (const result of failed) {
    const entry = state.checks[result.name];
    // A silent failure (no output lines) matches only a silent baseline
    // failure; [].every() alone would cover it vacuously.
    const covered =
      entry?.failed &&
      (result.lines.length > 0
        ? result.lines.every((line) => entry.lines.includes(line))
        : entry.lines.length === 0);
    (covered ? preexisting : fresh).push(result);
  }

  const markNotified = (result: CheckResult) => {
    const entry = state.checks[result.name];
    if (entry) entry.notified = true;
  };

  if (fresh.length > 0) {
    for (const result of preexisting) {
      markNotified(result);
    }
    const sections = fresh
      .map((result) =>
        result.raw ? `${label(result)}:\n${result.raw}` : `${label(result)} failed`,
      )
      .join("\n\n");
    const note =
      preexisting.length > 0
        ? `\n\nPre-existing failures, not caused by this session (not blocking): ${preexisting.map(label).join(", ")}`
        : "";
    return {
      decision: "block",
      reason: `Check failures:\n\n${sections}${note}`,
    };
  }

  const unnotified = preexisting.filter((result) => !state.checks[result.name]?.notified);
  for (const result of unnotified) {
    markNotified(result);
  }
  if (unnotified.length === 0) return null;

  return {
    systemMessage: `Pre-existing check failure${unnotified.length > 1 ? "s" : ""}, not caused by this session (not blocking): ${unnotified.map(label).join(", ")}`,
  };
}

/**
 * State is scoped to the session AND the working directory: a session
 * re-rooted into a different worktree must not carry baselines recorded
 * against another checkout.
 */
export function stateFilePath(sessionId: string, cwd: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9-]/g, "-");
  const dir = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  return join(tmpdir(), `claude-stop-baseline-${safe}-${dir}.json`);
}

export async function readState(path: string): Promise<StopState> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { checks: {} };
  try {
    const parsed = (await file.json()) as StopState;
    if (parsed && typeof parsed.checks === "object" && parsed.checks !== null) {
      return parsed;
    }
  } catch {}
  return { checks: {} };
}

export async function writeState(path: string, state: StopState): Promise<void> {
  await Bun.write(path, JSON.stringify(state));
}

export async function transcriptStartTime(transcriptPath: string): Promise<Date | null> {
  const file = Bun.file(transcriptPath);
  if (!(await file.exists())) return null;

  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { timestamp?: string };
      if (entry.timestamp) {
        const parsed = new Date(entry.timestamp);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    } catch {}
  }
  return null;
}

const REFLOG_ENTRY = /^([0-9a-f]+) HEAD@\{(\d+)\}$/;

/**
 * Resolves what HEAD pointed at when the session started, via the HEAD
 * reflog. %gd with --date=unix carries the time the ref moved; commit
 * timestamps (%ct) would misdate checkouts of older commits.
 */
export async function resolveHeadAt(cwd: string, startedAt: Date): Promise<string | null> {
  const cutoff = Math.floor(startedAt.getTime() / 1000);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-g", "--date=unix", "--format=%H %gd", "HEAD"],
      { cwd },
    );
    for (const line of stdout.split("\n")) {
      const entry = line.trim().match(REFLOG_ENTRY);
      if (entry?.[1] !== undefined && Number(entry[2]) <= cutoff) return entry[1];
    }
  } catch {}
  return null;
}

async function runChecksInWorktree(
  worktree: string,
  ids: string[],
  files: string[],
): Promise<string> {
  try {
    await execFileAsync("bun", ["install", "--frozen-lockfile", "--cwd", worktree], {
      timeout: VERIFY_TIMEOUT,
    });
  } catch {}

  try {
    const { stdout, stderr } = await execFileAsync("prek", ["run", ...ids, "--files", ...files], {
      cwd: worktree,
      timeout: VERIFY_TIMEOUT,
    });
    return stdout + stderr;
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    return (execError.stdout ?? "") + (execError.stderr ?? "");
  }
}

export interface VerifierOptions {
  cwd: string;
  transcriptPath: string;
  /** Session-edited files, relative to cwd (the same list passed to prek). */
  files: string[];
  runChecks?: typeof runChecksInWorktree;
}

const WORKTREE_PREFIX = "stop-baseline-";

/** Removes worktrees leaked by a prior verification the platform killed mid-run. */
async function removeStaleWorktrees(cwd: string): Promise<void> {
  let names: string[];
  try {
    names = readdirSync(join(cwd, "tmp"));
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(WORKTREE_PREFIX)) continue;
    await execFileAsync("git", ["worktree", "remove", "--force", join(cwd, "tmp", name)], {
      cwd,
    }).catch(() => {});
  }
}

/**
 * Verifies failing checks against the session's baseline: checks out the
 * commit HEAD pointed at when the session started into a disposable worktree
 * under tmp/ and re-runs just those checks there, scoped to the session files
 * that exist at the baseline. Any failure to verify yields no verdict, which
 * `evaluateStop` treats as a new failure. Checks without a parsed hook id are
 * never verified: prek selects hooks by id, and passing a display name would
 * error the whole run.
 */
export function createVerifier(options: VerifierOptions): BaselineVerifier {
  const { cwd, transcriptPath, files, runChecks = runChecksInWorktree } = options;

  return async (checks) => {
    const verdicts = new Map<string, BaselineVerdict>();

    const identified = checks.filter(
      (check): check is CheckResult & { id: string } => check.id !== undefined,
    );
    if (identified.length === 0) return verdicts;

    const startedAt = await transcriptStartTime(transcriptPath);
    if (!startedAt) return verdicts;
    const ref = await resolveHeadAt(cwd, startedAt);
    if (!ref) return verdicts;

    await removeStaleWorktrees(cwd);
    const worktree = join(cwd, "tmp", `${WORKTREE_PREFIX}${process.pid}-${Date.now()}`);
    try {
      await execFileAsync("git", ["worktree", "add", "--detach", worktree, ref], { cwd });
    } catch {
      return verdicts;
    }

    try {
      const present: string[] = [];
      for (const file of files) {
        if (await Bun.file(join(worktree, file)).exists()) present.push(file);
      }
      if (present.length === 0) return verdicts;

      const ids = identified.map((check) => check.id);
      // Baseline checks run under the worktree path; rewrite it to the
      // session cwd so path-bearing output lines compare equal.
      const output = (await runChecks(worktree, ids, present)).replaceAll(worktree, cwd);
      for (const result of parsePrekOutput(output)) {
        const match = identified.find(
          (check) => check.id === result.id || check.name === result.name,
        );
        if (!match) continue;
        verdicts.set(match.name, { failed: result.status === "failed", lines: result.lines });
      }
    } catch {
    } finally {
      await execFileAsync("git", ["worktree", "remove", "--force", worktree], { cwd }).catch(
        () => {},
      );
    }

    return verdicts;
  };
}
