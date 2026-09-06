import { afterAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN_SH = join(import.meta.dirname, "run.sh");

/** Watchdog bound handed to run.sh, in seconds. */
const BOUND = 1;

/**
 * How long the stubs that refuse to finish sleep for. Long enough that only the
 * watchdog can end them inside the bound, short enough that a run.sh which
 * stopped bounding its waits still terminates and fails an assertion. A test
 * for a hang must not be able to hang.
 */
const STUCK_SECONDS = 10;

/** Ceiling for a bounded run: the bound, its kill grace, and process startup. */
const BOUNDED_MS = 5_000;

// Subprocess calls here go through Bun.spawnSync. Bun's $ shell keeps its
// working directory in process-global state that sibling test files set to
// temp dirs they then delete.
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) {
    // A scenario that parks a lock holder leaves it sleeping out the rest of
    // its bound, which a repeated run would otherwise accumulate.
    const holder = Bun.spawnSync(["cat", join(dir, "holder.pid")])
      .stdout.toString()
      .trim();
    if (holder !== "") Bun.spawnSync(["kill", holder]);
    Bun.spawnSync(["rm", "-rf", dir]);
  }
});

interface Scenario {
  name: string;
  /** Body of the stub build.sh, which prints the binary path run.sh invokes. */
  build: string;
  /** Body of the stub binary, when the build reaches one. */
  binary?: string;
}

const scenarios: Scenario[] = [
  {
    name: "callback never arrives",
    build: 'echo "$SCRIPT_DIR/xcall-stub"',
    binary: `exec sleep ${STUCK_SECONDS}`,
  },
  {
    name: "build never finishes",
    build: `exec sleep ${STUCK_SECONDS}`,
  },
  {
    // build.sh forks swiftc and lsregister, which inherit the stdout run.sh
    // reads the binary path from. Killing the script alone leaves them holding
    // that pipe open, and the read waits past the bound the watchdog enforced.
    name: "build forks a child that outlives it",
    build: `sleep ${STUCK_SECONDS} &\nexec sleep ${STUCK_SECONDS}`,
  },
  {
    name: "build fails",
    build: 'echo "swiftc: Operation not permitted" >&2; exit 1',
  },
  {
    name: "callback succeeds",
    build: 'echo "$SCRIPT_DIR/xcall-stub"',
    binary: 'echo "x-things-id=ABC123 url=$1"',
  },
  {
    name: "app reports an x-error",
    build: 'echo "$SCRIPT_DIR/xcall-stub"',
    binary: 'echo "errorMessage=nope" >&2; exit 1',
  },
  {
    name: "user cancels",
    build: 'echo "$SCRIPT_DIR/xcall-stub"',
    binary: 'echo "canceled" >&2; exit 2',
  },
  {
    // shlock reclaims a lock whose recorded pid is gone, so the holder has to
    // outlive the wait. Its output goes to /dev/null because a child holding
    // the stdout run.sh reads the binary path from would stall the build read.
    // Cleanup reaps it through the pid file rather than waiting it out.
    name: "another instance holds the bridge",
    build: [
      'lock="$XDG_CACHE_HOME/claude/x-callback-url/xcall.lock"',
      'mkdir -p "$(dirname "$lock")"',
      `sleep ${STUCK_SECONDS} >/dev/null 2>&1 &`,
      'echo $! > "$SCRIPT_DIR/holder.pid"',
      'shlock -f "$lock" -p "$(cat "$SCRIPT_DIR/holder.pid")"',
      'echo "$SCRIPT_DIR/xcall-stub"',
    ].join("\n"),
    binary: 'echo "unreachable"',
  },
];

async function writeExecutable(path: string, contents: string): Promise<string> {
  await Bun.write(path, contents);
  Bun.spawnSync(["chmod", "+x", path]);
  return path;
}

function stub(body: string): string {
  return `#!/bin/bash\nset -euo pipefail\nSCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n${body}\n`;
}

interface Outcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

async function runScenario(scenario: Scenario): Promise<Outcome> {
  const dir = mkdtempSync(join(tmpdir(), "xcall-run-"));
  dirs.push(dir);

  const runner = await writeExecutable(join(dir, "run.sh"), await Bun.file(RUN_SH).text());
  await writeExecutable(join(dir, "build.sh"), stub(scenario.build));
  if (scenario.binary != null && scenario.binary !== "")
    await writeExecutable(join(dir, "xcall-stub"), stub(scenario.binary));

  const started = Bun.nanoseconds();
  const proc = Bun.spawn([runner, "things:///version"], {
    env: {
      ...process.env,
      // Scenarios run concurrently and run.sh serializes on a lock under
      // XDG_CACHE_HOME. Sharing one would queue them behind each other, and the
      // lock wait budgets for a single holder ahead, so a loser would exit 5.
      XDG_CACHE_HOME: dir,
      XCALL_TIMEOUT_SECONDS: String(BOUND),
      XCALL_BUILD_TIMEOUT_SECONDS: String(BOUND),
      XCALL_LOCK_WAIT_SECONDS: String(BOUND),
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: (STUCK_SECONDS + 2) * 1000,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    elapsedMs: (Bun.nanoseconds() - started) / 1e6,
  };
}

function report(scenario: Scenario, outcome: Outcome): string {
  const stderrLine = outcome.stderr.split("\n")[0];
  return [
    scenario.name,
    `  exit:   ${outcome.exitCode}`,
    `  stdout: ${outcome.stdout !== "" ? outcome.stdout : "(none)"}`,
    `  stderr: ${stderrLine !== undefined && stderrLine !== "" ? stderrLine : "(none)"}`,
  ].join("\n");
}

test("run.sh bounds every wait and maps each outcome to its own exit code", async () => {
  const pairs = await Promise.all(
    scenarios.map(async (scenario) => ({ scenario, outcome: await runScenario(scenario) })),
  );

  expect(
    pairs
      .filter(({ outcome }) => outcome.elapsedMs >= BOUNDED_MS)
      .map(({ scenario }) => scenario.name),
  ).toEqual([]);

  expect(pairs.map(({ scenario, outcome }) => report(scenario, outcome)).join("\n"))
    .toMatchInlineSnapshot(`
    "callback never arrives
      exit:   4
      stdout: (none)
      stderr: xcall gave up after 1s waiting for a callback on xcall-claude://.
    build never finishes
      exit:   3
      stdout: (none)
      stderr: xcall build did not finish within 1s; raise XCALL_BUILD_TIMEOUT_SECONDS if swiftc is genuinely this slow
    build forks a child that outlives it
      exit:   3
      stdout: (none)
      stderr: xcall build did not finish within 1s; raise XCALL_BUILD_TIMEOUT_SECONDS if swiftc is genuinely this slow
    build fails
      exit:   3
      stdout: (none)
      stderr: swiftc: Operation not permitted
    callback succeeds
      exit:   0
      stdout: x-things-id=ABC123 url=things:///version
      stderr: (none)
    app reports an x-error
      exit:   1
      stdout: (none)
      stderr: errorMessage=nope
    user cancels
      exit:   2
      stdout: (none)
      stderr: canceled
    another instance holds the bridge
      exit:   5
      stdout: (none)
      stderr: another xcall held the xcall-claude:// bridge for more than 1s"
  `);
}, 15_000);
