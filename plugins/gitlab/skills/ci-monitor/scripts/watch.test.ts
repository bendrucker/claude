import { describe, expect, it, test } from "bun:test";
import {
  clearApiErrors,
  deriveEvents,
  type Event,
  fetchPipeline,
  type InternalState,
  initialState,
  isFatalError,
  type JobRecord,
  jobsContradictSuccess,
  normalizePipelineStatus,
  type Probe,
  parseMrUrl,
  parseProject,
  probeMr,
  probePipeline,
  type Run,
  type RunResult,
  type RunTarget,
  registerApiError,
  resolveMergeStatus,
  type WatchOptions,
  watchLoop,
} from "./watch";

function makeProbe(overrides: Partial<Probe> = {}): Probe {
  return {
    sha: "sha1",
    state: "running",
    runId: "100",
    hasConflicts: false,
    mergeStatus: "can_be_merged",
    detailedMergeStatus: "mergeable",
    mrState: "opened",
    ...overrides,
  };
}

const ok = (stdout: string): RunResult => ({ ok: true, stdout });
const fail = (stderr: string): RunResult => ({ ok: false, stderr });
const noopSleep = (): Promise<void> => Promise.resolve();

// Routes each glab call by its subcommand pair (`mr view`, `ci get`) and records the calls.
function makeRun(routes: Record<string, RunResult | RunResult[]>): {
  run: Run;
  calls: string[][];
} {
  const calls: string[][] = [];
  const queues = new Map<string, RunResult[]>(
    Object.entries(routes).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : [value],
    ]),
  );
  return {
    calls,
    run: (args) => {
      calls.push(args);
      const key = `${args[0]} ${args[1]}`;
      const queue = queues.get(key);
      if (!queue) throw new Error(`unexpected glab call: ${args.join(" ")}`);
      return (queue.length > 1 ? queue.shift() : queue[0]) ?? fail("empty route");
    },
  };
}

const mrView = (fields: Record<string, unknown> = {}): RunResult =>
  ok(
    JSON.stringify({
      sha: "head-sha",
      state: "opened",
      has_conflicts: false,
      merge_status: "can_be_merged",
      detailed_merge_status: "mergeable",
      ...fields,
    }),
  );

const ciGet = (fields: Record<string, unknown> = {}): RunResult =>
  ok(
    JSON.stringify({
      id: 901,
      status: "running",
      sha: "head-sha",
      ref: "refs/merge-requests/7/head",
      jobs: [],
      ...fields,
    }),
  );

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return { name: "test", status: "success", allowFailure: false, ...overrides };
}

describe("parseMrUrl", () => {
  test.each<{
    name: string;
    url: string;
    project: string;
    projectEncoded: string;
    iid: number;
  }>([
    {
      name: "parses a standard group/project MR URL",
      url: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456",
      project: "gitlab-org/gitlab",
      projectEncoded: "gitlab-org%2Fgitlab",
      iid: 456,
    },
    {
      name: "parses a nested subgroup MR URL",
      url: "https://gitlab.com/group/subgroup/project/-/merge_requests/7",
      project: "group/subgroup/project",
      projectEncoded: "group%2Fsubgroup%2Fproject",
      iid: 7,
    },
    {
      name: "tolerates trailing path segments",
      url: "https://gitlab.com/group/project/-/merge_requests/12/diffs",
      project: "group/project",
      projectEncoded: "group%2Fproject",
      iid: 12,
    },
    {
      name: "parses a self-hosted MR URL",
      url: "https://git.example.com/group/project/-/merge_requests/3",
      project: "group/project",
      projectEncoded: "group%2Fproject",
      iid: 3,
    },
  ])("$name", ({ url, project, projectEncoded, iid }) => {
    const parsed = parseMrUrl(url);
    expect(parsed.project).toBe(project);
    expect(parsed.projectEncoded).toBe(projectEncoded);
    expect(parsed.iid).toBe(iid);
  });

  test.each<{ name: string; url: string }>([
    { name: "rejects non-GitLab URLs", url: "https://github.com/owner/repo/pull/1" },
    {
      name: "rejects URLs missing merge_requests segment",
      url: "https://gitlab.com/group/project/-/issues/1",
    },
    {
      name: "rejects URLs without a group segment",
      url: "https://gitlab.com/project/-/merge_requests/1",
    },
  ])("$name", ({ url }) => {
    expect(() => parseMrUrl(url)).toThrow();
  });
});

