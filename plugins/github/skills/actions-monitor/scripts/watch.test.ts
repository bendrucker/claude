import { describe, expect, it, test } from "bun:test";
import {
  AttributionRun,
  clearApiErrors,
  computeInterval,
  deriveChecksState,
  deriveEvents,
  deriveRunListState,
  type Event,
  type ExecFn,
  type ExecResult,
  type InternalState,
  initialState,
  type Probe,
  parsePrUrl,
  parseRepo,
  probeBranch,
  probePr,
  probeRunId,
  registerApiError,
  resolveMergeable,
  selectRunId,
  type WatcherState,
} from "./watch";

const noopSleep = (): Promise<void> => Promise.resolve();

// Stub `exec` for probe* tests. Each entry maps a substring matcher (anything
// the gh command line should contain) to a canned result. Tests assert that
// commands are issued in the expected order by exhausting the array.
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
const err = (stderr: string): ExecResult => ({
  ok: false,
  stderr,
  rateLimited: false,
  retryAfter: "",
});

function baseProbe(overrides: Partial<Probe> = {}): Probe {
  return {
    sha: "abc123",
    state: "running",
    runId: "run-1",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    prState: "OPEN",
    ...overrides,
  };
}

function advance(
  probes: Array<{ probe: Probe; now?: number }>,
  opts: { queuedTimeoutMinutes?: number; initial?: WatcherState } = {},
): { events: Event[]; state: WatcherState } {
  const queuedTimeoutMinutes = opts.queuedTimeoutMinutes ?? 15;
  let state = opts.initial ?? initialState();
  const events: Event[] = [];
  let step = 0;
  for (const { probe, now } of probes) {
    step += 1;
    const t = now ?? step * 1000;
    const out = deriveEvents(probe, state, t, queuedTimeoutMinutes);
    events.push(...out.events);
    state = out.state;
  }
  return { events, state };
}

describe("parsePrUrl", () => {
  it("parses a well-formed PR URL", () => {
    const parsed = parsePrUrl("https://github.com/bendrucker/deployments/pull/42");
    expect(parsed).toEqual({ owner: "bendrucker", repo: "deployments", number: 42 });
  });

  it("handles trailing segments", () => {
    const parsed = parsePrUrl("https://github.com/owner/repo/pull/7/files");
    expect(parsed).toEqual({ owner: "owner", repo: "repo", number: 7 });
  });

  it("throws on invalid URL", () => {
    expect(() => parsePrUrl("https://github.com/owner/repo/issues/5")).toThrow();
  });
});

