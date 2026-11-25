import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { backgroundId, detachedEnv, type Runner } from "../../dispatch/scripts/dispatch";
import { appendDispatch, type ClosedRow } from "../../dispatch/scripts/ledger";
import { CloseError } from "./errors";
import { gitFacts } from "./git";
import { endedRow, type Outcome } from "./rows";
import { trimmed } from "./text";

export interface ResumeDeps {
  run: Runner;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  dataDir: string;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
  out: (line: string) => void;
  spawnDetached: (argv: readonly string[], cwd: string, logPath: string) => Promise<number>;
  alive: (pid: number) => boolean;
}

const EXIT_ATTEMPTS = 600;
const EXIT_INTERVAL_MS = 500;
const BACKGROUND_REFERENCE = resolve(import.meta.dirname, "..", "references", "background.md");
const RESUME_SCRIPT = join(import.meta.dirname, "close.ts");

// Claude Code kills its Bash tool's process tree on exit, so sh backgrounds the helper and exits, leaving it to launchd.
export async function spawnDetached(
  argv: readonly string[],
  cwd: string,
  logPath: string,
): Promise<number> {
  const launcher = Bun.spawn(
    ["sh", "-c", '"$@" >>"$0" 2>&1 </dev/null & echo $!', logPath, ...argv],
    { cwd, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(launcher.stdout).text(),
    new Response(launcher.stderr).text(),
    launcher.exited,
  ]);
  const pid = processId(stdout.trim());
  if (code !== 0 || pid == null)
    throw new CloseError(`could not start the resume helper: ${trimmed(stderr) ?? stdout.trim()}`);
  return pid;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}

export function kill(pid: number): void {
  try {
    process.kill(pid);
  } catch (error) {
    if (!hasCode(error, "ESRCH")) throw error;
  }
}

export function processId(value: string): number | null {
  const pid = Number(value);
  return /^\d+$/.test(value) && pid > 0 ? pid : null;
}

export function handoffPrompt(session: string, pr: string): string {
  return `You are the background continuation of session ${session}. Its pane has closed. Follow ${BACKGROUND_REFERENCE} for PR ${pr}.`;
}

export function resumerLog(dataDir: string, session: string): string {
  return join(dataDir, `close-resume-${session}.log`);
}

// Resuming after the foreground process exits keeps the session id. Resuming while it runs starts a copy.
export function startResumer(
  deps: ResumeDeps,
  session: string,
  pr: string,
  cwd: string,
): Promise<number> {
  const pid = processId(deps.env.CLAUDE_PID ?? "");
  if (pid == null)
    throw new CloseError(
      "CLAUDE_PID is not a process id, so the handoff cannot wait for this session to exit",
      2,
    );
  // sh opens the log after it reports the helper's pid, so a missing directory would fail unseen.
  mkdirSync(deps.dataDir, { recursive: true });
  return deps.spawnDetached(
    [
      process.execPath,
      RESUME_SCRIPT,
      "resume",
      "--session",
      session,
      "--pr",
      pr,
      "--pid",
      `${pid}`,
    ],
    cwd,
    resumerLog(deps.dataDir, session),
  );
}

export interface EndedOptions {
  session: string;
  pr: string;
  outcome: Outcome;
}

export async function recordEnded(
  options: EndedOptions,
  deps: ResumeDeps,
  summary: string | null = null,
): Promise<ClosedRow> {
  const { session, pr, outcome } = options;
  const facts = await gitFacts(deps.run, deps.cwd);
  const row = endedRow(
    facts,
    { ts: deps.now().toISOString(), session, fork: session, pr, summary },
    outcome,
  );
  appendDispatch(row, deps.dataDir);
  return row;
}

async function awaitExit(
  deps: ResumeDeps,
  pid: number,
  attempts = EXIT_ATTEMPTS,
): Promise<boolean> {
  if (!deps.alive(pid)) return true;
  if (attempts <= 1) return false;
  await deps.wait(EXIT_INTERVAL_MS);
  return awaitExit(deps, pid, attempts - 1);
}

export interface ResumeOptions {
  session: string;
  pr: string;
  pid: number;
}

export async function resumeSession(options: ResumeOptions, deps: ResumeDeps): Promise<string> {
  const { session, pr, pid } = options;
  const failed = async (problem: string): Promise<never> => {
    await recordEnded({ session, pr, outcome: "stopped" }, deps, `resume failed: ${problem}`);
    throw new CloseError(problem);
  };

  if (!(await awaitExit(deps, pid)))
    return failed(`session process ${pid} was still running, so it was not resumed`);
  const started = await deps.run(
    ["claude", "--bg", "--resume", session, handoffPrompt(session, pr)],
    { cwd: deps.cwd, env: detachedEnv(deps.env) },
  );
  if (started.code !== 0)
    return failed(`claude --bg failed: ${trimmed(started.stderr) ?? started.stdout.trim()}`);
  const fork = backgroundId(started.stdout);
  if (fork == null)
    return failed(`claude --bg printed no background session id: ${started.stdout.trim()}`);
  deps.out(started.stdout.trim());
  return fork;
}