describe("parseProject", () => {
  test.each<{ name: string; remote: string; project: string }>([
    {
      name: "parses an HTTPS remote URL",
      remote: "https://gitlab.com/group/project.git",
      project: "group/project",
    },
    {
      name: "parses an HTTPS remote URL without .git suffix",
      remote: "https://gitlab.com/group/project",
      project: "group/project",
    },
    {
      name: "parses an HTTPS remote URL with nested subgroups",
      remote: "https://gitlab.com/group/subgroup/project.git",
      project: "group/subgroup/project",
    },
    {
      name: "parses an SCP-style SSH remote URL",
      remote: "git@gitlab.com:group/project.git",
      project: "group/project",
    },
    {
      name: "parses an SCP-style SSH remote URL with nested subgroups",
      remote: "git@gitlab.com:group/subgroup/project.git",
      project: "group/subgroup/project",
    },
    {
      name: "parses an ssh:// protocol remote URL",
      remote: "ssh://git@gitlab.com/group/project.git",
      project: "group/project",
    },
    {
      name: "parses an ssh:// protocol remote URL with nested subgroups",
      remote: "ssh://git@gitlab.com/group/subgroup/project.git",
      project: "group/subgroup/project",
    },
    {
      name: "strips a trailing slash after .git stripping",
      remote: "https://gitlab.com/group/project.git/",
      project: "group/project",
    },
  ])("$name", ({ remote, project }) => {
    expect(parseProject(remote)).toBe(project);
  });

  test.each<{ name: string; remote: string }>([
    { name: "throws when the path has no group segment", remote: "https://gitlab.com/project.git" },
    { name: "throws when the remote URL cannot be parsed", remote: "not-a-url" },
    { name: "throws on an empty string", remote: "" },
  ])("$name", ({ remote }) => {
    expect(() => parseProject(remote)).toThrow();
  });
});

describe("normalizePipelineStatus", () => {
  test.each<[string, InternalState]>([
    ["success", "success"],
    ["failed", "failing"],
    ["canceled", "failing"],
    ["running", "running"],
    ["pending", "queued"],
    ["created", "queued"],
    ["manual", "blocked"],
    ["skipped", "success"],
    ["waiting_for_resource", "queued"],
    ["preparing", "queued"],
    ["scheduled", "queued"],
    ["totally-made-up-status", "running"],
    ["", "running"],
  ])("normalizes %p to %p", (status, normalized) => {
    expect(normalizePipelineStatus(status)).toBe(normalized);
  });
});

