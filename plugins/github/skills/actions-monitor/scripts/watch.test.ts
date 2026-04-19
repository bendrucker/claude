import { describe, expect, it } from "bun:test";
import {
  clearApiErrors,
  computeInterval,
  deriveChecksState,
  deriveEvents,
  deriveRunListState,
  initialState,
  parsePrUrl,
  parseRepo,
  registerApiError,
  type Event,
  type Probe,
  type WatcherState,
} from "./watch";

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

describe("deriveChecksState", () => {
  it("returns running on empty checks", () => {
    expect(deriveChecksState([])).toBe("running");
  });

  it("returns failing on any failure conclusion", () => {
    expect(
      deriveChecksState([
        { state: "COMPLETED", conclusion: "success", name: "a" },
        { state: "COMPLETED", conclusion: "failure", name: "b" },
      ]),
    ).toBe("failing");
  });

  it("returns running when any check is IN_PROGRESS", () => {
    expect(
      deriveChecksState([
        { state: "IN_PROGRESS", conclusion: "", name: "a" },
        { state: "QUEUED", conclusion: "", name: "b" },
      ]),
    ).toBe("running");
  });

  it("returns queued when all checks are queued", () => {
    expect(
      deriveChecksState([
        { state: "QUEUED", conclusion: "", name: "a" },
        { state: "QUEUED", conclusion: "", name: "b" },
      ]),
    ).toBe("queued");
  });

  it("returns success when all checks pass", () => {
    expect(
      deriveChecksState([
        { state: "COMPLETED", conclusion: "success", name: "a" },
        { state: "COMPLETED", conclusion: "skipped", name: "b" },
      ]),
    ).toBe("success");
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
    const first = deriveEvents(
      baseProbe({ state: "queued", sha: "s1" }),
      initialState(),
      0,
      15,
    );
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
    const queued = deriveEvents(
      baseProbe({ state: "queued", sha: "s1" }),
      initialState(),
      0,
      15,
    );
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
});

describe("computeInterval", () => {
  it("returns default when no durations", () => {
    expect(computeInterval([])).toBe(180);
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
    expect(deriveRunListState({ status: "completed", conclusion: "failure" })).toBe(
      "failing",
    );
  });

  it("maps conclusion=cancelled to failing", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "cancelled" })).toBe(
      "failing",
    );
  });

  it("maps conclusion=timed_out to failing", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "timed_out" })).toBe(
      "failing",
    );
  });

  it("maps conclusion=success to success", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "success" })).toBe(
      "success",
    );
  });

  it("maps conclusion=neutral to success", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "neutral" })).toBe(
      "success",
    );
  });

  it("maps conclusion=skipped to success", () => {
    expect(deriveRunListState({ status: "completed", conclusion: "skipped" })).toBe(
      "success",
    );
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
