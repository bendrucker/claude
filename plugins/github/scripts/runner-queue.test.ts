import { describe, expect, test } from "bun:test";
import {
  type Api,
  formatQueue,
  invokesWorkflowRun,
  type Job,
  parseRunUrl,
  processInput,
  queueFor,
  type Run,
} from "./runner-queue";

const NOW = Date.parse("2026-10-22T17:00:00Z");
const REPO = "bendrucker/claude";
const SANDBOX = ["self-hosted", "actions-sandbox"];

const run = (id: number, name: string, status: string, overrides: Partial<Run> = {}): Run => ({
  id,
  name,
  status,
  workflow_id: id * 10,
  created_at: "2026-10-22T16:40:00Z",
  run_started_at: "2026-10-22T16:40:00Z",
  updated_at: "2026-10-22T16:55:00Z",
  ...overrides,
});

const job = (run_id: number, status: string, overrides: Partial<Job> = {}): Job => ({
  id: run_id * 100,
  run_id,
  name: "main",
  status,
  labels: SANDBOX,
  created_at: "2026-10-22T16:40:00Z",
  started_at: status === "in_progress" ? "2026-10-22T16:48:00Z" : null,
  head_branch: "main",
  ...overrides,
});

// Answers by path: `jobs` maps run ids to their jobs, `active` maps a status
// query to its runs, and `history` maps workflow ids to successful runs.
function fakeApi(fixture: {
  jobs: Record<number, Job[]>;
  active?: Record<string, Run[]>;
  runs?: Record<number, Run>;
  history?: Record<number, Run[]>;
}): Api & { calls: string[] } {
  const calls: string[] = [];
  const body = (path: string): object | undefined => {
    const jobs = /actions\/runs\/(\d+)\/jobs/.exec(path);
    if (jobs) return { jobs: fixture.jobs[Number(jobs[1])] ?? [] };
    const history = /actions\/workflows\/(\d+)\/runs/.exec(path);
    if (history) return { workflow_runs: fixture.history?.[Number(history[1])] ?? [] };
    const status = /actions\/runs\?status=(\w+)/.exec(path);
    if (status) return { workflow_runs: fixture.active?.[status[1] ?? ""] ?? [] };
    const single = /actions\/runs\/(\d+)$/.exec(path);
    if (single) return fixture.runs?.[Number(single[1])];
    throw new Error(`unexpected path ${path}`);
  };
  const api = (path: string) => {
    calls.push(path);
    return Promise.resolve(JSON.stringify(body(path)));
  };
  return Object.assign(api, { calls });
}

describe("invokesWorkflowRun", () => {
  test.each<[string, boolean]>([
    ["gh workflow run session-bench.yml --ref main", true],
    ["cd repo && gh workflow run cloud-sessions.yml", true],
    ["gh -R bendrucker/claude workflow run eval.yml -f suite=x", true],
    ["gh run view 123", false],
    ["gh workflow list", false],
    ["echo gh workflow running", false],
  ])("%p -> %p", (command, expected) => {
    expect(invokesWorkflowRun(command)).toBe(expected);
  });
});

describe("parseRunUrl", () => {
  test("reads the run URL gh prints after a dispatch", () => {
    const out =
      "✓ Created workflow_dispatch event for cloud-sessions.yml at main\nhttps://github.com/bendrucker/claude/actions/runs/39817210542\n";
    expect(parseRunUrl(out)).toEqual({ host: "github.com", repo: REPO, id: 39817210542 });
  });

  test("returns null without a URL", () => {
    expect(parseRunUrl("✓ Created workflow_dispatch event")).toBeNull();
  });
});