describe("deriveEvents", () => {
  it("emits status:success on first probe when already green", () => {
    const probe = makeProbe({ state: "success" });
    const { events, state } = deriveEvents(probe, initialState(), 0, 15);
    expect(events).toEqual([{ type: "status", state: "success", sha: "sha1", run_id: "100" }]);
    expect(state.lastSha).toBe("sha1");
    expect(state.lastState).toBe("success");
  });

  it("transitions running -> failing -> running -> success", () => {
    let state = initialState();

    const r1 = deriveEvents(makeProbe({ state: "running" }), state, 0, 15);
    state = r1.state;
    expect(r1.events).toEqual([{ type: "status", state: "running", sha: "sha1", run_id: "100" }]);

    const r2 = deriveEvents(makeProbe({ state: "failing" }), state, 1, 15);
    state = r2.state;
    expect(r2.events).toEqual([{ type: "status", state: "failing", sha: "sha1", run_id: "100" }]);

    const r3 = deriveEvents(makeProbe({ state: "running" }), state, 2, 15);
    state = r3.state;
    expect(r3.events).toEqual([{ type: "status", state: "running", sha: "sha1", run_id: "100" }]);

    const r4 = deriveEvents(makeProbe({ state: "success" }), state, 3, 15);
    expect(r4.events).toEqual([{ type: "status", state: "success", sha: "sha1", run_id: "100" }]);
  });

  it("dedups identical (sha, state) probes", () => {
    let state = initialState();
    const first = deriveEvents(makeProbe({ state: "running" }), state, 0, 15);
    state = first.state;
    const second = deriveEvents(makeProbe({ state: "running" }), state, 1, 15);
    expect(second.events).toEqual([]);
  });

  it("re-emits status when SHA changes at the same state", () => {
    let state = initialState();
    const first = deriveEvents(makeProbe({ state: "running", sha: "sha1" }), state, 0, 15);
    state = first.state;
    const second = deriveEvents(
      makeProbe({ state: "running", sha: "sha2", runId: "101" }),
      state,
      1,
      15,
    );
    expect(second.events).toEqual([
      { type: "status", state: "running", sha: "sha2", run_id: "101" },
    ]);
  });

  it("emits queued-timeout once when the threshold is crossed", () => {
    let state = initialState();
    const minute = 60 * 1000;

    const start = deriveEvents(makeProbe({ state: "queued" }), state, 0, 15);
    state = start.state;
    expect(start.events.some((e) => e.type === "queued-timeout")).toBe(false);

    const midway = deriveEvents(makeProbe({ state: "queued" }), state, 5 * minute, 15);
    state = midway.state;
    expect(midway.events.some((e) => e.type === "queued-timeout")).toBe(false);

    const crossed = deriveEvents(makeProbe({ state: "queued" }), state, 16 * minute, 15);
    state = crossed.state;
    expect(crossed.events).toContainEqual({ type: "queued-timeout", minutes: 15 });

    const stillQueued = deriveEvents(makeProbe({ state: "queued" }), state, 20 * minute, 15);
    expect(stillQueued.events.some((e) => e.type === "queued-timeout")).toBe(false);
  });

  it("resets queued tracking when state changes", () => {
    let state = initialState();
    const minute = 60 * 1000;
    state = deriveEvents(makeProbe({ state: "queued" }), state, 0, 15).state;
    state = deriveEvents(makeProbe({ state: "queued" }), state, 16 * minute, 15).state;
    state = deriveEvents(makeProbe({ state: "running" }), state, 17 * minute, 15).state;
    expect(state.queuedSince).toBeNull();
    expect(state.queuedTimeoutEmitted).toBe(false);
  });

  it("emits conflicts once per SHA and not again for the same SHA", () => {
    let state = initialState();
    const first = deriveEvents(makeProbe({ state: "running", hasConflicts: true }), state, 0, 15);
    state = first.state;
    expect(first.events).toContainEqual({ type: "conflicts", sha: "sha1" });

    const second = deriveEvents(makeProbe({ state: "running", hasConflicts: true }), state, 1, 15);
    expect(second.events.some((e) => e.type === "conflicts")).toBe(false);
  });

  it("emits conflicts again when the SHA changes", () => {
    let state = initialState();
    state = deriveEvents(makeProbe({ sha: "sha1", hasConflicts: true }), state, 0, 15).state;
    const next = deriveEvents(
      makeProbe({ sha: "sha2", hasConflicts: true, runId: "101" }),
      state,
      1,
      15,
    );
    expect(next.events).toContainEqual({ type: "conflicts", sha: "sha2" });
  });

  it("emits conflicts when detailed_merge_status is conflict even if has_conflicts lags false", () => {
    const { events } = deriveEvents(
      makeProbe({ sha: "sha1", hasConflicts: false, detailedMergeStatus: "conflict" }),
      initialState(),
      0,
      15,
    );
    expect(events).toContainEqual({ type: "conflicts", sha: "sha1" });
    expect(events.some((e) => e.type === "mergeable-unknown")).toBe(false);
  });

  it("emits both status:success and conflicts in one cycle when cannot_be_merged with conflicts", () => {
    const { events } = deriveEvents(
      makeProbe({
        sha: "sha1",
        state: "success",
        hasConflicts: true,
        mergeStatus: "cannot_be_merged",
      }),
      initialState(),
      0,
      15,
    );
    expect(events.some((e) => e.type === "status" && e.state === "success")).toBe(true);
    expect(events.some((e) => e.type === "conflicts" && e.sha === "sha1")).toBe(true);
  });

  it("emits mergeable-unknown once per SHA while merge status is unchecked", () => {
    let state = initialState();
    const first = deriveEvents(
      makeProbe({ sha: "sha1", mergeStatus: "unchecked", detailedMergeStatus: "checking" }),
      state,
      0,
      15,
    );
    state = first.state;
    expect(first.events).toContainEqual({ type: "mergeable-unknown", sha: "sha1" });
    expect(first.events.some((e) => e.type === "conflicts")).toBe(false);

    const second = deriveEvents(
      makeProbe({ sha: "sha1", mergeStatus: "unchecked", detailedMergeStatus: "checking" }),
      state,
      1,
      15,
    );
    expect(second.events.some((e) => e.type === "mergeable-unknown")).toBe(false);
  });

  it("re-emits mergeable-unknown when the SHA changes", () => {
    let state = initialState();
    state = deriveEvents(
      makeProbe({ sha: "sha1", mergeStatus: "checking", detailedMergeStatus: "checking" }),
      state,
      0,
      15,
    ).state;
    const next = deriveEvents(
      makeProbe({
        sha: "sha2",
        mergeStatus: "checking",
        detailedMergeStatus: "checking",
        runId: "101",
      }),
      state,
      1,
      15,
    );
    expect(next.events).toContainEqual({ type: "mergeable-unknown", sha: "sha2" });
  });

  it("emits pr-closed (not merged) when the MR is closed", () => {
    const { events } = deriveEvents(makeProbe({ mrState: "closed" }), initialState(), 0, 15);
    expect(events).toEqual([{ type: "pr-closed" }]);
  });

  it("emits merged (not pr-closed) when the MR is merged (lastState already success)", () => {
    const initial = { ...initialState(), lastState: "success" as const, lastSha: "sha1" };
    const { events } = deriveEvents(
      makeProbe({ mrState: "merged", state: "success" }),
      initial,
      0,
      15,
    );
    expect(events).toEqual([{ type: "merged" }]);
  });

  it("emits status:success before merged when merged and lastState not success", () => {
    const { events } = deriveEvents(
      makeProbe({ mrState: "merged", state: "success", sha: "sha1", runId: "100" }),
      initialState(),
      0,
      15,
    );
    const statusIdx = events.findIndex((e) => e.type === "status");
    const mergedIdx = events.findIndex((e) => e.type === "merged");
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(events[statusIdx]).toEqual({
      type: "status",
      state: "success",
      sha: "sha1",
      run_id: "100",
    });
    expect(mergedIdx).toBeGreaterThan(statusIdx);
  });

  it("emits only merged when merged with failing checks (no false success)", () => {
    const { events } = deriveEvents(
      makeProbe({ mrState: "merged", state: "failing" }),
      initialState(),
      0,
      15,
    );
    expect(events.find((e) => e.type === "status")).toBeUndefined();
    expect(events.find((e) => e.type === "merged")).toBeDefined();
  });
});

