import { describe, expect, it } from "bun:test";
import {
  clearApiErrors,
  computeInterval,
  deriveChecksState,
  deriveEvents,
  deriveRunListState,
  type Event,
  type ExecFn,
  type ExecResult,
  initialState,
  type Probe,
  parsePrUrl,
  parseRepo,
  probeBranch,
  probePr,
  probeRunId,
  registerApiError,
  type WatcherState,
} from "./watch";

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
  it("returns running on empty checks", () => {
    expect(deriveChecksState([])).toBe("running");
  });

  it("returns failing when any check is in fail bucket", () => {
    expect(
      deriveChecksState([
        { state: "SUCCESS", bucket: "pass", name: "a" },
        { state: "FAILURE", bucket: "fail", name: "b" },
      ]),
    ).toBe("failing");
  });

  it("returns failing when any check is in cancel bucket", () => {
    expect(
      deriveChecksState([
        { state: "SUCCESS", bucket: "pass", name: "a" },
        { state: "CANCELLED", bucket: "cancel", name: "b" },
      ]),
    ).toBe("failing");
  });

  it("returns running when any check is IN_PROGRESS", () => {
    expect(
      deriveChecksState([
        { state: "IN_PROGRESS", bucket: "pending", name: "a" },
        { state: "QUEUED", bucket: "pending", name: "b" },
      ]),
    ).toBe("running");
  });

  it("returns queued when all checks are queued", () => {
    expect(
      deriveChecksState([
        { state: "QUEUED", bucket: "pending", name: "a" },
        { state: "QUEUED", bucket: "pending", name: "b" },
      ]),
    ).toBe("queued");
  });

  it("returns running when some checks are queued and others have completed", () => {
    expect(
      deriveChecksState([
        { state: "QUEUED", bucket: "pending", name: "a" },
        { state: "SUCCESS", bucket: "pass", name: "b" },
      ]),
    ).toBe("running");
  });

  it("returns success when all checks pass or skip", () => {
    expect(
      deriveChecksState([
        { state: "SUCCESS", bucket: "pass", name: "a" },
        { state: "SKIPPED", bucket: "skipping", name: "b" },
      ]),
    ).toBe("success");
  });

  it("returns success on the canonical all-green payload (regression: bucket+state schema)", () => {
    // Exact shape captured from `gh pr checks <num> --json state,bucket,name`
    // against a fully-green PR. If this assertion ever flips back to "running"
    // it means deriveChecksState has drifted from gh's actual JSON schema —
    // the same drift that caused the silent-hang on initial-green PRs.
    const allGreen = [
      { bucket: "pass", name: "plugins", state: "SUCCESS" },
      { bucket: "pass", name: "lint", state: "SUCCESS" },
      { bucket: "pass", name: "build", state: "SUCCESS" },
      { bucket: "pass", name: "hooks", state: "SUCCESS" },
      { bucket: "pass", name: "validate", state: "SUCCESS" },
    ];
    expect(deriveChecksState(allGreen)).toBe("success");
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
});

describe("pr-closed", () => {
  it("emits pr-closed for MERGED state", () => {
    const { events } = advance([{ probe: baseProbe({ prState: "MERGED" }) }]);
    expect(events.find((e) => e.type === "pr-closed")).toBeDefined();
  });

  it("emits pr-closed for CLOSED state", () => {
    const { events } = advance([{ probe: baseProbe({ prState: "CLOSED" }) }]);
    expect(events.find((e) => e.type === "pr-closed")).toBeDefined();
  });

  it("emits status:success before pr-closed when merged with success checks and lastState not success", () => {
    const { events } = advance([
      { probe: baseProbe({ prState: "MERGED", state: "success", sha: "s1" }) },
    ]);
    const statusIdx = events.findIndex((e) => e.type === "status");
    const closedIdx = events.findIndex((e) => e.type === "pr-closed");
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(events[statusIdx]).toMatchObject({ type: "status", state: "success", sha: "s1" });
    expect(closedIdx).toBeGreaterThan(statusIdx);
  });

  it("emits only pr-closed when merged with success checks and lastState already success", () => {
    const initial: WatcherState = { ...initialState(), lastState: "success", lastSha: "s1" };
    const { events } = advance(
      [{ probe: baseProbe({ prState: "MERGED", state: "success", sha: "s1" }) }],
      { initial },
    );
    expect(events).toEqual([{ type: "pr-closed" }]);
  });

  it("emits only pr-closed when merged with failing checks (no false success)", () => {
    const { events } = advance([
      { probe: baseProbe({ prState: "MERGED", state: "failing", sha: "s1" }) },
    ]);
    expect(events.find((e) => e.type === "status")).toBeUndefined();
    expect(events.find((e) => e.type === "pr-closed")).toBeDefined();
  });
});

describe("computeInterval", () => {
  it("returns fast poll floor when no durations (first PR on branch)", () => {
    expect(computeInterval([])).toBe(30);
  });

  it("adds buffer and clamps to minimum", () => {
    expect(computeInterval([10, 10, 10])).toBe(40);
  });

  it("clamps to maximum", () => {
    expect(computeInterval([1000, 1000, 1000])).toBe(600);
  });
});

