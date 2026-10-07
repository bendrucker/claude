import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";
import { MAX_ATTEMPTS, POLL_MS } from "./register.ts";

interface Recorded {
  event: string;
  ok?: boolean;
  detail?: Readonly<Record<string, unknown>>;
}

const START = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

const check = (conclusion: string) => ({
  __typename: "CheckRun",
  workflowName: "ci",
  name: "test",
  status: conclusion === "" ? "IN_PROGRESS" : "COMPLETED",
  conclusion,
  startedAt: "2026-10-06T10:00:00Z",
});

const pr = (conclusion: string, reviews: unknown[] = []) => ({
  number: 7,
  url: "https://github.com/o/r/pull/7",
  state: "OPEN",
  headRefOid: "aaaaaaa1111",
  reviewDecision: "",
  statusCheckRollup: [check(conclusion)],
  reviews,
});

interface World {
  branch: string;
  originHead?: string;
  gh: { exitCode: number; stdout: string; stderr: string } | Error;
  view: unknown;
  slowMs?: number;
  drop?: string;
}

function worldOf(on: On, world: World) {
  const events: Recorded[] = [];
  const statuses: (string | undefined)[] = [];
  const submits: string[] = [];
  const views: string[] = [];
  const clock = mock.clock(on);
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    events.push(e);
    return { value: undefined };
  });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("session.cwd", () => ({ value: "/work" }));
  on("ui.status", ($, e) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  on("prompt.submit", ($, e) => {
    submits.push(e.text);
    return world.drop === undefined ? { text: e.text } : { drop: world.drop };
  });
  on("process.run", async ($, e) => {
    const argv = e.argv.join(" ");
    if (argv.startsWith("git symbolic-ref")) {
      return {
        value: {
          exitCode: world.originHead === undefined ? 1 : 0,
          stdout: world.originHead === undefined ? "" : `${world.originHead}\n`,
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    if (argv.startsWith("git ")) {
      return {
        value: {
          exitCode: 0,
          stdout: `${world.branch}\n`,
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    if (argv === "gh --version") {
      if (world.gh instanceof Error) throw world.gh;
      return { value: { ...world.gh, isStdoutTruncated: false, isStderrTruncated: false } };
    }
    views.push(argv);
    if (world.slowMs !== undefined) await clock.sleep(world.slowMs);
    const stdout = typeof world.view === "string" ? "" : JSON.stringify(world.view);
    const stderr = typeof world.view === "string" ? world.view : "";
    return {
      value: {
        exitCode: stderr === "" ? 0 : 1,
        stdout,
        stderr,
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  const named = (event: string) => events.filter((e) => e.event === event);
  return { events, named, statuses, submits, views, clock };
}

const GH_OK = { exitCode: 0, stdout: "gh version 2.80.0\n", stderr: "" };

describe("register", () => {
  test("a new failure wakes the model once; the baseline and green stay quiet", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(w.named("pr.tracked")[0]?.detail).toEqual({
      pr: 7,
      head: "aaaaaaa1111",
      phase: "pending",
      state: "OPEN",
    });
    expect(w.statuses.at(-1)).toBe("CI 0/1");

    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("CI failed on PR #7 at aaaaaaa: ci / test.");
    expect(w.named("promote").map((e) => e.detail?.kind)).toEqual(["ci.failed"]);
    expect(w.named("inject")[0]).toEqual(
      expect.objectContaining({
        ok: true,
        detail: expect.objectContaining({ kinds: ["ci.failed"] }),
      }),
    );
    expect(w.statuses.at(-1)).toBe("CI ✗ ci / test → Claude");

    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);

    world.view = pr("SUCCESS");
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual(["ci.passing"]);
    expect(w.statuses.at(-1)).toBe(undefined);
  });

  test("requested changes wake the model and a comment review does not", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("SUCCESS", [
      { id: "r1", state: "COMMENTED", author: { login: "greptile" } },
      { id: "r2", state: "CHANGES_REQUESTED", author: { login: "alice" } },
    ]);
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("@alice requested changes on PR #7");
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual(["review"]);
  });

  test("a comment review keeps an alert shown as sent", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    world.view = pr("FAILURE", [{ id: "r1", state: "COMMENTED", author: { login: "bot" } }]);
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
    expect(w.statuses.at(-1)).toBe("CI ✗ ci / test → Claude");
  });

  test("stays idle without gh", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: new Error("ENOENT"), view: pr("") });

    await $.session.start(START);
    await w.clock.advance(POLL_MS.idle * 3);

    expect(w.named("session.start")[0]?.detail).toEqual({
      active: false,
      reason: "gh unavailable",
    });
    expect(w.views).toEqual([]);
  });

  test("a non-interactive session never polls", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("") });

    await $.session.start({ ...START, isInteractive: false });
    await w.clock.advance(POLL_MS.idle * 3);

    expect(w.named("session.start")[0]?.detail).toEqual({
      active: false,
      reason: "non-interactive",
    });
    expect(w.views).toEqual([]);
  });

  test("the default branch skips gh, and a branch with no PR shows nothing", async ($, on) => {
    const world: World = {
      branch: "main",
      gh: GH_OK,
      view: 'no pull requests found for branch "topic"',
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(w.views).toEqual([]);

    world.branch = "topic";
    await w.clock.advance(POLL_MS.idle);
    expect(w.views.length).toBe(1);
    expect(w.statuses).toEqual([]);
    expect(w.named("poll.error")).toEqual([]);
  });

  test("origin/HEAD names the default branch, so a PR from master is still watched", async ($, on) => {
    const world: World = { branch: "main", originHead: "origin/main", gh: GH_OK, view: pr("") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(w.views).toEqual([]);

    world.branch = "master";
    await w.clock.advance(POLL_MS.idle);
    expect(w.views.length).toBe(1);
    expect(w.statuses.at(-1)).toBe("CI 0/1");
  });

  test("a repeated gh failure is logged once and backs off", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: "HTTP 502: Bad Gateway" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.error);

    expect(w.views.length).toBe(2);
    expect(w.named("poll.error")).toEqual([
      expect.objectContaining({ ok: false, detail: { error: "HTTP 502: Bad Gateway" } }),
    ]);
  });

  test("session end stops the watch and clears the status", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("") });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending * 3);

    expect(w.views.length).toBe(1);
    expect(w.statuses.at(-1)).toBe(undefined);
  });

  test("a poll still in flight at session end leaves the status cleared", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr(""), slowMs: 10_000 });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(10_000 + POLL_MS.pending * 3);

    expect(w.views.length).toBe(1);
    expect(w.statuses).toEqual([undefined]);
  });

  test("a restart while a poll is in flight leaves one poll chain", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr(""), slowMs: 10_000 });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "other", sessionId: "s1", resume: { id: "s1" } });
    await $.session.start(START);
    await w.clock.advance(10_000 + POLL_MS.pending);

    expect(w.views.length).toBe(3);
  });

  test("an injection the engine drops is logged and not shown as sent", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);

    expect(w.named("inject")[0]).toEqual(
      expect.objectContaining({ ok: false, detail: expect.objectContaining({ dropped: "busy" }) }),
    );
    expect(w.statuses.at(-1)).toBe("CI ✗ ci / test");
  });

  test("a dropped injection is retried until the engine takes it", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    world.drop = undefined;
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(2);
    expect(w.submits[1]).toContain("CI failed on PR #7 at aaaaaaa: ci / test.");
    expect(w.named("inject").map((e) => [e.ok, e.detail?.attempt])).toEqual([
      [false, 1],
      [true, 2],
    ]);
    expect(w.statuses.at(-1)).toBe("CI ✗ ci / test → Claude");

    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(2);
  });

  test("a dropped injection stops retrying at the cap", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    await w.clock.advance(POLL_MS.settled * (MAX_ATTEMPTS + 2));
    expect(w.submits.length).toBe(MAX_ATTEMPTS);
  });

  test("a dropped failure is not retried once the check passes", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    world.view = pr("SUCCESS");
    await w.clock.advance(POLL_MS.settled * 2);
    expect(w.submits.length).toBe(1);
  });

  test("a failing poll marks the last status stale", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("FAILURE") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = "HTTP 401: Bad credentials";
    await w.clock.advance(POLL_MS.settled);

    expect(w.statuses.at(-1)).toBe("CI ✗ ci / test · stale");
  });
});