// `gh pr checks --json state,bucket,name` shapes (verified against gh CLI):
//   - completed pass:    { state: "SUCCESS",     bucket: "pass" }
//   - completed skip:    { state: "SKIPPED",     bucket: "skipping" }
//   - completed fail:    { state: "FAILURE",     bucket: "fail" }
//   - cancelled:         { state: "CANCELLED",   bucket: "cancel" }
//   - in flight:         { state: "IN_PROGRESS", bucket: "pending" }
//   - queued (action):   { state: "QUEUED",      bucket: "pending" }
//   - pending (status):  { state: "PENDING",     bucket: "pending" }
describe("deriveChecksState", () => {
  test.each<[string, Array<{ state: string; bucket: string; name: string }>, InternalState]>([
    ["empty checks", [], "running"],
    [
      "any check in fail bucket",
      [
        { state: "SUCCESS", bucket: "pass", name: "a" },
        { state: "FAILURE", bucket: "fail", name: "b" },
      ],
      "failing",
    ],
    // A cancelled check is not a failure, but GitHub does not count it as
    // passing either, so calling the PR green here exits the watcher on a PR
    // branch protection still blocks.
    [
      "a cancelled check alongside passing checks",
      [
        { state: "SUCCESS", bucket: "pass", name: "a" },
        { state: "CANCELLED", bucket: "cancel", name: "b" },
      ],
      "running",
    ],
    [
      "a skipped check alongside passing checks",
      [
        { state: "SUCCESS", bucket: "pass", name: "a" },
        { state: "SKIPPED", bucket: "skipping", name: "b" },
      ],
      "success",
    ],
    [
      "skipped and cancelled checks alongside an in-flight check",
      [
        { state: "SKIPPED", bucket: "skipping", name: "a" },
        { state: "CANCELLED", bucket: "cancel", name: "b" },
        { state: "IN_PROGRESS", bucket: "pending", name: "c" },
      ],
      "running",
    ],
    [
      "skipped and cancelled checks alongside a failing check",
      [
        { state: "SKIPPED", bucket: "skipping", name: "a" },
        { state: "CANCELLED", bucket: "cancel", name: "b" },
        { state: "FAILURE", bucket: "fail", name: "c" },
      ],
      "failing",
    ],
    [
      "every check skipped or cancelled",
      [
        { state: "SKIPPED", bucket: "skipping", name: "a" },
        { state: "CANCELLED", bucket: "cancel", name: "b" },
      ],
      "running",
    ],
    // Reached both by a PR whose every check really is skipped and by one
    // polled in the seconds after a push, before its real jobs register. A
    // single probe cannot separate the two, so neither resolves to success.
    [
      "every check skipped",
      [
        { state: "SKIPPED", bucket: "skipping", name: "a" },
        { state: "SKIPPED", bucket: "skipping", name: "b" },
      ],
      "queued",
    ],
    // Shape captured from a green PR whose automerge and claude workflows are
    // skipped on every push. Skipped workflows are routine, so a skip that
    // counts against the PR turns every such PR permanently failing.
    [
      "captured green payload with skipped automerge and claude workflows",
      [
        { state: "SUCCESS", bucket: "pass", name: "lint" },
        { state: "SKIPPED", bucket: "skipping", name: "claude" },
        { state: "SUCCESS", bucket: "pass", name: "build" },
        { state: "SKIPPED", bucket: "skipping", name: "automerge" },
      ],
      "success",
    ],
    [
      "any check is IN_PROGRESS",
      [
        { state: "IN_PROGRESS", bucket: "pending", name: "a" },
        { state: "QUEUED", bucket: "pending", name: "b" },
      ],
      "running",
    ],
    [
      "all checks are queued",
      [
        { state: "QUEUED", bucket: "pending", name: "a" },
        { state: "QUEUED", bucket: "pending", name: "b" },
      ],
      "queued",
    ],
    [
      "some checks queued and others have completed",
      [
        { state: "QUEUED", bucket: "pending", name: "a" },
        { state: "SUCCESS", bucket: "pass", name: "b" },
      ],
      "running",
    ],
    // Exact shape captured from `gh pr checks <num> --json state,bucket,name`
    // against a fully-green PR. If this assertion ever flips back to "running"
    // it means deriveChecksState has drifted from gh's actual JSON schema —
    // the same drift that caused the silent-hang on initial-green PRs.
    [
      "canonical all-green payload (regression: bucket+state schema)",
      [
        { bucket: "pass", name: "plugins", state: "SUCCESS" },
        { bucket: "pass", name: "lint", state: "SUCCESS" },
        { bucket: "pass", name: "build", state: "SUCCESS" },
        { bucket: "pass", name: "hooks", state: "SUCCESS" },
        { bucket: "pass", name: "validate", state: "SUCCESS" },
      ],
      "success",
    ],
  ])("%s -> %s", (_name, checks, expected) => {
    expect(deriveChecksState(checks)).toBe(expected);
  });
});

describe("deriveEvents transitions", () => {
  it("emits status for running -> failing -> running -> success", () => {
    const sequence = [
      { probe: baseProbe({ state: "running", sha: "s1" }) },
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
      { probe: baseProbe({ state: "running", sha: "s2" }) },
      { probe: baseProbe({ state: "success", sha: "s2" }) },
    ];
    const { events } = advance(sequence);
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses).toHaveLength(4);
    expect(statuses[0]).toMatchObject({ state: "running", sha: "s1" });
    expect(statuses[1]).toMatchObject({ state: "failing", sha: "s1" });
    expect(statuses[2]).toMatchObject({ state: "running", sha: "s2" });
    expect(statuses[3]).toMatchObject({ state: "success", sha: "s2" });
  });

  it("dedups repeated failing probes at same (sha, state)", () => {
    const sequence = [
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
    ];
    const { events } = advance(sequence);
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses).toHaveLength(1);
  });

  it("emits new status event when SHA changes but state unchanged", () => {
    const sequence = [
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
      { probe: baseProbe({ state: "failing", sha: "s2" }) },
    ];
    const { events } = advance(sequence);
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses).toHaveLength(2);
    expect(statuses[1]).toMatchObject({ state: "failing", sha: "s2" });
  });

  it("maps internal queued state to running on emission", () => {
    const { events } = advance([{ probe: baseProbe({ state: "queued", sha: "s1" }) }]);
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ state: "running", sha: "s1" });
  });

  it("first probe success emits status:success (initial-green path)", () => {
    const { events } = advance([{ probe: baseProbe({ state: "success", sha: "s1" }) }]);
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ state: "success", sha: "s1" });
  });
});