describe("deriveEvents in branch mode", () => {
  it("emits status transitions without pr-closed or conflicts", () => {
    let state = initialState();
    const minute = 60 * 1000;

    const sequence: Probe[] = [
      makeProbe({ state: "running", sha: "shaA", runId: "1" }),
      makeProbe({ state: "queued", sha: "shaA", runId: "1" }),
      makeProbe({ state: "running", sha: "shaB", runId: "2" }),
      makeProbe({ state: "failing", sha: "shaB", runId: "2" }),
      makeProbe({ state: "running", sha: "shaC", runId: "3" }),
      makeProbe({ state: "success", sha: "shaC", runId: "3" }),
    ];

    const allEvents: Event[] = [];
    for (const [i, probe] of sequence.entries()) {
      const outcome = deriveEvents(probe, state, i * minute, 15);
      state = outcome.state;
      allEvents.push(...outcome.events);
    }

    expect(allEvents.some((e) => e.type === "conflicts")).toBe(false);
    expect(allEvents.some((e) => e.type === "pr-closed")).toBe(false);
    expect(allEvents.filter((e) => e.type === "status").length).toBeGreaterThan(0);
  });

  it("never emits pr-closed when mrState stays opened", () => {
    let state = initialState();
    for (let i = 0; i < 5; i += 1) {
      const outcome = deriveEvents(
        makeProbe({ state: "running", sha: `sha${i}`, runId: String(i) }),
        state,
        i,
        15,
      );
      state = outcome.state;
      expect(outcome.events.some((e) => e.type === "pr-closed")).toBe(false);
    }
  });

  it("never emits conflicts when hasConflicts stays false", () => {
    let state = initialState();
    for (let i = 0; i < 5; i += 1) {
      const outcome = deriveEvents(makeProbe({ state: "running", sha: `sha${i}` }), state, i, 15);
      state = outcome.state;
      expect(outcome.events.some((e) => e.type === "conflicts")).toBe(false);
    }
  });

  it("still emits queued-timeout in branch mode", () => {
    let state = initialState();
    const minute = 60 * 1000;
    state = deriveEvents(makeProbe({ state: "queued" }), state, 0, 15).state;
    const crossed = deriveEvents(makeProbe({ state: "queued" }), state, 16 * minute, 15);
    expect(crossed.events).toContainEqual({ type: "queued-timeout", minutes: 15 });
  });
});

