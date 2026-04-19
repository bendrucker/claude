import { describe, expect, it } from "bun:test";
import {
  clearApiErrors,
  computeInterval,
  deriveEvents,
  type Event,
  initialState,
  isNotFoundError,
  normalizePipelineStatus,
  parseMrUrl,
  parseProject,
  type Probe,
  registerApiError,
} from "./watch";

function makeProbe(overrides: Partial<Probe> = {}): Probe {
  return {
    sha: "sha1",
    state: "running",
    runId: "100",
    hasConflicts: false,
    mrState: "opened",
    ...overrides,
  };
}

describe("parseMrUrl", () => {
  it("parses a standard group/project MR URL", () => {
    const parsed = parseMrUrl("https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456");
    expect(parsed.project).toBe("gitlab-org/gitlab");
    expect(parsed.projectEncoded).toBe("gitlab-org%2Fgitlab");
    expect(parsed.iid).toBe(456);
  });

  it("parses a nested subgroup MR URL", () => {
    const parsed = parseMrUrl(
      "https://gitlab.com/group/subgroup/project/-/merge_requests/7",
    );
    expect(parsed.project).toBe("group/subgroup/project");
    expect(parsed.projectEncoded).toBe("group%2Fsubgroup%2Fproject");
    expect(parsed.iid).toBe(7);
  });

  it("tolerates trailing path segments", () => {
    const parsed = parseMrUrl(
      "https://gitlab.com/group/project/-/merge_requests/12/diffs",
    );
    expect(parsed.iid).toBe(12);
    expect(parsed.project).toBe("group/project");
  });

  it("rejects non-GitLab URLs", () => {
    expect(() => parseMrUrl("https://github.com/owner/repo/pull/1")).toThrow();
  });

  it("rejects URLs missing merge_requests segment", () => {
    expect(() => parseMrUrl("https://gitlab.com/group/project/-/issues/1")).toThrow();
  });

  it("rejects URLs without a group segment", () => {
    expect(() => parseMrUrl("https://gitlab.com/project/-/merge_requests/1")).toThrow();
  });
});

describe("parseProject", () => {
  it("parses an HTTPS remote URL", () => {
    expect(parseProject("https://gitlab.com/group/project.git")).toBe("group/project");
  });

  it("parses an HTTPS remote URL without .git suffix", () => {
    expect(parseProject("https://gitlab.com/group/project")).toBe("group/project");
  });

  it("parses an HTTPS remote URL with nested subgroups", () => {
    expect(parseProject("https://gitlab.com/group/subgroup/project.git")).toBe(
      "group/subgroup/project",
    );
  });

  it("parses an SCP-style SSH remote URL", () => {
    expect(parseProject("git@gitlab.com:group/project.git")).toBe("group/project");
  });

  it("parses an SCP-style SSH remote URL with nested subgroups", () => {
    expect(parseProject("git@gitlab.com:group/subgroup/project.git")).toBe(
      "group/subgroup/project",
    );
  });

  it("parses an ssh:// protocol remote URL", () => {
    expect(parseProject("ssh://git@gitlab.com/group/project.git")).toBe("group/project");
  });

  it("parses an ssh:// protocol remote URL with nested subgroups", () => {
    expect(parseProject("ssh://git@gitlab.com/group/subgroup/project.git")).toBe(
      "group/subgroup/project",
    );
  });

  it("strips a trailing slash after .git stripping", () => {
    expect(parseProject("https://gitlab.com/group/project.git/")).toBe("group/project");
  });

  it("throws when the path has no group segment", () => {
    expect(() => parseProject("https://gitlab.com/project.git")).toThrow();
  });

  it("throws when the remote URL cannot be parsed", () => {
    expect(() => parseProject("not-a-url")).toThrow();
  });

  it("throws on an empty string", () => {
    expect(() => parseProject("")).toThrow();
  });
});

describe("normalizePipelineStatus", () => {
  it("maps terminal states", () => {
    expect(normalizePipelineStatus("success")).toBe("success");
    expect(normalizePipelineStatus("failed")).toBe("failing");
    expect(normalizePipelineStatus("canceled")).toBe("failing");
  });

  it("maps running states", () => {
    expect(normalizePipelineStatus("running")).toBe("running");
  });

  it("maps queued-like states", () => {
    expect(normalizePipelineStatus("pending")).toBe("queued");
    expect(normalizePipelineStatus("created")).toBe("queued");
    expect(normalizePipelineStatus("manual")).toBe("queued");
  });

  it("maps skipped to success and covers remaining queued-like states", () => {
    expect(normalizePipelineStatus("skipped")).toBe("success");
    expect(normalizePipelineStatus("waiting_for_resource")).toBe("queued");
    expect(normalizePipelineStatus("preparing")).toBe("queued");
    expect(normalizePipelineStatus("scheduled")).toBe("queued");
  });

  it("falls back to running for unknown statuses", () => {
    expect(normalizePipelineStatus("totally-made-up-status")).toBe("running");
    expect(normalizePipelineStatus("")).toBe("running");
  });
});