describe("queued-timeout", () => {
  it("emits queued-timeout once threshold is exceeded", () => {
    const first = deriveEvents(baseProbe({ state: "queued", sha: "s1" }), initialState(), 0, 15);
    expect(first.events.find((e) => e.type === "queued-timeout")).toBeUndefined();

    const second = deriveEvents(
      baseProbe({ state: "queued", sha: "s1" }),
      first.state,
      15 * 60 * 1000,
      15,
    );
    const timeout = second.events.find((e) => e.type === "queued-timeout");
    expect(timeout).toMatchObject({ type: "queued-timeout", minutes: 15 });

    const third = deriveEvents(
      baseProbe({ state: "queued", sha: "s1" }),
      second.state,
      30 * 60 * 1000,
      15,
    );
    expect(third.events.find((e) => e.type === "queued-timeout")).toBeUndefined();
  });

  it("resets queued timer when state transitions back to running", () => {
    const queued = deriveEvents(baseProbe({ state: "queued", sha: "s1" }), initialState(), 0, 15);
    const running = deriveEvents(
      baseProbe({ state: "running", sha: "s1" }),
      queued.state,
      5 * 60 * 1000,
      15,
    );
    expect(running.state.queuedSince).toBeNull();
    expect(running.state.queuedTimeoutEmitted).toBe(false);
  });
});

describe("api-error threshold", () => {
  it("emits api-error when consecutive errors reach threshold", () => {
    let state = initialState();
    const threshold = 3;
    const emitted: Event[] = [];
    for (let i = 0; i < threshold; i += 1) {
      const out = registerApiError(state, threshold);
      state = out.state;
      emitted.push(...out.events);
    }
    const errors = emitted.filter((e) => e.type === "api-error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ type: "api-error", consecutive: 3 });
  });

  it("a success clears the api error counter", () => {
    let state = initialState();
    const threshold = 3;
    for (let i = 0; i < 2; i += 1) {
      state = registerApiError(state, threshold).state;
    }
    expect(state.apiErrorCount).toBe(2);
    state = clearApiErrors(state);
    expect(state.apiErrorCount).toBe(0);
  });
});

describe("conflicts", () => {
  it("emits conflicts once per SHA", () => {
    const sequence = [
      { probe: baseProbe({ sha: "s1", mergeable: "CONFLICTING" }) },
      { probe: baseProbe({ sha: "s1", mergeable: "CONFLICTING" }) },
    ];
    const { events } = advance(sequence);
    const conflicts = events.filter((e) => e.type === "conflicts");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ sha: "s1" });
  });

  it("re-emits conflicts when SHA changes", () => {
    const sequence = [
      { probe: baseProbe({ sha: "s1", mergeable: "CONFLICTING" }) },
      { probe: baseProbe({ sha: "s2", mergeable: "CONFLICTING" }) },
    ];
    const { events } = advance(sequence);
    const conflicts = events.filter((e) => e.type === "conflicts");
    expect(conflicts).toHaveLength(2);
  });

  it("emits conflicts when mergeStateStatus is DIRTY even if mergeable lags UNKNOWN", () => {
    const { events } = advance([
      { probe: baseProbe({ sha: "s1", mergeable: "UNKNOWN", mergeStateStatus: "DIRTY" }) },
    ]);
    const conflicts = events.filter((e) => e.type === "conflicts");
    expect(conflicts).toHaveLength(1);
    expect(events.some((e) => e.type === "mergeable-unknown")).toBe(false);
  });

  it("emits both status:success and conflicts in one cycle on a green conflicting probe", () => {
    const { events } = advance([
      { probe: baseProbe({ sha: "s1", state: "success", mergeable: "CONFLICTING" }) },
    ]);
    expect(events.some((e) => e.type === "status" && e.state === "success")).toBe(true);
    expect(events.some((e) => e.type === "conflicts" && e.sha === "s1")).toBe(true);
  });
});

describe("mergeable-unknown", () => {
  it("emits mergeable-unknown once per SHA when undetermined", () => {
    const sequence = [
      { probe: baseProbe({ sha: "s1", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }) },
      { probe: baseProbe({ sha: "s1", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }) },
    ];
    const { events } = advance(sequence);
    const unknowns = events.filter((e) => e.type === "mergeable-unknown");
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0]).toMatchObject({ sha: "s1" });
    expect(events.some((e) => e.type === "conflicts")).toBe(false);
  });

  it("re-emits mergeable-unknown when the SHA changes", () => {
    const sequence = [
      { probe: baseProbe({ sha: "s1", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }) },
      { probe: baseProbe({ sha: "s2", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }) },
    ];
    const { events } = advance(sequence);
    expect(events.filter((e) => e.type === "mergeable-unknown")).toHaveLength(2);
  });

  it("does not emit mergeable-unknown once mergeability resolves to a definite value", () => {
    const sequence = [
      { probe: baseProbe({ sha: "s1", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }) },
      { probe: baseProbe({ sha: "s1", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }) },
    ];
    const { events } = advance(sequence);
    expect(events.filter((e) => e.type === "mergeable-unknown")).toHaveLength(1);
  });
});