describe("deriveEvents in pipeline-id mode", () => {
  it("never emits conflicts or pr-closed across a running -> failing sequence", () => {
    let state = initialState();
    const minute = 60 * 1000;

    const sequence: Probe[] = [
      makeProbe({ state: "queued", runId: "9001" }),
      makeProbe({ state: "running", runId: "9001" }),
      makeProbe({ state: "failing", runId: "9001" }),
    ];

    const allEvents: Event[] = [];
    for (const [i, probe] of sequence.entries()) {
      const outcome = deriveEvents(probe, state, i * minute, 15);
      state = outcome.state;
      allEvents.push(...outcome.events);
    }

    expect(allEvents.some((e) => e.type === "conflicts")).toBe(false);
    expect(allEvents.some((e) => e.type === "pr-closed")).toBe(false);
    expect(allEvents.filter((e) => e.type === "status").length).toBeGreaterThan(0);
  });

  it("never emits conflicts or pr-closed across a running -> success sequence", () => {
    let state = initialState();
    const minute = 60 * 1000;

    const sequence: Probe[] = [
      makeProbe({ state: "running", runId: "9001" }),
      makeProbe({ state: "running", runId: "9001" }),
      makeProbe({ state: "success", runId: "9001" }),
    ];

    const allEvents: Event[] = [];
    for (const [i, probe] of sequence.entries()) {
      const outcome = deriveEvents(probe, state, i * minute, 15);
      state = outcome.state;
      allEvents.push(...outcome.events);
    }

    expect(allEvents.some((e) => e.type === "conflicts")).toBe(false);
    expect(allEvents.some((e) => e.type === "pr-closed")).toBe(false);
    expect(allEvents.some((e) => e.type === "status" && e.state === "success")).toBe(true);
  });

  it("emits the failing status event so the caller can terminate on it", () => {
    const { events } = deriveEvents(
      makeProbe({ state: "failing", runId: "9001" }),
      initialState(),
      0,
      15,
    );
    expect(events).toEqual([{ type: "status", state: "failing", sha: "sha1", run_id: "9001" }]);
  });
});

describe("jobsContradictSuccess", () => {
  test.each<{ name: string; jobs: JobRecord[]; contradicting: string[] }>([
    {
      name: "a failed required job contradicts the pipeline's success",
      jobs: [makeJob(), makeJob({ name: "rspec", status: "failed" })],
      contradicting: ["rspec"],
    },
    {
      name: "a failed allow_failure job does not contradict",
      jobs: [makeJob({ name: "flaky", status: "failed", allowFailure: true })],
      contradicting: [],
    },
    {
      name: "success, manual, and skipped jobs do not contradict",
      jobs: [
        makeJob({ name: "build" }),
        makeJob({ name: "deploy", status: "manual" }),
        makeJob({ name: "docs", status: "skipped" }),
      ],
      contradicting: [],
    },
    {
      name: "an empty job list does not contradict (bridge jobs are absent from the jobs endpoint)",
      jobs: [],
      contradicting: [],
    },
    {
      name: "a canceled job does not contradict (cancellation already turns the pipeline canceled)",
      jobs: [makeJob({ name: "lint", status: "canceled" })],
      contradicting: [],
    },
  ])("$name", ({ jobs, contradicting }) => {
    expect(jobsContradictSuccess(jobs).map((job) => job.name)).toEqual(contradicting);
  });
});

describe("isFatalError", () => {
  test.each<[string, boolean]>([
    ["failed to get merge request 1: 404 Not Found.", true],
    ["No pipeline with the given ID: 1: 404 Not Found.", true],
    ["401 Unauthorized", true],
    ["403 Forbidden", true],
    ["no pipeline found. It might not exist yet.", false],
    ["500 Internal Server Error", false],
    ["failed to get merge request 404: 502 Bad Gateway", false],
    ["spawnSync glab ETIMEDOUT", false],
    ["", false],
  ])("%p is %p", (message, expected) => {
    expect(isFatalError(message)).toBe(expected);
  });
});

describe("api-error tracking", () => {
  it("emits once at the threshold and stays silent past it", () => {
    let state = initialState();
    const emitted: Event[] = [];
    for (let i = 0; i < 9; i += 1) {
      const outcome = registerApiError(state, 5);
      state = outcome.state;
      emitted.push(...outcome.events);
    }
    expect(emitted).toEqual([{ type: "api-error", consecutive: 5 }]);
  });

  it("resets on success so a later streak emits again", () => {
    let state = initialState();
    for (let i = 0; i < 3; i += 1) state = registerApiError(state, 5).state;
    state = clearApiErrors(state);
    expect(state.apiErrorCount).toBe(0);
    const emitted: Event[] = [];
    for (let i = 0; i < 5; i += 1) {
      const outcome = registerApiError(state, 5);
      state = outcome.state;
      emitted.push(...outcome.events);
    }
    expect(emitted).toEqual([{ type: "api-error", consecutive: 5 }]);
  });
});

