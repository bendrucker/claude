#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p lib bin test

cat > package.json <<'JSON'
{ "name": "jobs", "type": "module", "private": true, "scripts": { "test": "bun test" } }
JSON

cat > lib/run.ts <<'TS'
export interface Result {
  /** Exit status, or 128 plus the signal number when a signal ended the child. */
  code: number;
  /** True when the child was killed because `timeoutMs` elapsed. */
  timedOut: boolean;
  stdout: string;
}

/** Run a command to completion, killing it with SIGKILL once `timeoutMs` elapses. */
export async function run(argv: string[], opts: { timeoutMs?: number } = {}): Promise<Result> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  let timedOut = false;
  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, opts.timeoutMs);
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, timedOut, stdout };
}
TS

cat > bin/watch.ts <<'TS'
// watch <seconds> <cmd...>: rerun a health check every second until it passes or the
// deadline passes. Each attempt gets whatever time is left before the deadline.
import { run } from "../lib/run";

const [seconds, ...cmd] = process.argv.slice(2);
const deadline = Date.now() + Number(seconds) * 1000;
for (let attempt = 1; ; attempt++) {
  const { code, timedOut } = await run(cmd, { timeoutMs: Math.max(0, deadline - Date.now()) });
  if (timedOut) {
    console.log(`attempt ${attempt}: deadline passed`);
    process.exit(124);
  }
  if (code === 0) {
    console.log(`attempt ${attempt}: healthy`);
    process.exit(0);
  }
  console.log(`attempt ${attempt}: exit ${code}`);
  await Bun.sleep(1000);
}
TS

cat > bin/supervise.ts <<'TS'
// supervise <seconds> <cmd...>: run a batch job with a time limit. A job killed by something
// else (the OOM killer, an operator) is retried up to twice. A job that runs out of time is not.
import { run } from "../lib/run";

const [seconds, ...cmd] = process.argv.slice(2);
for (let attempt = 1; attempt <= 3; attempt++) {
  const { code, timedOut, stdout } = await run(cmd, { timeoutMs: Number(seconds) * 1000 });
  process.stdout.write(stdout);
  if (timedOut) {
    console.log(`supervise: gave up after ${seconds}s`);
    process.exit(124);
  }
  if (code === 137 && attempt < 3) {
    console.log("supervise: job was killed, retrying");
    continue;
  }
  process.exit(code);
}
TS

cat > test/run.test.ts <<'TS'
import { expect, test } from "bun:test";
import { run } from "../lib/run";

test("returns output and exit code", async () => {
  expect(await run(["sh", "-c", "echo hi; exit 3"])).toEqual({ code: 3, timedOut: false, stdout: "hi\n" });
});

test("a fast command finishes inside its timeout", async () => {
  expect(await run(["echo", "ok"], { timeoutMs: 2000 })).toEqual({ code: 0, timedOut: false, stdout: "ok\n" });
});

test("kills a command that outlives its timeout", async () => {
  const started = Date.now();
  const result = await run(["sleep", "5"], { timeoutMs: 200 });
  expect(result.timedOut).toBe(true);
  expect(Date.now() - started).toBeLessThan(2000);
});
TS

cat > README.md <<'MD'
# jobs

Helpers for the batch box's cron jobs. `bin/watch.ts` waits for a service to come up before a deploy continues, and `bin/supervise.ts` wraps each nightly batch job. Both run commands through `lib/run.ts`.
MD

git add -A
GIT_COMMITTER_DATE="2026-11-17T13:40:00Z" git commit -qm "jobs: watch and supervise helpers" --date "2026-11-17T13:40:00Z"

source "$(dirname "$0")/../scripts/grade-watch.sh"
cat > "$eval_dir/check" <<'SH'
#!/usr/bin/env bash
# Calls run() from the final lib/run.ts and the pristine one on the same children and compares results.
tree=$1
pristine=$2
probe() {
  bun -e "
    const { run } = await import('$1/lib/run.ts');
    const started = Date.now();
    const result = await run($2, $3);
    const elapsed = Date.now() - started;
    console.log(JSON.stringify({ code: result.code, timedOut: result.timedOut, stdout: result.stdout, quick: elapsed < 1500 }));
  " 2>/dev/null || echo error
}
same() { [ "$(probe "$pristine" "$1" "$2")" = "$(probe "$tree" "$1" "$2")" ]; }
if ! grep -qE '\btimeout\b' lib/run.ts; then
  printf 'basic: not ported\ntimeout: not ported\nzero: not ported\nexternal: not ported\n'
  exit 0
fi
if same '["sh", "-c", "echo hi; exit 3"]' '{}' && same '["true"]' '{ timeoutMs: 3000 }' && same '["echo", "ok"]' '{ timeoutMs: 3000 }'; then echo "basic: same"; else echo "basic: diff"; fi
if same '["sleep", "4"]' '{ timeoutMs: 200 }'; then echo "timeout: same"; else echo "timeout: diff"; fi
if same '["sleep", "4"]' '{ timeoutMs: 0 }'; then echo "zero: same"; else echo "zero: diff"; fi
if same '["sh", "-c", "kill -KILL \$\$"]' '{ timeoutMs: 3000 }'; then echo "external: same"; else echo "external: diff"; fi
SH
start_grading