describe("parseRepo", () => {
  it("parses HTTPS URLs", () => {
    expect(parseRepo("https://github.com/bendrucker/deployments")).toEqual({
      owner: "bendrucker",
      repo: "deployments",
    });
  });

  it("parses HTTPS URLs with .git suffix", () => {
    expect(parseRepo("https://github.com/bendrucker/deployments.git")).toEqual({
      owner: "bendrucker",
      repo: "deployments",
    });
  });

  it("parses scp-style SSH URLs", () => {
    expect(parseRepo("git@github.com:bendrucker/deployments.git")).toEqual({
      owner: "bendrucker",
      repo: "deployments",
    });
  });

  it("parses scp-style SSH URLs without .git", () => {
    expect(parseRepo("git@github.com:bendrucker/deployments")).toEqual({
      owner: "bendrucker",
      repo: "deployments",
    });
  });

  it("parses ssh:// protocol URLs", () => {
    expect(parseRepo("ssh://git@github.com/bendrucker/deployments.git")).toEqual({
      owner: "bendrucker",
      repo: "deployments",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseRepo("  https://github.com/owner/repo.git\n")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("returns null on an unknown URL", () => {
    expect(parseRepo("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseRepo("")).toBeNull();
  });
});

describe("deriveRunListState", () => {
  it("maps conclusion=failure to failing", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "failure" })).toBe("failing");
  });

  it("maps conclusion=cancelled to failing", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "cancelled" })).toBe("failing");
  });

  it("maps conclusion=timed_out to failing", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "timed_out" })).toBe("failing");
  });

  it("maps conclusion=success to success", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "success" })).toBe("success");
  });

  it("maps conclusion=neutral to success", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "neutral" })).toBe("success");
  });

  it("maps conclusion=skipped to success", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "skipped" })).toBe("success");
  });

  it("maps status=in_progress (no conclusion) to running", () => {
    expect(deriveRunListState({ status: "in_progress", conclusion: "" })).toBe("running");
  });

  it("maps status=queued to queued", () => {
    expect(deriveRunListState({ status: "queued", conclusion: "" })).toBe("queued");
  });

  it("maps status=waiting to queued", () => {
    expect(deriveRunListState({ status: "waiting", conclusion: "" })).toBe("queued");
  });

  it("maps status=pending to queued", () => {
    expect(deriveRunListState({ status: "pending", conclusion: "" })).toBe("queued");
  });

  it("falls back to running on unknown inputs", () => {
    expect(deriveRunListState({ status: "wat", conclusion: "" })).toBe("running");
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
      { match: "gh run list --branch feature/x", result: ok("999") },
    ]);
    const result = probePr(42, exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("success");
    expect(result.probe.sha).toBe("abc123");
    expect(result.probe.runId).toBe("999");
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
      if (command.startsWith("gh run list")) return ok("");
      throw new Error(`unexpected: ${command}`);
    };
    probePr(42, recordingExec);
    const checksCall = seen.find((c) => c.startsWith("gh pr checks"));
    expect(checksCall).toBeDefined();
    expect(checksCall).toContain("--json state,bucket,name");
    expect(checksCall).not.toContain("conclusion");
  });

  it("emits state=failing when any check is in fail bucket", () => {
    const checksJson = JSON.stringify([
      { state: "SUCCESS", bucket: "pass", name: "lint" },
      { state: "FAILURE", bucket: "fail", name: "build" },
    ]);
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ok(checksJson) },
      { match: "gh run list", result: ok("123") },
    ]);
    const result = probePr(42, exec);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.probe.state).toBe("failing");
  });

  it("emits state=queued when all checks pending in QUEUED state", () => {
    const checksJson = JSON.stringify([
      { state: "QUEUED", bucket: "pending", name: "lint" },
      { state: "QUEUED", bucket: "pending", name: "build" },
    ]);
    const { exec } = makeExec([
      { match: "gh pr view", result: ok(prJson) },
      { match: "gh pr checks", result: ok(checksJson) },
      { match: "gh run list", result: ok("123") },
    ]);
    const result = probePr(42, exec);
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
    const result = probePr(42, exec);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stderr).toContain("Unknown JSON field");
    expect(result.rateLimited).toBe(false);
  });

  it("returns kind=error when gh pr view emits unparseable JSON", () => {
    const { exec } = makeExec([{ match: "gh pr view", result: ok("not json") }]);
    const result = probePr(42, exec);
    expect(result.kind).toBe("error");
  });

  it("returns kind=error with stderr when headRefName is missing", () => {
    const partialJson = JSON.stringify({
      headRefOid: "abc",
      state: "OPEN",
      mergeable: "MERGEABLE",
    });
    const { exec } = makeExec([{ match: "gh pr view", result: ok(partialJson) }]);
    const result = probePr(42, exec);
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