describe("blocked pipelines", () => {
  it("emits one blocked event and a running status for a manual pipeline", () => {
    let state = initialState();
    const first = deriveEvents(makeProbe({ state: "blocked" }), state, 0, 15);
    state = first.state;
    expect(first.events).toEqual([
      { type: "status", state: "running", sha: "sha1", run_id: "100" },
      { type: "blocked", sha: "sha1", run_id: "100" },
    ]);
    expect(deriveEvents(makeProbe({ state: "blocked" }), state, 1, 15).events).toEqual([]);
  });

  it("does not start the queued-timeout clock", () => {
    let state = initialState();
    state = deriveEvents(makeProbe({ state: "blocked" }), state, 0, 15).state;
    const later = deriveEvents(makeProbe({ state: "blocked" }), state, 60 * 60 * 1000, 15);
    expect(later.events.some((e) => e.type === "queued-timeout")).toBe(false);
  });
});

describe("resolveMergeStatus", () => {
  it("resolves to a conflict once a re-poll settles merge status", async () => {
    const { run, calls } = makeRun({
      "mr view": [
        mrView({ merge_status: "checking", detailed_merge_status: "" }),
        mrView({
          merge_status: "cannot_be_merged",
          detailed_merge_status: "conflict",
          has_conflicts: true,
        }),
      ],
    });
    const resolved = await resolveMergeStatus("group/project", 7, run, noopSleep);
    expect(resolved).toEqual({
      hasConflicts: true,
      mergeStatus: "cannot_be_merged",
      detailedMergeStatus: "conflict",
    });
    expect(calls).toHaveLength(2);
  });

  it("returns undetermined after exhausting the retry budget", async () => {
    const { run, calls } = makeRun({
      "mr view": mrView({ merge_status: "unchecked", detailed_merge_status: "checking" }),
    });
    const resolved = await resolveMergeStatus("group/project", 7, run, noopSleep);
    expect(resolved).toEqual({
      hasConflicts: false,
      mergeStatus: "unchecked",
      detailedMergeStatus: "checking",
    });
    expect(calls).toHaveLength(4);
  });
});

describe("fetchPipeline", () => {
  it("calls glab without a shell, with the selector and job details", () => {
    const { run, calls } = makeRun({ "ci get": ciGet() });
    fetchPipeline(run, "group/it's", { kind: "branch", branch: "feat/it's" });
    expect(calls[0]).toEqual([
      "ci",
      "get",
      "-R",
      "group/it's",
      "--branch",
      "feat/it's",
      "-F",
      "json",
      "--with-job-details",
    ]);
  });

  it("reads a green pipeline with passing jobs as success", () => {
    const { run } = makeRun({ "ci get": ciGet({ status: "success" }) });
    expect(fetchPipeline(run, "g/p", { kind: "id", id: "901" })).toEqual({
      ok: true,
      pipeline: { id: "901", state: "success", sha: "head-sha", ref: "refs/merge-requests/7/head" },
    });
  });

  it("downgrades a success whose required job failed", () => {
    const { run } = makeRun({
      "ci get": ciGet({
        status: "success",
        jobs: [{ name: "rspec", status: "failed", allow_failure: false }],
      }),
    });
    const fetched = fetchPipeline(run, "g/p", { kind: "id", id: "901" });
    expect(fetched.ok && fetched.pipeline?.state).toBe("failing");
  });

  it("treats a missing pipeline as none yet", () => {
    const { run } = makeRun({ "ci get": fail("no pipeline found. It might not exist yet.") });
    expect(fetchPipeline(run, "g/p", { kind: "branch", branch: "b" })).toEqual({
      ok: true,
      pipeline: null,
    });
  });

  it("keeps a 404 fatal when the message also says no pipeline found", () => {
    const { run } = makeRun({
      "ci get": fail(
        'no pipeline found for branch main and failed to find associated merge request: failed to get merge requests for "main": 404 Not Found.',
      ),
    });
    const fetched = fetchPipeline(run, "g/p", { kind: "branch", branch: "main" });
    expect(fetched).toMatchObject({ ok: false, fatal: true });
  });

  it("fails softly on unparseable output", () => {
    const { run } = makeRun({ "ci get": ok("not json") });
    expect(fetchPipeline(run, "g/p", { kind: "id", id: "1" })).toMatchObject({
      ok: false,
      fatal: false,
    });
  });

  it("surfaces a timeout as a retryable failure", () => {
    const { run } = makeRun({ "ci get": fail("spawnSync glab ETIMEDOUT") });
    expect(fetchPipeline(run, "g/p", { kind: "id", id: "1" })).toMatchObject({
      ok: false,
      fatal: false,
    });
  });
});