describe("isNotFoundError", () => {
  it("detects 404 in stderr", () => {
    expect(isNotFoundError("HTTP 404: Not Found")).toBe(true);
    expect(isNotFoundError("error: 404 returned")).toBe(true);
  });

  it("detects 'not found' phrasing case-insensitively", () => {
    expect(isNotFoundError("Pipeline Not Found")).toBe(true);
    expect(isNotFoundError("pipeline not found")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isNotFoundError("connection reset")).toBe(false);
    expect(isNotFoundError("")).toBe(false);
    expect(isNotFoundError("500 internal server error")).toBe(false);
  });
});

describe("computeInterval", () => {
  it("defaults to 180 when no data", () => {
    expect(computeInterval([])).toBe(180);
  });

  it("adds a 30 second buffer to the average", () => {
    expect(computeInterval([60, 120])).toBe(120);
  });

  it("clamps interval to a 30 second floor for very short pipelines", () => {
    expect(computeInterval([0])).toBe(30);
  });

  it("clamps to 600 seconds", () => {
    expect(computeInterval([1200, 1200])).toBe(600);
  });
});

describe("deriveEvents", () => {
  it("emits status:success on first probe when already green", () => {
    const probe = makeProbe({ state: "success" });
    const { events, state } = deriveEvents(probe, initialState(), 0, 15);
    expect(events).toEqual([
      { type: "status", state: "success", sha: "sha1", run_id: "100" },
    ]);
    expect(state.lastSha).toBe("sha1");
    expect(state.lastState).toBe("success");
  });

  it("transitions running -> failing -> running -> success", () => {
    let state = initialState();

    const r1 = deriveEvents(makeProbe({ state: "running" }), state, 0, 15);
    state = r1.state;
    expect(r1.events).toEqual([
      { type: "status", state: "running", sha: "sha1", run_id: "100" },
    ]);

    const r2 = deriveEvents(makeProbe({ state: "failing" }), state, 1, 15);
    state = r2.state;
    expect(r2.events).toEqual([
      { type: "status", state: "failing", sha: "sha1", run_id: "100" },
    ]);

    const r3 = deriveEvents(makeProbe({ state: "running" }), state, 2, 15);
    state = r3.state;
    expect(r3.events).toEqual([
      { type: "status", state: "running", sha: "sha1", run_id: "100" },
    ]);

    const r4 = deriveEvents(makeProbe({ state: "success" }), state, 3, 15);
    state = r4.state;
    expect(r4.events).toEqual([
      { type: "status", state: "success", sha: "sha1", run_id: "100" },
    ]);
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

    const stillQueued = deriveEvents(
      makeProbe({ state: "queued" }),
      state,
      20 * minute,
      15,
    );
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
    const first = deriveEvents(
      makeProbe({ state: "running", hasConflicts: true }),
      state,
      0,
      15,
    );
    state = first.state;
    expect(first.events).toContainEqual({ type: "conflicts", sha: "sha1" });

    const second = deriveEvents(
      makeProbe({ state: "running", hasConflicts: true }),
      state,
      1,
      15,
    );
    expect(second.events.some((e) => e.type === "conflicts")).toBe(false);
  });

  it("emits conflicts again when the SHA changes", () => {
    let state = initialState();
    state = deriveEvents(
      makeProbe({ sha: "sha1", hasConflicts: true }),
      state,
      0,
      15,
    ).state;
    const next = deriveEvents(
      makeProbe({ sha: "sha2", hasConflicts: true, runId: "101" }),
      state,
      1,
      15,
    );
    expect(next.events).toContainEqual({ type: "conflicts", sha: "sha2" });
  });

  it("emits pr-closed when the MR is closed", () => {
    const { events } = deriveEvents(
      makeProbe({ mrState: "closed" }),
      initialState(),
      0,
      15,
    );
    expect(events).toEqual([{ type: "pr-closed" }]);
  });

  it("emits pr-closed when the MR is merged", () => {
    const { events } = deriveEvents(
      makeProbe({ mrState: "merged", state: "success" }),
      initialState(),
      0,
      15,
    );
    expect(events).toEqual([{ type: "pr-closed" }]);
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
    expect(again.events.some((e) => e.type === "api-error" && e.consecutive === 5)).toBe(
      false,
    );
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
      const outcome = deriveEvents(
        makeProbe({ state: "running", sha: `sha${i}` }),
        state,
        i,
        15,
      );
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
    expect(events).toEqual([
      { type: "status", state: "failing", sha: "sha1", run_id: "9001" },
    ]);
  });
});
