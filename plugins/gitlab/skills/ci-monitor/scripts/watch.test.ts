import { describe, expect, it, test } from "bun:test";
import * as fc from "fast-check";
import {
  clearApiErrors,
  computeInterval,
  deriveEvents,
  type Event,
  type ExecFn,
  type ExecResult,
  type InternalState,
  initialState,
  isNotFoundError,
  type JobRecord,
  jobsContradictSuccess,
  normalizePipelineStatus,
  type PipelineRecord,
  type Probe,
  parseMrUrl,
  parsePipelineList,
  parseProject,
  pipelineDurations,
  probeBranch,
  probeMr,
  probePipelineId,
  registerApiError,
  resolveMergeStatus,
  selectPipeline,
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

// Stub `exec` for resolveMergeStatus tests: each entry maps a substring matcher
// against the glab command line to a canned result, exhausted in order.
function makeExec(scripted: { match: string; result: ExecResult }[]): {
  exec: ExecFn;
  remaining: () => { match: string; result: ExecResult }[];
} {
  const queue = [...scripted];
  return {
    exec: (command: string): ExecResult => {
      const next = queue.shift();
      if (!next) {
        throw new Error(`unexpected exec call: ${command}`);
      }
      if (!command.includes(next.match)) {
        throw new Error(
          `exec call did not match expected substring "${next.match}". got: ${command}`,
        );
      }
      return next.result;
    },
    remaining: () => queue,
  };
}

const ok = (stdout: string): ExecResult => ({ ok: true, stdout });
const fail = (stderr: string): ExecResult => ({
  ok: false,
  stderr,
  rateLimited: false,
  retryAfter: "",
});
const noopSleep = (): Promise<void> => Promise.resolve();

function makeRecord(overrides: Partial<PipelineRecord> = {}): PipelineRecord {
  return { id: 1, status: "running", sha: "sha1", source: "push", ...overrides };
}

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
    ["manual", "queued"],
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

describe("isNotFoundError", () => {
  test.each<[string, boolean]>([
    ["HTTP 404: Not Found", true],
    ["error: 404 returned", true],
    ["Pipeline Not Found", true],
    ["pipeline not found", true],
    ["connection reset", false],
    ["", false],
    ["500 internal server error", false],
  ])("%p is %p", (message, expected) => {
    expect(isNotFoundError(message)).toBe(expected);
  });
});

describe("pipelineDurations", () => {
  // The pipeline list endpoint returns none of `finished_at`, `started_at`, or
  // `duration`, so the original `select(.finished_at != null)` filter matched
  // nothing and every watch polled at the no-history rate. The fractional
  // seconds below guard the trap underneath it: `fromdateiso8601` rejects them,
  // so restoring the timing fields without moving the date math out of jq would
  // have swapped a silent empty result for a hard jq failure.
  test.each<{ name: string; raw: unknown[]; expected: number[] }>([
    {
      name: "measures elapsed wall time across fractional-second timestamps",
      raw: [
        {
          status: "success",
          created_at: "2026-07-30T19:00:00.123Z",
          updated_at: "2026-07-30T19:02:05.456Z",
        },
      ],
      expected: [125.333],
    },
    {
      name: "keeps failed and canceled pipelines",
      raw: [
        {
          status: "failed",
          created_at: "2026-07-30T19:00:00Z",
          updated_at: "2026-07-30T19:01:00Z",
        },
        {
          status: "canceled",
          created_at: "2026-07-30T19:00:00Z",
          updated_at: "2026-07-30T19:00:30Z",
        },
      ],
      expected: [60, 30],
    },
    {
      name: "drops skipped and manual pipelines that never ran",
      raw: [
        {
          status: "skipped",
          created_at: "2026-07-30T19:00:00Z",
          updated_at: "2026-07-30T19:00:01Z",
        },
        {
          status: "manual",
          created_at: "2026-07-30T19:00:00Z",
          updated_at: "2026-07-30T19:00:01Z",
        },
      ],
      expected: [],
    },
    {
      name: "drops still-running pipelines",
      raw: [
        {
          status: "running",
          created_at: "2026-07-30T19:00:00Z",
          updated_at: "2026-07-30T19:00:20Z",
        },
      ],
      expected: [],
    },
    {
      name: "drops entries with missing, malformed, or non-positive timing",
      raw: [
        { status: "success", created_at: "2026-07-30T19:00:00Z" },
        { status: "success", created_at: "not a date", updated_at: "2026-07-30T19:01:00Z" },
        {
          status: "success",
          created_at: "2026-07-30T19:01:00Z",
          updated_at: "2026-07-30T19:01:00Z",
        },
        null,
        "not an object",
      ],
      expected: [],
    },
  ])("$name", ({ raw, expected }) => {
    const durations = pipelineDurations(raw);
    expect(durations).toHaveLength(expected.length);
    for (const [index, seconds] of expected.entries()) {
      expect(durations[index]).toBeCloseTo(seconds, 2);
    }
  });

  test("never yields a duration the clamped interval cannot consume", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.constantFrom("success", "failed", "canceled", "skipped", "running"),
            createdMs: fc.integer({ min: 0, max: 4e12 }),
            elapsedMs: fc.integer({ min: -5000, max: 3_600_000 }),
          }),
        ),
        (entries) => {
          const raw = entries.map(({ status, createdMs, elapsedMs }) => ({
            status,
            created_at: new Date(createdMs).toISOString(),
            updated_at: new Date(createdMs + elapsedMs).toISOString(),
          }));
          const durations = pipelineDurations(raw);
          expect(durations.every((seconds) => seconds > 0)).toBe(true);
          expect(durations.length).toBeLessThanOrEqual(raw.length);
          const interval = computeInterval(durations);
          expect(interval).toBeGreaterThanOrEqual(30);
          expect(interval).toBeLessThanOrEqual(600);
        },
      ),
    );
  });
});