describe("probeMr", () => {
  it("reports running when the pipeline is for an older sha than the MR head", () => {
    const { run } = makeRun({
      "mr view": mrView({ sha: "new-sha" }),
      "ci get": ciGet({ status: "success", sha: "old-sha" }),
    });
    const probed = probeMr(run, "g/p", 7);
    expect(probed.ok && probed.probe).toMatchObject({
      sha: "new-sha",
      state: "running",
      runId: null,
    });
  });

  it("trusts a merged-results pipeline whose sha is an ephemeral merge commit", () => {
    const { run } = makeRun({
      "mr view": mrView({ sha: "head-sha" }),
      "ci get": ciGet({
        status: "success",
        sha: "merge-commit-sha",
        ref: "refs/merge-requests/7/merge",
      }),
    });
    const probed = probeMr(run, "g/p", 7);
    expect(probed.ok && probed.probe.state).toBe("success");
  });

  it("reports green when the pipeline matches the head sha", () => {
    const { run } = makeRun({
      "mr view": mrView(),
      "ci get": ciGet({ status: "success" }),
    });
    const probed = probeMr(run, "g/p", 7);
    expect(probed.ok && probed.probe).toMatchObject({ state: "success", runId: "901" });
  });

  it("reports running when the MR has no pipeline yet", () => {
    const { run } = makeRun({
      "mr view": mrView(),
      "ci get": fail("no pipeline found for merge request !7."),
    });
    const probed = probeMr(run, "g/p", 7);
    expect(probed.ok && probed.probe).toMatchObject({ state: "running", runId: null });
  });

  it("maps a manual pipeline to blocked", () => {
    const { run } = makeRun({ "mr view": mrView(), "ci get": ciGet({ status: "manual" }) });
    const probed = probeMr(run, "g/p", 7);
    expect(probed.ok && probed.probe.state).toBe("blocked");
  });

  it("returns a fatal failure when the MR is missing", () => {
    const { run } = makeRun({ "mr view": fail("failed to get merge request 7: 404 Not Found.") });
    expect(probeMr(run, "g/p", 7)).toMatchObject({ ok: false, fatal: true });
  });
});

describe("probePipeline", () => {
  it("uses the pipeline's own sha in branch mode", () => {
    const { run } = makeRun({ "ci get": ciGet({ sha: "tip", status: "failed" }) });
    const probed = probePipeline(run, "g/p", { kind: "branch", branch: "b" });
    expect(probed.ok && probed.probe).toMatchObject({ sha: "tip", state: "failing" });
  });
});

