import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";
import { MAX_ATTEMPTS, POLL_MS } from "./register.ts";

interface Recorded {
  event: string;
  ok?: boolean;
  detail?: Readonly<Record<string, unknown>>;
}

const START = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

const mr = (pipeline: string | null = "running", state = "opened") => ({
  iid: 7,
  project_id: 1,
  web_url: "https://gitlab.example.com/g/r/-/merge_requests/7",
  state,
  sha: "aaaaaaa1111",
  detailed_merge_status: "mergeable",
  head_pipeline: pipeline === null ? null : { id: 50, project_id: 1, status: pipeline },
});

const job = (status: string) => [{ id: 900, name: "test", status, allow_failure: false }];

const approvals = (...names: string[]) => ({
  approvals_required: 1,
  approvals_left: names.length > 0 ? 0 : 1,
  approved_by: names.map((username) => ({ user: { username } })),
});

const note = (id: number, username: string, system = false) => ({
  id,
  system,
  author: { username },
});

interface World {
  branch: string;
  originHead?: string;
  glab: { exitCode: number; stdout: string; stderr: string } | Error;
  // A string is the stderr of a failed glab call.
  view: unknown;
  byIid?: unknown;
  jobs?: unknown;
  approvals?: unknown;
  notes?: unknown;
  // Runs after each read of the MR by branch, to move the MR mid-poll.
  afterView?: () => void;
  slowMs?: number;
  versionMs?: number;
  submitMs?: number;
  drop?: string;
}

const result = (stdout: string, stderr = "", exitCode = stderr === "" ? 0 : 1) => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
});

const reply = (value: unknown) =>
  typeof value === "string" ? result("", value) : result(JSON.stringify(value));

function worldOf(on: On, world: World) {
  const events: Recorded[] = [];
  const tails: (string | undefined)[] = [];
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
  on("ui.render", { component: "PromptHint" }, ($, e) => {
    tails.push(e.props.tail);
    return $.ui.resolve(e).Text({ children: e.props.hint });
  });
  on("prompt.submit", async ($, e) => {
    submits.push(e.text);
    if (world.submitMs !== undefined) await clock.sleep(world.submitMs);
    return world.drop === undefined ? { text: e.text } : { drop: world.drop };
  });
  on("process.run", async ($, e) => {
    const argv = e.argv.join(" ");
    if (argv.startsWith("git symbolic-ref")) {
      return world.originHead === undefined ? result("", "", 1) : result(`${world.originHead}\n`);
    }
    if (argv.startsWith("git ")) return result(`${world.branch}\n`);
    if (argv === "glab --version") {
      if (world.versionMs !== undefined) await clock.sleep(world.versionMs);
      if (world.glab instanceof Error) throw world.glab;
      return { value: { ...world.glab, isStdoutTruncated: false, isStderrTruncated: false } };
    }
    if (argv.startsWith("glab mr view")) {
      views.push(argv);
      if (world.slowMs !== undefined) await clock.sleep(world.slowMs);
      if (argv === "glab mr view 7 -F json") return reply(world.byIid ?? world.view);
      const view = reply(world.view);
      world.afterView?.();
      return view;
    }
    if (argv === "glab api user") return reply({ username: "ben" });
    if (argv.endsWith("/approvals")) return reply(world.approvals ?? approvals());
    if (argv.includes("/notes?")) return reply(world.notes ?? []);
    if (argv.startsWith("glab api --paginate projects/1/pipelines/50/jobs?"))
      return reply(world.jobs ?? job("running"));
    throw new Error(`unexpected command: ${argv}`);
  });
  const named = (event: string) => events.filter((e) => e.event === event);
  // The footer text the mod adds after the engine's hint, as last drawn.
  const shown = async ($: Engine) => {
    await $.ui.mount({
      plugin: "gitlab",
      surface: "terminal",
      component: "PromptHint",
      props: HINT,
    });
    return tails.at(-1);
  };
  return { events, named, shown, submits, views, clock };
}

const HINT = { isDraft: false, isWorking: false, hint: "? for shortcuts" };

const GLAB_OK = { exitCode: 0, stdout: "glab 1.122.0\n", stderr: "" };