describe("resolveMergeable", () => {
  const mergeJson = (mergeable: string, mergeStateStatus: string): string =>
    JSON.stringify({ mergeable, mergeStateStatus });

  it("resolves to CONFLICTING once a re-poll returns a definite value", async () => {
    const { exec, remaining } = makeExec([
      { match: "gh pr view 42", result: ok(mergeJson("UNKNOWN", "UNKNOWN")) },
      { match: "gh pr view 42", result: ok(mergeJson("CONFLICTING", "DIRTY")) },
    ]);
    const resolved = await resolveMergeable(42, "owner/repo", exec, noopSleep);
    expect(resolved).toEqual({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });
    expect(remaining()).toEqual([]);
  });

  it("returns undetermined after exhausting the retry budget", async () => {
    const scripted = Array.from({ length: 4 }, () => ({
      match: "gh pr view 42",
      result: ok(mergeJson("UNKNOWN", "UNKNOWN")),
    }));
    const { exec, remaining } = makeExec(scripted);
    const resolved = await resolveMergeable(42, "owner/repo", exec, noopSleep);
    expect(resolved).toEqual({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" });
    expect(remaining()).toEqual([]);
  });
});

describe("merged", () => {
  it("emits merged (not pr-closed) for MERGED state", () => {
    const { events } = advance([{ probe: baseProbe({ prState: "MERGED" }) }]);
    expect(events.find((e) => e.type === "merged")).toBeDefined();
    expect(events.find((e) => e.type === "pr-closed")).toBeUndefined();
  });

  it("emits status:success before merged when merged with success checks and lastState not success", () => {
    const { events } = advance([
      { probe: baseProbe({ prState: "MERGED", state: "success", sha: "s1" }) },
    ]);
    const statusIdx = events.findIndex((e) => e.type === "status");
    const mergedIdx = events.findIndex((e) => e.type === "merged");
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(events[statusIdx]).toMatchObject({ type: "status", state: "success", sha: "s1" });
    expect(mergedIdx).toBeGreaterThan(statusIdx);
  });

  it("emits only merged when merged with success checks and lastState already success", () => {
    const initial: WatcherState = { ...initialState(), lastState: "success", lastSha: "s1" };
    const { events } = advance(
      [{ probe: baseProbe({ prState: "MERGED", state: "success", sha: "s1" }) }],
      { initial },
    );
    expect(events).toEqual([{ type: "merged" }]);
  });

  it("emits only merged when merged with failing checks (no false success)", () => {
    const { events } = advance([
      { probe: baseProbe({ prState: "MERGED", state: "failing", sha: "s1" }) },
    ]);
    expect(events.find((e) => e.type === "status")).toBeUndefined();
    expect(events.find((e) => e.type === "merged")).toBeDefined();
  });
});

describe("pr-closed", () => {
  it("emits pr-closed (not merged) for CLOSED state", () => {
    const { events } = advance([{ probe: baseProbe({ prState: "CLOSED" }) }]);
    expect(events.find((e) => e.type === "pr-closed")).toBeDefined();
    expect(events.find((e) => e.type === "merged")).toBeUndefined();
  });

  it("emits status:success before pr-closed when closed with success checks and lastState not success", () => {
    const { events } = advance([
      { probe: baseProbe({ prState: "CLOSED", state: "success", sha: "s1" }) },
    ]);
    const statusIdx = events.findIndex((e) => e.type === "status");
    const closedIdx = events.findIndex((e) => e.type === "pr-closed");
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(events[statusIdx]).toMatchObject({ type: "status", state: "success", sha: "s1" });
    expect(closedIdx).toBeGreaterThan(statusIdx);
  });
});

describe("computeInterval", () => {
  test.each<[number[], number]>([
    [[], 30],
    [[10, 10, 10], 40],
    [[1000, 1000, 1000], 600],
  ])("computeInterval(%p) -> %p", (durations, expected) => {
    expect(computeInterval(durations)).toBe(expected);
  });
});

describe("parseRepo", () => {
  test.each<[string, { owner: string; repo: string } | null]>([
    ["https://github.com/bendrucker/deployments", { owner: "bendrucker", repo: "deployments" }],
    ["https://github.com/bendrucker/deployments.git", { owner: "bendrucker", repo: "deployments" }],
    ["git@github.com:bendrucker/deployments.git", { owner: "bendrucker", repo: "deployments" }],
    ["git@github.com:bendrucker/deployments", { owner: "bendrucker", repo: "deployments" }],
    [
      "ssh://git@github.com/bendrucker/deployments.git",
      { owner: "bendrucker", repo: "deployments" },
    ],
    ["  https://github.com/owner/repo.git\n", { owner: "owner", repo: "repo" }],
    ["https://gitlab.com/owner/repo", null],
    ["", null],
  ])("parses %p", (url, expected) => {
    expect(parseRepo(url)).toEqual(expected);
  });
});

describe("selectRunId", () => {
  // A failing event names the run `github:logs` fetches. Naming a run that did
  // not fail spends a dispatch on a run with no failing jobs to report.
  const run = (
    databaseId: number,
    conclusion: string,
    workflowDatabaseId: number,
    createdAt = "2026-08-28T00:00:00Z",
    headSha = "sha-head",
  ) => AttributionRun.parse({ databaseId, headSha, conclusion, workflowDatabaseId, createdAt });

  test.each<[string, AttributionRun[], string | null]>([
    [
      "picks the failed run past skipped and cancelled ones",
      [run(1, "skipped", 10), run(2, "cancelled", 20), run(3, "failure", 30)],
      "3",
    ],
    ["skipped run alone", [run(1, "skipped", 10)], null],
    ["cancelled run alone", [run(1, "cancelled", 10)], null],
    ["run still awaiting approval", [run(1, "action_required", 10)], null],
    ["every run green (the red check is not an Actions run)", [run(1, "success", 10)], null],
    ["a timed-out run", [run(1, "timed_out", 10)], "1"],
    [
      "a failure a later run of the same workflow replaced",
      [run(2, "success", 10, "2026-08-28T02:00:00Z"), run(1, "failure", 10)],
      null,
    ],
    [
      "another workflow's live failure past a workflow that re-ran green",
      [run(3, "success", 10, "2026-08-28T02:00:00Z"), run(2, "failure", 20), run(1, "failure", 10)],
      "2",
    ],
    [
      "a re-run listed before the older attempt it replaced",
      [run(1, "failure", 10), run(2, "success", 10, "2026-08-28T02:00:00Z")],
      null,
    ],
    ["runs from another commit", [run(1, "failure", 10, undefined, "sha-other")], null],
  ])("%s -> %p", (_name, runs, expected) => {
    expect(selectRunId(runs, "sha-head")).toBe(expected);
  });
});

describe("deriveRunListState", () => {
  test.each<[string, string, InternalState]>([
    ["completed", "failure", "failing"],
    ["completed", "cancelled", "failing"],
    ["completed", "timed_out", "failing"],
    ["completed", "success", "success"],
    ["completed", "neutral", "success"],
    ["completed", "skipped", "success"],
    ["in_progress", "", "running"],
    ["queued", "", "queued"],
    ["waiting", "", "queued"],
    ["pending", "", "queued"],
    ["wat", "", "running"],
  ])("maps status=%p conclusion=%p to %p", (status, conclusion, expected) => {
    expect(deriveRunListState({ status, conclusion })).toBe(expected);
  });

  it("falls back to running on empty input", () => {
    expect(deriveRunListState({})).toBe("running");
  });
});

describe("deriveEvents branch-mode probes", () => {
  it("never emits conflicts for branch-mode probes (MERGEABLE)", () => {
    const { events } = advance([
      { probe: baseProbe({ state: "running", sha: "s1" }) },
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
      { probe: baseProbe({ state: "running", sha: "s2" }) },
      { probe: baseProbe({ state: "success", sha: "s2" }) },
    ]);
    expect(events.find((e) => e.type === "conflicts")).toBeUndefined();
  });

  it("never emits pr-closed for branch-mode probes (prState=OPEN)", () => {
    const { events } = advance([
      { probe: baseProbe({ state: "running", sha: "s1" }) },
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
      { probe: baseProbe({ state: "success", sha: "s1" }) },
    ]);
    expect(events.find((e) => e.type === "pr-closed")).toBeUndefined();
  });

  it("still emits status transitions in branch mode", () => {
    const { events } = advance([
      { probe: baseProbe({ state: "running", sha: "s1" }) },
      { probe: baseProbe({ state: "failing", sha: "s1" }) },
      { probe: baseProbe({ state: "success", sha: "s2" }) },
    ]);
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses).toHaveLength(3);
    expect(statuses[2]).toMatchObject({ state: "success", sha: "s2" });
  });
});

describe("deriveEvents run-id mode", () => {
  it("never emits conflicts or pr-closed through a successful sequence", () => {
    const { events } = advance([
      { probe: baseProbe({ state: "queued", sha: "s1", runId: "1001" }) },
      { probe: baseProbe({ state: "running", sha: "s1", runId: "1001" }) },
      { probe: baseProbe({ state: "running", sha: "s1", runId: "1001" }) },
      { probe: baseProbe({ state: "success", sha: "s1", runId: "1001" }) },
    ]);
    expect(events.find((e) => e.type === "conflicts")).toBeUndefined();
    expect(events.find((e) => e.type === "pr-closed")).toBeUndefined();
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses[statuses.length - 1]).toMatchObject({
      state: "success",
      sha: "s1",
    });
  });

  it("emits a status:failing event on running -> failing transition", () => {
    const { events } = advance([
      { probe: baseProbe({ state: "running", sha: "s1", runId: "1001" }) },
      { probe: baseProbe({ state: "failing", sha: "s1", runId: "1001" }) },
    ]);
    const statuses = events.filter((e) => e.type === "status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ state: "running", sha: "s1" });
    expect(statuses[1]).toMatchObject({ state: "failing", sha: "s1" });
  });

  it("carries run_id through status events unchanged", () => {
    const { events } = advance([
      { probe: baseProbe({ state: "running", sha: "s1", runId: "42" }) },
      { probe: baseProbe({ state: "failing", sha: "s1", runId: "42" }) },
    ]);
    const statuses = events.filter((e) => e.type === "status");
    for (const s of statuses) {
      expect(s).toMatchObject({ run_id: "42" });
    }
  });
});

// End-to-end probe* tests that exercise the full gh-output → probe pipeline.
// These exist because the previous unit tests only fed hand-rolled fictional
// payloads (`{ state: "COMPLETED", conclusion: "success" }`) to
// deriveChecksState in isolation — they never validated that probe* actually
// requested fields gh exposes, or that gh's real JSON shape parses cleanly
// into the success/failing/queued/running classification. That blind spot
// caused watch.ts to silently retry for ~15 minutes against any green PR
// because it asked gh for a non-existent `conclusion` field.
describe("probePr (gh schema integration)", () => {
  const prJson = JSON.stringify({
    headRefOid: "abc123",
    headRefName: "feature/x",
    state: "OPEN",
    mergeable: "MERGEABLE",
  });

  it("emits state=success when gh pr checks reports all-pass buckets", () => {
    const checksJson = JSON.stringify([
      { state: "SUCCESS", bucket: "pass", name: "lint" },
      { state: "SUCCESS", bucket: "pass", name: "build" },
      { state: "SKIPPED", bucket: "skipping", name: "docs" },
    ]);
    const { exec, remaining } = makeExec([
      { match: "gh pr view 42", result: ok(prJson) },
      { match: "gh pr checks 42", result: ok(checksJson) },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("success");
    expect(result.probe.sha).toBe("abc123");
    // A green poll has no run to name and skips the lookup, so no `gh run list`
    // call is scripted above and the exec queue must come back empty.
    expect(result.probe.runId).toBeNull();
    expect(result.branch).toBe("feature/x");
    expect(remaining()).toEqual([]);
  });

  it("requests gh pr checks with --json state,bucket,name (regression)", () => {
    // Pin the JSON field set the script asks for. If someone reintroduces
    // `conclusion` (which gh rejects) or drops `bucket` (which gh's
    // pass/fail/cancel categorization needs), this test will throw on the
    // matcher mismatch.
    const seen: string[] = [];
    const recordingExec: ExecFn = (command) => {
      seen.push(command);
      if (command.startsWith("gh pr view")) return ok(prJson);
      if (command.startsWith("gh pr checks")) {
        return ok(JSON.stringify([{ state: "SUCCESS", bucket: "pass", name: "x" }]));
      }
      if (command.startsWith("gh run list")) return ok("[]");
      throw new Error(`unexpected: ${command}`);
    };
    probePr(42, "owner/repo", recordingExec);
    const checksCall = seen.find((c) => c.startsWith("gh pr checks"));
    expect(checksCall).toBeDefined();
    expect(checksCall).toContain("--json state,bucket,name");
    expect(checksCall).not.toContain("conclusion");
  });

  it("targets the PR's own repo rather than the ambient checkout (regression)", () => {
    // Every gh call must name the repo. Without --repo, gh resolves the repo
    // from the working directory's remote, so watching a PR in one repo from a
    // checkout of another silently reports the wrong PR's state: same number,
    // different repo. That misfire is indistinguishable from a normal event
    // stream: a long-merged PR at that number emits success and merged at once.
    const seen: string[] = [];
    const recordingExec: ExecFn = (command) => {
      seen.push(command);
      if (command.startsWith("gh pr view")) {
        return ok(
          JSON.stringify({
            headRefOid: "abc123",
            headRefName: "feature/x",
            state: "OPEN",
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
          }),
        );
      }
      if (command.startsWith("gh pr checks")) {
        return ok(JSON.stringify([{ state: "SUCCESS", bucket: "pass", name: "x" }]));
      }
      if (command.startsWith("gh run list")) {
        return ok(JSON.stringify([{ databaseId: 999, headSha: "abc123", conclusion: "success" }]));
      }
      throw new Error(`unexpected: ${command}`);
    };
    probePr(42, "owner/repo", recordingExec);
    expect(seen).not.toBeEmpty();
    for (const command of seen) {
      expect(command).toContain("--repo owner/repo");
    }
  });

  it("emits state=failing when any check is in fail bucket", () => {
    const checksJson = JSON.stringify([
      { state: "SUCCESS", bucket: "pass", name: "lint" },
      { state: "FAILURE", bucket: "fail", name: "build" },
    ]);
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ok(checksJson) },
      {
        match: "gh run list",
        result: ok(JSON.stringify([{ databaseId: 123, headSha: "abc123", conclusion: "failure" }])),
      },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("failing");
  });

  it("names the failed run, not the branch's newest skipped run, on a failing PR", () => {
    const checksJson = JSON.stringify([
      { state: "SUCCESS", bucket: "pass", name: "build" },
      { state: "FAILURE", bucket: "fail", name: "lint" },
      { state: "SKIPPED", bucket: "skipping", name: "claude" },
    ]);
    const runsJson = JSON.stringify([
      { databaseId: 33220884467, headSha: "abc123", conclusion: "skipped" },
      { databaseId: 33223106137, headSha: "abc123", conclusion: "cancelled" },
      { databaseId: 33220042301, headSha: "abc123", conclusion: "failure" },
    ]);
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ok(checksJson) },
      { match: "gh run list", result: ok(runsJson) },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("failing");
    expect(result.probe.runId).toBe("33220042301");
  });

  it("emits a null run_id when the failing check is not an Actions run", () => {
    const checksJson = JSON.stringify([
      { state: "SUCCESS", bucket: "pass", name: "build" },
      { state: "FAILURE", bucket: "fail", name: "Greptile Review" },
    ]);
    const runsJson = JSON.stringify([
      { databaseId: 33220884467, headSha: "abc123", conclusion: "skipped" },
      { databaseId: 33223106137, headSha: "abc123", conclusion: "success" },
    ]);
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ok(checksJson) },
      { match: "gh run list", result: ok(runsJson) },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("failing");
    expect(result.probe.runId).toBeNull();
  });

  it("stays green when the only non-passing checks are skipped", () => {
    const checksJson = JSON.stringify([
      { state: "SUCCESS", bucket: "pass", name: "build" },
      { state: "SKIPPED", bucket: "skipping", name: "claude" },
      { state: "SKIPPED", bucket: "skipping", name: "automerge" },
    ]);
    const runsJson = JSON.stringify([
      { databaseId: 33220884467, headSha: "abc123", conclusion: "skipped" },
    ]);
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ok(checksJson) },
      { match: "gh run list", result: ok(runsJson) },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("success");
  });

  it("requests gh run list with the fields run attribution needs (regression)", () => {
    const seen: string[] = [];
    const recordingExec: ExecFn = (command) => {
      seen.push(command);
      if (command.startsWith("gh pr view")) return ok(prJson);
      if (command.startsWith("gh pr checks")) {
        return ok(JSON.stringify([{ state: "FAILURE", bucket: "fail", name: "x" }]));
      }
      if (command.startsWith("gh run list")) return ok("[]");
      throw new Error(`unexpected: ${command}`);
    };
    probePr(42, "owner/repo", recordingExec);
    const runsCall = seen.find((c) => c.startsWith("gh run list"));
    expect(runsCall).toContain("--json databaseId,headSha,conclusion,workflowDatabaseId,createdAt");
    expect(runsCall).toContain("--commit abc123");
  });

  it("skips the run lookup entirely while checks are still running", () => {
    const { exec, remaining } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      {
        match: "gh pr checks",
        result: ok(JSON.stringify([{ state: "IN_PROGRESS", bucket: "pending", name: "x" }])),
      },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("ok");
    expect(remaining()).toEqual([]);
  });

  it("returns kind=error when gh run list emits an entry that is not a run", () => {
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      {
        match: "gh pr checks",
        result: ok(JSON.stringify([{ state: "FAILURE", bucket: "fail", name: "x" }])),
      },
      { match: "gh run list", result: ok(JSON.stringify([null, "x"])) },
    ]);
    expect(probePr(42, "owner/repo", exec).kind).toBe("error");
  });

  it("returns kind=error when gh run list emits unparseable JSON", () => {
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      {
        match: "gh pr checks",
        result: ok(JSON.stringify([{ state: "FAILURE", bucket: "fail", name: "x" }])),
      },
      { match: "gh run list", result: ok("not json") },
    ]);
    expect(probePr(42, "owner/repo", exec).kind).toBe("error");
  });

  it("returns kind=error when gh pr view omits the head SHA", () => {
    const noSha = JSON.stringify({ headRefName: "feature/x", state: "OPEN" });
    const { exec } = makeExec([{ match: "gh pr view", result: ok(noSha) }]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stderr).toContain("headRefOid");
  });

  it("emits state=queued when all checks pending in QUEUED state", () => {
    const checksJson = JSON.stringify([
      { state: "QUEUED", bucket: "pending", name: "lint" },
      { state: "QUEUED", bucket: "pending", name: "build" },
    ]);
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ok(checksJson) },
      {
        match: "gh run list",
        result: ok(JSON.stringify([{ databaseId: 123, headSha: "abc123", conclusion: "failure" }])),
      },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("queued");
  });

  it("propagates stderr on gh exec failure so callers can surface it", () => {
    // Covers the silent-hang root cause: when gh exits non-zero (e.g., schema
    // drift, network blip, auth issue), the probe must carry stderr through
    // to the caller so the loop can log it instead of swallowing the error
    // and waiting for the api-error threshold to trip.
    const ghError = err('Unknown JSON field: "conclusion"');
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ghError },
    ]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stderr).toContain("Unknown JSON field");
    expect(result.rateLimited).toBe(false);
  });

  it("returns kind=error when gh pr view emits unparseable JSON", () => {
    const { exec } = makeExec([{ match: "gh pr view", result: ok("not json") }]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("error");
  });

  it("returns kind=error with stderr when headRefName is missing", () => {
    const partialJson = JSON.stringify({
      headRefOid: "abc",
      state: "OPEN",
      mergeable: "MERGEABLE",
    });
    const { exec } = makeExec([{ match: "gh pr view", result: ok(partialJson) }]);
    const result = probePr(42, "owner/repo", exec);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stderr).toContain("headRefName");
  });
});