describe("watchLoop", () => {
  const mrTarget: RunTarget = { mode: "mr", mrUrl: "https://gitlab.com/g/p/-/merge_requests/7" };
  const idTarget: RunTarget = { mode: "pipeline-id", project: "g/p", pipelineId: "901" };

  function harness(options: Partial<WatchOptions> & { target: RunTarget }, run: Run) {
    let clock = 0;
    const events: Event[] = [];
    const logs: string[] = [];
    const sleeps: number[] = [];
    const exit = watchLoop(
      { maxMinutes: 60, queuedTimeoutMinutes: 15, apiErrorThreshold: 5, ...options },
      {
        run,
        now: () => clock,
        sleep: (ms) => {
          sleeps.push(ms);
          clock += ms;
          return Promise.resolve();
        },
        emit: (event) => {
          events.push(event);
        },
        log: (message) => {
          logs.push(message);
        },
      },
    );
    return { exit, events, logs, sleeps };
  }

  it("exits 0 on a green pipeline in MR mode", async () => {
    const { run } = makeRun({ "mr view": mrView(), "ci get": ciGet({ status: "success" }) });
    const h = harness({ target: mrTarget }, run);
    expect(await h.exit).toBe(0);
    expect(h.events).toEqual([
      { type: "status", state: "success", sha: "head-sha", run_id: "901" },
    ]);
  });

  it("does not report green for a pipeline on the previous sha", async () => {
    const { run } = makeRun({
      "mr view": mrView({ sha: "new-sha" }),
      "ci get": ciGet({ status: "success", sha: "old-sha" }),
    });
    const h = harness({ target: mrTarget, maxMinutes: 2 }, run);
    await h.exit;
    expect(h.events.some((e) => e.type === "status" && e.state === "success")).toBe(false);
    expect(h.events.at(-1)).toEqual({ type: "max-time-reached", minutes: 2 });
  });

  test.each<[string, Event["type"]]>([
    ["merged", "merged"],
    ["closed", "pr-closed"],
  ])("exits on an MR that is %s", async (state, type) => {
    const { run } = makeRun({ "mr view": mrView({ state }), "ci get": ciGet() });
    const h = harness({ target: mrTarget }, run);
    expect(await h.exit).toBe(0);
    expect(h.events.at(-1)?.type).toBe(type);
  });

  it("keeps polling a failing pipeline in pipeline-id mode and sees the retry go green", async () => {
    const { run } = makeRun({
      "ci get": [
        ciGet({ status: "failed" }),
        ciGet({ status: "running" }),
        ciGet({ status: "success" }),
      ],
    });
    const h = harness({ target: idTarget }, run);
    expect(await h.exit).toBe(0);
    expect(h.events.map((e) => (e.type === "status" ? e.state : e.type))).toEqual([
      "failing",
      "running",
      "success",
    ]);
  });

  it("polls at a constant interval", async () => {
    const { run } = makeRun({
      "ci get": [ciGet(), ciGet(), ciGet({ status: "success" })],
    });
    const h = harness({ target: idTarget }, run);
    await h.exit;
    expect(h.sleeps).toEqual([30_000, 30_000]);
  });

  it("caps the final sleep at the deadline and emits max-time-reached", async () => {
    const { run } = makeRun({ "ci get": ciGet() });
    const h = harness({ target: idTarget, maxMinutes: 1.25 }, run);
    expect(await h.exit).toBe(0);
    expect(h.sleeps).toEqual([30_000, 30_000, 15_000]);
    expect(h.events.at(-1)).toEqual({ type: "max-time-reached", minutes: 1.25 });
  });

  test.each(["404 Not Found", "403 Forbidden", "401 Unauthorized"])(
    "exits 1 with stderr on %s in pipeline-id mode",
    async (status) => {
      const { run } = makeRun({ "ci get": fail(`No pipeline with the given ID: 901: ${status}.`) });
      const h = harness({ target: idTarget }, run);
      expect(await h.exit).toBe(1);
      expect(h.logs[0]).toContain(status);
      expect(h.events).toHaveLength(1);
      expect(h.events[0]).toMatchObject({ type: "fatal" });
      expect(JSON.stringify(h.events[0])).toContain(status);
      expect(h.sleeps).toEqual([]);
    },
  );

  it("exits 1 on a 404 in MR mode", async () => {
    const { run } = makeRun({ "mr view": fail("failed to get merge request 7: 404 Not Found.") });
    const h = harness({ target: mrTarget }, run);
    expect(await h.exit).toBe(1);
  });

  it("exits 1 on a 403 in branch mode", async () => {
    const { run } = makeRun({ "ci get": fail("403 Forbidden") });
    const h = harness({ target: { mode: "branch", project: "g/p", branch: "b" } }, run);
    expect(await h.exit).toBe(1);
  });

  it("emits api-error once at the threshold across a long outage", async () => {
    const { run } = makeRun({ "ci get": fail("500 Internal Server Error") });
    const h = harness({ target: idTarget, maxMinutes: 10, apiErrorThreshold: 3 }, run);
    await h.exit;
    expect(h.events.filter((e) => e.type === "api-error")).toEqual([
      { type: "api-error", consecutive: 3 },
    ]);
  });

  it("emits a blocked event for a manual pipeline and keeps polling", async () => {
    const { run } = makeRun({ "ci get": ciGet({ status: "manual" }) });
    const h = harness({ target: idTarget, maxMinutes: 2 }, run);
    await h.exit;
    expect(h.events.filter((e) => e.type === "blocked")).toHaveLength(1);
    expect(h.events.at(-1)).toEqual({ type: "max-time-reached", minutes: 2 });
  });

  it("emits queued-timeout once for a queued pipeline", async () => {
    const { run } = makeRun({ "ci get": ciGet({ status: "pending" }) });
    const h = harness({ target: idTarget, maxMinutes: 20 }, run);
    await h.exit;
    expect(h.events.filter((e) => e.type === "queued-timeout")).toHaveLength(1);
  });
});
