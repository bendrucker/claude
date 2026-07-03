import { describe, expect, it, test } from "bun:test";
import fc from "fast-check";
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
  normalizePipelineStatus,
  type Probe,
  parseMrUrl,
  parseProject,
  registerApiError,
  resolveMergeStatus,
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
function makeExec(scripted: Array<{ match: string; result: ExecResult }>): {
  exec: ExecFn;
  remaining: () => Array<{ match: string; result: ExecResult }>;
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
const noopSleep = (): Promise<void> => Promise.resolve();

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
    sequence.forEach((probe, i) => {
      const outcome = deriveEvents(probe, state, i * minute, 15);
      state = outcome.state;
      allEvents.push(...outcome.events);
    });

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
    sequence.forEach((probe, i) => {
      const outcome = deriveEvents(probe, state, i * minute, 15);
      state = outcome.state;
      allEvents.push(...outcome.events);
    });

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
    sequence.forEach((probe, i) => {
      const outcome = deriveEvents(probe, state, i * minute, 15);
      state = outcome.state;
      allEvents.push(...outcome.events);
    });

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