describe("probeBranch (gh schema integration)", () => {
  it("returns kind=empty when gh run list returns []", () => {
    const { exec } = makeExec([{ match: "gh run list", result: ok("[]") }]);
    const result = probeBranch("owner/repo", "main", exec);
    expect(result.kind).toBe("empty");
  });

  it("maps a successful run-list payload to state=success", () => {
    const runJson = JSON.stringify([
      {
        databaseId: 12345,
        headSha: "deadbeef",
        status: "completed",
        conclusion: "success",
      },
    ]);
    const { exec } = makeExec([{ match: "gh run list", result: ok(runJson) }]);
    const result = probeBranch("owner/repo", "main", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("success");
    expect(result.probe.runId).toBe("12345");
    expect(result.probe.sha).toBe("deadbeef");
  });

  it("propagates stderr on gh exec failure", () => {
    const { exec } = makeExec([{ match: "gh run list", result: err("auth required") }]);
    const result = probeBranch("owner/repo", "main", exec);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stderr).toContain("auth required");
  });
});

describe("probeRunId (gh schema integration)", () => {
  it("classifies kind=not-found from gh's 'could not resolve' stderr", () => {
    const { exec } = makeExec([
      { match: "gh run view", result: err("could not resolve to a Node") },
    ]);
    const result = probeRunId("999", "owner/repo", exec);
    expect(result.kind).toBe("not-found");
  });

  it("maps a failed run-view payload to state=failing", () => {
    const runJson = JSON.stringify({
      databaseId: 555,
      headSha: "cafebabe",
      status: "completed",
      conclusion: "failure",
    });
    const { exec } = makeExec([{ match: "gh run view", result: ok(runJson) }]);
    const result = probeRunId("555", "owner/repo", exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("failing");
    expect(result.probe.runId).toBe("555");
  });

  it("propagates stderr on transient gh failure (non-not-found)", () => {
    const { exec } = makeExec([
      { match: "gh run view", result: err("network timeout reaching api.github.com") },
    ]);
    const result = probeRunId("555", "owner/repo", exec);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stderr).toContain("network timeout");
  });
});