const KEYRING =
  'glab: not refreshing the OAuth token for "gitlab.com", because the refreshed credentials could not be saved';

describe("register", () => {
  test("a new failure wakes the model once; the baseline and green stay quiet", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr() };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(w.named("mr.tracked")[0]?.detail).toEqual({
      mr: 7,
      head: "aaaaaaa1111",
      phase: "pending",
      state: "opened",
    });
    expect(await w.shown($)).toBe("\u{f444} CI 0/1 · \u{f441} 1 approval needed");

    world.view = mr("failed");
    world.jobs = job("failed");
    await w.clock.advance(POLL_MS.pending);
    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("Pipeline failed on MR !7 at aaaaaaa: test.");
    expect(w.submits[0]).toContain("`glab ci trace <job> --pipeline-id 50`");
    expect(w.named("promote").map((e) => e.detail?.kind)).toEqual(["ci.failed"]);
    expect(w.named("inject")[0]).toEqual(
      expect.objectContaining({
        ok: true,
        detail: expect.objectContaining({ kinds: ["ci.failed"] }),
      }),
    );
    expect(await w.shown($)).toBe("\u{f52f} test · \u{f441} 1 approval needed");

    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);

    world.view = mr("success");
    world.jobs = job("success");
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual(["ci.passing"]);
    expect(await w.shown($)).toBe("\u{f49e} CI · \u{f441} 1 approval needed");
  });

  test("every review from someone else wakes the model, comment-only included", async ($, on) => {
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
      notes: [note(1, "alice")],
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.notes = [note(4, "ben"), note(3, "alice", true), note(2, "greptile"), note(1, "alice")];
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("@greptile commented on MR !7 (1 new comment)");

    world.approvals = approvals("alice");
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits[1]).toContain("@alice approved MR !7");
    expect(await w.shown($)).toBe("\u{f49e} CI · \u{f42e} approved");

    world.approvals = approvals();
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits[2]).toContain("@alice revoked their approval of MR !7");
    expect(w.named("promote").map((e) => e.detail?.state)).toEqual([
      "commented",
      "approved",
      "unapproved",
    ]);
  });

  test("approvals a push resets between reads are not an unapproval", async ($, on) => {
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
      approvals: approvals("alice"),
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    const pushed = { ...mr("success"), sha: "bbbbbbb2222" };
    world.afterView = () => {
      world.approvals = approvals();
      world.view = pushed;
      world.byIid = pushed;
    };
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits).toEqual([]);
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual([
      "push",
      "ci.passing",
      "approvals.reset",
    ]);
  });

  test("a merged MR is read back by IID, logged, and shown as merged", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr() };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = 'no open merge request available for "topic"';
    world.byIid = mr("success", "merged");
    world.jobs = job("success");
    await w.clock.advance(POLL_MS.pending);

    expect(w.views).toEqual([
      "glab mr view -F json",
      "glab mr view -F json",
      "glab mr view 7 -F json",
    ]);
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual(["mr.merged"]);
    expect(w.submits).toEqual([]);
    expect(await w.shown($)).toBe("\u{f419} merged");
  });

  test("stays idle without glab", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: new Error("ENOENT"), view: mr() });

    await $.session.start(START);
    await w.clock.advance(POLL_MS.idle * 3);

    expect(w.named("session.start")[0]?.detail).toEqual({
      active: false,
      reason: "glab unavailable",
    });
    expect(w.views).toEqual([]);
  });

  test("a session that ends during the glab check never polls", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr(), versionMs: 1000 });

    const starting = $.session.start(START);
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(1000 + POLL_MS.idle * 3);
    await starting;

    expect(w.named("session.start")).toEqual([]);
    expect(w.views).toEqual([]);
  });

  test("a non-interactive session never polls", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr() });

    await $.session.start({ ...START, isInteractive: false });
    await w.clock.advance(POLL_MS.idle * 3);

    expect(w.named("session.start")[0]?.detail).toEqual({
      active: false,
      reason: "non-interactive",
    });
    expect(w.views).toEqual([]);
  });

  test("the default branch skips glab, and a branch with no MR shows nothing", async ($, on) => {
    const world: World = {
      branch: "main",
      glab: GLAB_OK,
      view: 'no open merge request available for "topic"',
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(w.views).toEqual([]);

    world.branch = "topic";
    await w.clock.advance(POLL_MS.idle);
    expect(w.views.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
    expect(w.named("poll.error")).toEqual([]);
  });

  test("origin/HEAD names the default branch, so an MR from master is still watched", async ($, on) => {
    const world: World = { branch: "main", originHead: "origin/main", glab: GLAB_OK, view: mr() };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(w.views).toEqual([]);

    world.branch = "master";
    await w.clock.advance(POLL_MS.idle);
    expect(w.views.length).toBe(1);
    expect(w.named("mr.tracked").length).toBe(1);
  });

  test("an auth failure is logged once, backs off, and marks the status stale", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr() };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = `   ERROR  \n          \n  ${KEYRING}  \n`;
    await w.clock.advance(POLL_MS.pending);
    await w.clock.advance(POLL_MS.error - 1);
    expect(w.views.length).toBe(2);
    await w.clock.advance(1);
    expect(w.views.length).toBe(3);

    expect(w.named("poll.error")).toEqual([
      expect.objectContaining({ ok: false, detail: { error: KEYRING } }),
    ]);
    expect(await w.shown($)).toBe("\u{f444} CI 0/1 · \u{f441} 1 approval needed · \u{f421} stale");
  });

  test("an unexpected payload is a poll error", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr(), notes: { message: "x" } });

    await $.session.start(START);
    await w.clock.settle();

    expect(w.named("poll.error")[0]?.detail).toEqual({
      error: "MR notes returned an unexpected shape",
    });
  });

  test("session end stops the watch and clears the status", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr() });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending * 3);

    expect(w.views.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
  });

  test("a poll still in flight at session end leaves the status cleared", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr(), slowMs: 10_000 });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(10_000 + POLL_MS.pending * 3);

    expect(w.views.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
  });

  test("a send still in flight at session end leaves the status cleared", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr(), submitMs: 10_000 };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.jobs = job("failed");
    await w.clock.advance(POLL_MS.pending);
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(10_000 + POLL_MS.settled * 2);

    expect(w.submits.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
    expect(w.views.length).toBe(2);
  });

  test("a restart while a poll is in flight leaves one poll chain", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr(), slowMs: 10_000 });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "other", sessionId: "s1", resume: { id: "s1" } });
    await $.session.start(START);
    await w.clock.advance(10_000 + POLL_MS.pending);

    expect(w.views.length).toBe(3);
  });

  test("a dropped injection is retried until the engine takes it", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr(), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.jobs = job("failed");
    await w.clock.advance(POLL_MS.pending);
    delete world.drop;
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(2);
    expect(w.submits[1]).toContain("Pipeline failed on MR !7 at aaaaaaa: test.");
    expect(w.named("inject").map((e) => [e.ok, e.detail?.attempt, e.detail?.dropped])).toEqual([
      [false, 1, "busy"],
      [true, 2, undefined],
    ]);

    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(2);
  });

  test("a dropped injection stops retrying at the cap", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr(), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.jobs = job("failed");
    await w.clock.advance(POLL_MS.pending);
    await w.clock.advance(POLL_MS.settled * (MAX_ATTEMPTS + 2));
    expect(w.submits.length).toBe(MAX_ATTEMPTS);
  });

  test("a dropped failure is not retried once the job passes", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr(), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.jobs = job("failed");
    await w.clock.advance(POLL_MS.pending);
    world.view = mr("success");
    world.jobs = job("success");
    await w.clock.advance(POLL_MS.settled * 2);
    expect(w.submits.length).toBe(1);
  });

  test("an MR with no pipeline and no approval rule leaves the footer as it was", async ($, on) => {
    const w = worldOf(on, {
      branch: "topic",
      glab: GLAB_OK,
      view: mr(null),
      approvals: { approvals_required: 0, approvals_left: 0, approved_by: [] },
    });

    await $.session.start(START);
    await w.clock.settle();

    expect(await w.shown($)).toBe(undefined);
  });
});