describe("computeInterval", () => {
  test.each<{ name: string; durations: number[]; expected: number }>([
    {
      name: "returns fast poll floor when no data (first PR on branch)",
      durations: [],
      expected: 30,
    },
    { name: "adds a 30 second buffer to the average", durations: [60, 120], expected: 120 },
    {
      name: "clamps interval to a 30 second floor for very short pipelines",
      durations: [0],
      expected: 30,
    },
    { name: "clamps to 600 seconds", durations: [1200, 1200], expected: 600 },
  ])("$name", ({ durations, expected }) => {
    expect(computeInterval(durations)).toBe(expected);
  });

  test("stays within [30, 600] and agrees with a clamped-average oracle", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0 })), (durations) => {
        const result = computeInterval(durations);
        expect(result).toBeGreaterThanOrEqual(30);
        expect(result).toBeLessThanOrEqual(600);
        const oracle =
          durations.length === 0
            ? 30
            : Math.min(
                600,
                Math.max(
                  30,
                  Math.round(durations.reduce((a, b) => a + b, 0) / durations.length + 30),
                ),
              );
        expect(result).toBe(oracle);
      }),
    );
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
    state = r4.state;
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

describe("api-error tracking", () => {
  it("increments on failure and emits at threshold", () => {
    let state = initialState();
    let events: { type: string }[] = [];
    for (let i = 0; i < 4; i += 1) {
      const outcome = registerApiError(state, 5);
      state = outcome.state;
      events = outcome.events;
      expect(events).toEqual([]);
    }
    const final = registerApiError(state, 5);
    expect(final.events).toContainEqual({ type: "api-error", consecutive: 5 });
  });

  it("resets on success", () => {
    let state = initialState();
    for (let i = 0; i < 3; i += 1) {
      state = registerApiError(state, 5).state;
    }
    expect(state.apiErrorCount).toBe(3);
    state = clearApiErrors(state);
    expect(state.apiErrorCount).toBe(0);
    expect(state.apiErrorEmittedAt).toBeNull();
  });

  it("does not re-emit for the same consecutive count", () => {
    let state = initialState();
    for (let i = 0; i < 5; i += 1) {
      state = registerApiError(state, 5).state;
    }
    const again = registerApiError(state, 5);
    expect(again.events.some((e) => e.type === "api-error" && e.consecutive === 5)).toBe(false);
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

describe("resolveMergeStatus", () => {
  const mrJson = (fields: Record<string, unknown>): string => JSON.stringify(fields);

  it("resolves to a conflict once a re-poll settles merge status", async () => {
    const { exec, remaining } = makeExec([
      { match: "merge_requests/7", result: ok(mrJson({ merge_status: "checking" })) },
      {
        match: "merge_requests/7",
        result: ok(
          mrJson({
            merge_status: "cannot_be_merged",
            detailed_merge_status: "conflict",
            has_conflicts: true,
          }),
        ),
      },
    ]);
    const resolved = await resolveMergeStatus("group%2Fproject", 7, exec, noopSleep);
    expect(resolved).toEqual({
      hasConflicts: true,
      mergeStatus: "cannot_be_merged",
      detailedMergeStatus: "conflict",
    });
    expect(remaining()).toEqual([]);
  });

  it("returns undetermined after exhausting the retry budget", async () => {
    const scripted = Array.from({ length: 4 }, () => ({
      match: "merge_requests/7",
      result: ok(mrJson({ merge_status: "unchecked", detailed_merge_status: "checking" })),
    }));
    const { exec, remaining } = makeExec(scripted);
    const resolved = await resolveMergeStatus("group%2Fproject", 7, exec, noopSleep);
    expect(resolved).toEqual({
      hasConflicts: false,
      mergeStatus: "unchecked",
      detailedMergeStatus: "checking",
    });
    expect(remaining()).toEqual([]);
  });
});

describe("parsePipelineList", () => {
  test.each<{ name: string; raw: unknown; expected: PipelineRecord[] | null }>([
    {
      name: "returns null for a non-array body",
      raw: { message: "403 Forbidden" },
      expected: null,
    },
    { name: "returns null for a null body", raw: null, expected: null },
    { name: "returns an empty list for an empty array", raw: [], expected: [] },
    {
      name: "parses numeric and string ids alike",
      raw: [
        { id: 10, status: "success", sha: "abc", source: "push" },
        { id: "11", status: "failed", sha: "def", source: "merge_request_event" },
      ],
      expected: [
        { id: 10, status: "success", sha: "abc", source: "push" },
        { id: 11, status: "failing", sha: "def", source: "merge_request_event" },
      ],
    },
    {
      name: "drops entries without a usable id",
      raw: [{ status: "success" }, { id: null }, { id: "not-a-number" }, { id: "" }, { id: 12 }],
      expected: [{ id: 12, status: "running", sha: "", source: "" }],
    },
    {
      name: "defaults a missing sha and source to empty strings",
      raw: [{ id: 13, status: "running" }],
      expected: [{ id: 13, status: "running", sha: "", source: "" }],
    },
  ])("$name", ({ raw, expected }) => {
    expect(parsePipelineList(raw)).toEqual(expected);
  });
});

describe("selectPipeline", () => {
  test.each<{
    name: string;
    records: PipelineRecord[];
    prefer: "merge-request" | "branch";
    expectedId: number | null;
  }>([
    {
      name: "ignores a newer external success in favour of the MR pipeline",
      records: [
        makeRecord({ id: 200, status: "success", source: "external" }),
        makeRecord({ id: 199, status: "failing", source: "merge_request_event" }),
      ],
      prefer: "merge-request",
      expectedId: 199,
    },
    {
      name: "prefers a running MR pipeline over a newer skipped push pipeline",
      records: [
        makeRecord({ id: 300, status: "success", source: "push" }),
        makeRecord({ id: 299, status: "running", source: "merge_request_event" }),
      ],
      prefer: "merge-request",
      expectedId: 299,
    },
    {
      name: "prefers the push pipeline in branch mode when both kinds are present",
      records: [
        makeRecord({ id: 300, status: "success", source: "push" }),
        makeRecord({ id: 299, status: "running", source: "merge_request_event" }),
      ],
      prefer: "branch",
      expectedId: 300,
    },
    {
      name: "ignores parent_pipeline children whose status the parent aggregates",
      records: [
        makeRecord({ id: 400, status: "success", source: "parent_pipeline" }),
        makeRecord({ id: 398, status: "failing", source: "merge_request_event" }),
      ],
      prefer: "merge-request",
      expectedId: 398,
    },
    {
      name: "returns null when every candidate has an excluded source",
      records: [
        makeRecord({ id: 500, source: "external" }),
        makeRecord({ id: 501, source: "parent_pipeline" }),
      ],
      prefer: "merge-request",
      expectedId: null,
    },
    { name: "returns null for an empty list", records: [], prefer: "branch", expectedId: null },
    {
      name: "falls back to branch pipelines in MR mode when the project runs none",
      records: [makeRecord({ id: 600, source: "push" }), makeRecord({ id: 601, source: "web" })],
      prefer: "merge-request",
      expectedId: 601,
    },
    {
      name: "falls back to MR pipelines in branch mode when the project runs none",
      records: [
        makeRecord({ id: 700, source: "merge_request_event" }),
        makeRecord({ id: 701, source: "merge_request_event" }),
      ],
      prefer: "branch",
      expectedId: 701,
    },
    {
      name: "orders single-digit against double-digit ids numerically",
      records: [makeRecord({ id: 9, source: "push" }), makeRecord({ id: 10, source: "push" })],
      prefer: "branch",
      expectedId: 10,
    },
    {
      name: "orders realistic ten-digit ids numerically",
      records: [
        makeRecord({ id: 2712763426, source: "push" }),
        makeRecord({ id: 2712702628, source: "push" }),
      ],
      prefer: "branch",
      expectedId: 2712763426,
    },
  ])("$name", ({ records, prefer, expectedId }) => {
    expect(selectPipeline(records, prefer)?.id ?? null).toBe(expectedId);
  });

  const pipelineRecord = fc.record<PipelineRecord>({
    id: fc.integer({ min: 1, max: 3_000_000_000 }),
    status: fc.constantFrom<InternalState>("running", "queued", "failing", "success"),
    sha: fc.string(),
    source: fc.constantFrom(
      "push",
      "merge_request_event",
      "external",
      "parent_pipeline",
      "web",
      "schedule",
    ),
  });

  test("picks an input record that is eligible and highest-id within its partition", () => {
    fc.assert(
      fc.property(
        fc.array(pipelineRecord),
        fc.constantFrom<"merge-request" | "branch">("merge-request", "branch"),
        (records, prefer) => {
          const selected = selectPipeline(records, prefer);
          const eligible = records.filter(
            (record) => record.source !== "external" && record.source !== "parent_pipeline",
          );
          if (eligible.length === 0) {
            expect(selected).toBeNull();
            return;
          }
          expect(selected).not.toBeNull();
          if (!selected) return;
          expect(records).toContain(selected);
          const isMergeRequest = (record: PipelineRecord) =>
            record.source === "merge_request_event";
          const preferred = eligible.filter((record) =>
            prefer === "merge-request" ? isMergeRequest(record) : !isMergeRequest(record),
          );
          if (preferred.length > 0) {
            expect(preferred).toContain(selected);
          }
          const partition = eligible.filter(
            (record) => isMergeRequest(record) === isMergeRequest(selected),
          );
          expect(selected.id).toBe(Math.max(...partition.map((record) => record.id)));
        },
      ),
    );
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

describe("probe pipeline selection", () => {
  const mrJson = JSON.stringify({
    sha: "head-sha",
    source_branch: "feature",
    merge_status: "can_be_merged",
    detailed_merge_status: "mergeable",
    state: "opened",
  });

  const pipelinesJson = (records: Record<string, unknown>[]): string => JSON.stringify(records);

  // Regression: an `external` pipeline is a commit status posted by another tool.
  // It is created green and carries no jobs, and because it is created last it
  // wins any newest-first selection. Resolving the MR's pipeline by that ordering
  // reported success while the real CI run was red, so the watcher exited green
  // on a failing MR.
  it("reports failing when an external success outranks the real MR pipeline", () => {
    const { exec } = makeExec([
      { match: "merge_requests/7", result: ok(mrJson) },
      {
        match: "merge_requests/7/pipelines",
        result: ok(
          pipelinesJson([
            { id: 902, status: "success", sha: "head-sha", source: "external" },
            { id: 901, status: "failed", sha: "merge-sha", source: "merge_request_event" },
          ]),
        ),
      },
    ]);
    const probed = probeMr("group%2Fproject", 7, exec);
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;
    expect(probed.probe.state).toBe("failing");
    expect(probed.probe.runId).toBe("901");
    expect(probed.probe.sha).toBe("head-sha");
  });

  it("downgrades a claimed success when a required job failed", () => {
    const { exec } = makeExec([
      { match: "merge_requests/7", result: ok(mrJson) },
      {
        match: "merge_requests/7/pipelines",
        result: ok(
          pipelinesJson([{ id: 901, status: "success", sha: "s", source: "merge_request_event" }]),
        ),
      },
      {
        match: "pipelines/901/jobs",
        result: ok(
          JSON.stringify([
            { name: "build", status: "success", allow_failure: false },
            { name: "rspec", status: "failed", allow_failure: false },
          ]),
        ),
      },
    ]);
    const probed = probeMr("group%2Fproject", 7, exec);
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;
    expect(probed.probe.state).toBe("failing");
    expect(probed.probe.runId).toBe("901");
  });

  it("confirms a success against the jobs endpoint with exactly one extra call", () => {
    const { exec, remaining } = makeExec([
      { match: "merge_requests/7", result: ok(mrJson) },
      {
        match: "merge_requests/7/pipelines",
        result: ok(
          pipelinesJson([{ id: 901, status: "success", sha: "s", source: "merge_request_event" }]),
        ),
      },
      {
        match: "pipelines/901/jobs",
        result: ok(JSON.stringify([{ name: "build", status: "success", allow_failure: false }])),
      },
    ]);
    const probed = probeMr("group%2Fproject", 7, exec);
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;
    expect(probed.probe.state).toBe("success");
    expect(remaining()).toEqual([]);
  });

  it("fails the probe rather than emitting a success it could not confirm", () => {
    const { exec } = makeExec([
      { match: "merge_requests/7", result: ok(mrJson) },
      {
        match: "merge_requests/7/pipelines",
        result: ok(
          pipelinesJson([{ id: 901, status: "success", sha: "s", source: "merge_request_event" }]),
        ),
      },
      { match: "pipelines/901/jobs", result: fail("HTTP 500") },
    ]);
    expect(probeMr("group%2Fproject", 7, exec).ok).toBe(false);
  });

  it("keeps polling when every pipeline on the page is excluded", () => {
    const { exec } = makeExec([
      { match: "merge_requests/7", result: ok(mrJson) },
      {
        match: "merge_requests/7/pipelines",
        result: ok(pipelinesJson([{ id: 902, status: "success", sha: "s", source: "external" }])),
      },
    ]);
    const probed = probeMr("group%2Fproject", 7, exec);
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;
    expect(probed.probe.runId).toBeNull();
    expect(probed.probe.state).toBe("running");
  });

  it("applies the job gate in pipeline-id mode as well", () => {
    const { exec, remaining } = makeExec([
      {
        match: "pipelines/901'",
        result: ok(JSON.stringify({ id: 901, status: "success", sha: "s" })),
      },
      {
        match: "pipelines/901/jobs",
        result: ok(JSON.stringify([{ name: "rspec", status: "failed", allow_failure: false }])),
      },
    ]);
    const probed = probePipelineId("group%2Fproject", "901", exec);
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;
    expect(probed.probe.state).toBe("failing");
    expect(remaining()).toEqual([]);
  });

  it("ignores an external success in branch mode too", () => {
    const { exec } = makeExec([
      {
        match: "pipelines?ref=main",
        result: ok(
          pipelinesJson([
            { id: 902, status: "success", sha: "a", source: "external" },
            { id: 901, status: "failed", sha: "b", source: "push" },
          ]),
        ),
      },
    ]);
    const probed = probeBranch("group%2Fproject", "main", exec);
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;
    expect(probed.probe.state).toBe("failing");
    expect(probed.probe.runId).toBe("901");
    expect(probed.probe.sha).toBe("b");
  });
});