describe("queueFor", () => {
  const ref = { host: "github.com", repo: REPO, id: 3 };

  test("lists the job holding the runner and the jobs queued ahead", async () => {
    const api = fakeApi({
      jobs: {
        1: [job(1, "in_progress")],
        2: [job(2, "queued", { created_at: "2026-10-22T16:45:00Z" })],
        3: [job(3, "queued", { created_at: "2026-10-22T16:49:00Z" })],
        4: [job(4, "queued", { created_at: "2026-10-22T16:52:00Z" })],
        5: [job(5, "in_progress", { labels: ["ubuntu-latest"] })],
      },
      active: {
        in_progress: [run(1, "session-bench", "in_progress"), run(5, "test", "in_progress")],
        queued: [
          run(2, "eval", "queued"),
          run(3, "cloud-sessions", "queued"),
          run(4, "x", "queued"),
        ],
      },
      history: {
        10: [
          run(91, "session-bench", "completed", { updated_at: "2026-10-22T16:52:00Z" }),
          run(92, "session-bench", "completed", { updated_at: "2026-10-22T16:54:00Z" }),
          run(93, "session-bench", "completed", { updated_at: "2026-10-22T17:10:00Z" }),
        ],
      },
    });
    const queue = await queueFor(api, ref, NOW, 0);
    expect(queue?.holding.map((h) => [h.run.id, h.typical])).toEqual([[1, 14]]);
    expect(queue?.ahead.map((a) => a.run.id)).toEqual([2]);
    expect(formatQueue(queue!, NOW)).toMatchInlineSnapshot(`
      "[github/runner-queue] Run 3 is queued for a self-hosted runner labeled actions-sandbox: 1 job(s) ahead, 1 matching job(s) running.
      Holding the runner:
      - session-bench run 1 job "main" on main, started 12m ago (recent successful runs take ~14m)
      Queued ahead:
      - eval run 2 job "main" on main, queued 15m ago"
    `);
  });

  test("waits for a fresh run's jobs to appear", async () => {
    let lookups = 0;
    const api: Api = (path) => {
      const body = path.includes("/runs/3/jobs")
        ? { jobs: ++lookups < 3 ? [] : [job(3, "queued")] }
        : { workflow_runs: [] };
      return Promise.resolve(JSON.stringify(body));
    };
    const queue = await queueFor(api, ref, NOW, 0);
    expect(lookups).toBe(3);
    expect(queue?.ahead).toEqual([]);
    expect(formatQueue(queue!, NOW)).toContain("starting or offline");
  });

  test.each([
    ["already started", job(3, "in_progress")],
    ["runs on a hosted runner", job(3, "queued", { labels: ["ubuntu-latest"] })],
  ])("stays quiet for a job that %s", async (_, mine) => {
    const api = fakeApi({ jobs: { 3: [mine] } });
    expect(await queueFor(api, ref, NOW, 0)).toBeNull();
    expect(api.calls).toHaveLength(1);
  });

  test("reports a run pending on its concurrency group against every self-hosted job", async () => {
    const api = fakeApi({
      jobs: { 1: [job(1, "in_progress")] },
      runs: { 3: run(3, "session-bench", "pending") },
      active: { in_progress: [run(1, "session-bench", "in_progress")] },
    });
    const queue = await queueFor(api, ref, NOW, 0);
    expect(queue?.pending).toBe(true);
    expect(queue?.holding.map((h) => h.run.id)).toEqual([1]);
    expect(formatQueue(queue!, NOW)).toStartWith(
      "[github/runner-queue] Run 3 is pending on its concurrency group",
    );
  });
});

describe("processInput", () => {
  const input = (command: string, stdout: string) => ({
    tool_input: { command },
    tool_response: { stdout, stderr: "" },
  });

  test("ignores commands other than a dispatch", async () => {
    const api = fakeApi({ jobs: {} });
    const url = "https://github.com/bendrucker/claude/actions/runs/3";
    expect(await processInput(input("gh run view 3", url), api, NOW, 0)).toBeNull();
    expect(await processInput(input("gh workflow run x.yml", ""), api, NOW, 0)).toBeNull();
    expect(api.calls).toEqual([]);
  });

  test("emits the queue as PostToolUse context", async () => {
    const api = fakeApi({ jobs: { 3: [job(3, "queued")] } });
    const output = await processInput(
      input(
        "gh workflow run cloud-sessions.yml",
        "https://github.com/bendrucker/claude/actions/runs/3",
      ),
      api,
      NOW,
      0,
    );
    expect(output?.hookSpecificOutput).toMatchObject({ hookEventName: "PostToolUse" });
  });
});
