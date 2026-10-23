import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";
import { IDLE_CAP_MS, MAX_ATTEMPTS, POLL_MS, QUIET_MS, TICK_MS } from "./register.ts";

interface Recorded {
  event: string;
  ok?: boolean;
  detail?: Readonly<Record<string, unknown>>;
}

const START = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

const COMPLETE = {
  answer: "",
  durationMs: 1,
  isAborted: false,
  turnId: "t1",
  reason: "answer",
} as const;

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

const note = (id: number, username: string, system = false, body = "") => ({
  id,
  system,
  body,
  author: { username },
});

interface World {
  branch: string;
  originHead?: string;
  glab: { exitCode: number; stdout: string; stderr: string } | Error;
  // A string is the stderr of a failed glab call.
  view: unknown;
  byIid?: unknown;
  jobs?: unknown[];
  approvals?: unknown;
  notes?: unknown;
  /** GraphQL reviewer nodes, or a string for a failed read. */
  reviewers?: unknown;
  /** The merge request fields the merge query reads. */
  merge?: Record<string, unknown>;
  discussions?: unknown[];
  // Runs after each read of the MR by branch, to move the MR mid-poll.
  afterView?: () => void;
  slowMs?: number;
  versionMs?: number;
  submitMs?: number;
  /** Heads this checkout lacks, as a push from elsewhere leaves them. */
  foreign?: string[];
  drop?: string;
  /** A sleep of the host that the ticker's next period waits out first. */
  sleptMs?: number;
  /** Refuses the ticker's periods, which ends it. */
  isTickRefused?: boolean;
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
  on("clock.every", { ms: TICK_MS }, async ($, e, next) => {
    if (world.isTickRefused === true) throw new Error("refused");
    const slept = world.sleptMs ?? 0;
    delete world.sleptMs;
    // Timers stand still while the host sleeps, so the period ends late by the clock.
    if (slept > 0) await clock.sleep(slept);
    return next(e);
  });
  const apis: string[] = [];
  const graphql: string[] = [];
  const clock = mock.clock(on);
  on("turn.complete", () => ({ text: "" }));
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
    if (argv.startsWith("git rev-parse --verify")) {
      const isForeign = (world.foreign ?? []).some((sha) => argv.includes(sha));
      return {
        value: {
          exitCode: isForeign ? 1 : 0,
          stdout: "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
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
    if (argv.startsWith("glab api graphql") && argv.includes("mergeTrainIndex")) {
      const mergeRequest = { autoMergeEnabled: false, mergeTrainIndex: null, ...world.merge };
      const ciCdSettings = { mergeTrainsEnabled: false };
      return reply({ data: { project: { ciCdSettings, mergeRequest } } });
    }
    if (argv.startsWith("glab api graphql")) {
      graphql.push(argv);
      const nodes = world.reviewers ?? [];
      if (typeof nodes === "string") return reply(nodes);
      return reply({ data: { project: { mergeRequest: { reviewers: { nodes } } } } });
    }
    apis.push(argv);
    if (argv.endsWith("/approvals")) return reply(world.approvals ?? approvals());
    if (argv.includes("/notes?")) return reply(world.notes ?? []);
    if (argv.includes("/discussions?")) {
      return result((world.discussions ?? []).map((row) => JSON.stringify(row)).join("\n"));
    }
    if (argv.startsWith("glab api --paginate --output ndjson projects/1/pipelines/50/jobs?")) {
      return result((world.jobs ?? job("running")).map((row) => JSON.stringify(row)).join("\n"));
    }
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
  return { events, named, shown, submits, views, apis, graphql, clock };
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
    expect(await w.shown($)).toBe("you  \u{f444} 0/1  \u{f441} 1");

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
    expect(await w.shown($)).toBe("you  \u{f52f} 1  \u{f441} 1");

    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);

    world.view = mr("success");
    world.jobs = job("success");
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual(["ci.passing"]);
    expect(await w.shown($)).toBe("you  \u{f49e}  \u{f441} 1");
  });

  test("an MR already conflicting when first seen is announced once, through a recheck", async ($, on) => {
    const conflicting = { ...mr("success"), has_conflicts: true, target_branch: "main" };
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: conflicting,
      jobs: job("success"),
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = { ...conflicting, has_conflicts: false, detailed_merge_status: "checking" };
    await w.clock.advance(POLL_MS.settled);
    world.view = conflicting;
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("MR !7 has merge conflicts with `main` at aaaaaaa.");
    expect(w.named("promote")[0]?.detail).toMatchObject({ kind: "conflict", baseline: true });
  });

  test("a dropped conflict is not retried against a new commit still being checked", async ($, on) => {
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
      drop: "busy",
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = { ...mr("success"), has_conflicts: true };
    await w.clock.advance(POLL_MS.settled);
    delete world.drop;
    world.view = { ...mr("success"), sha: "bbbbbbb2222", detailed_merge_status: "checking" };
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
  });

  test("a push from elsewhere wakes the model", async ($, on) => {
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.foreign = ["ccccccc3333"];
    world.view = { ...mr("success"), sha: "ccccccc3333" };
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain(
      "moved from aaaaaaa to ccccccc, a commit this checkout does not have",
    );
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
    expect(await w.shown($)).toBe("you  \u{f49e}  \u{f42e}");

    world.approvals = approvals();
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits[2]).toContain("@alice revoked their approval of MR !7");
    expect(w.named("promote").map((e) => e.detail?.approval ?? "commented")).toEqual([
      "commented",
      "approved",
      "unapproved",
    ]);
  });

  test(
    "bot chatter stays quiet and is logged once",
    { options: { ignore: "deploy-bot" } },
    async ($, on) => {
      const world: World = {
        branch: "topic",
        glab: GLAB_OK,
        view: mr("success"),
        jobs: job("success"),
      };
      const w = worldOf(on, world);
      const ack = "<!-- This is an auto-generated reply by CodeRabbit -->\n✅ Actions performed";

      await $.session.start(START);
      await w.clock.settle();
      world.notes = [note(3, "deploy-bot"), note(2, "coderabbitai", false, ack)];
      await w.clock.advance(POLL_MS.settled);
      await w.clock.advance(POLL_MS.settled);

      expect(w.submits).toEqual([]);
      expect(w.named("muted").map((e) => e.detail)).toEqual([
        { mr: 7, head: "aaaaaaa1111", id: "3", author: "deploy-bot", reason: "author" },
        { mr: 7, head: "aaaaaaa1111", id: "2", author: "coderabbitai", reason: "coderabbit.ack" },
      ]);
      expect(await w.shown($)).toBe("you  \u{f49e}  \u{f441} 1");
    },
  );

  test("whose turn the review is is read when a note lands, and a failed read keeps it", async ($, on) => {
    const state = (reviewState: string) => [
      { username: "alice", mergeRequestInteraction: { reviewState } },
    ];
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
      approvals: approvals(),
      notes: [note(4, "alice", true)],
      reviewers: state("REQUESTED_CHANGES"),
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(await w.shown($)).toBe("you  \u{f49e}  \u{f4a8}");
    await w.clock.advance(POLL_MS.settled);
    expect(w.graphql.length).toBe(1);

    world.notes = [note(5, "ben", true), note(4, "alice", true)];
    world.reviewers = state("UNREVIEWED");
    await w.clock.advance(POLL_MS.settled);
    expect(await w.shown($)).toBe("review  \u{f49e}  \u{f4e3} 1");

    world.notes = [note(6, "ben", true), note(5, "ben", true), note(4, "alice", true)];
    world.reviewers = "HTTP 500";
    await w.clock.advance(POLL_MS.settled);
    expect(w.graphql.length).toBe(3);
    expect(w.named("poll.error")).toEqual([]);
    expect(w.named("review.read").map((e) => e.ok)).toEqual([true, true, false]);
    expect(await w.shown($)).toBe("review  \u{f49e}  \u{f4e3} 1");
    expect(w.named("review.turn").map((e) => e.detail)).toEqual([
      { mr: 7, head: "aaaaaaa1111", turn: "author", waiting: ["alice"] },
      { mr: 7, head: "aaaaaaa1111", turn: "reviewer", waiting: ["alice"] },
    ]);
  });

  test(
    "an invalid body pattern is reported at start",
    { options: { ignoreBody: "(" } },
    async ($, on) => {
      const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr("success") });
      await $.session.start(START);
      await w.clock.settle();
      expect(w.named("ignoreBody.invalid")[0]).toMatchObject({ ok: false });
    },
  );

  test("a note back in the window after deletions stays quiet", async ($, on) => {
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
      notes: [note(9, "alice"), note(5, "bob")],
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.notes = [];
    await w.clock.advance(POLL_MS.settled);
    world.notes = [note(5, "bob")];
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits).toEqual([]);
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

  test("an unchanged updated_at and pipeline reuse the last approvals, notes, and jobs", async ($, on) => {
    const at = (updated_at: string, pipeline = "success") => ({ ...mr(pipeline), updated_at });
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: at("2026-10-23T10:00:00Z"),
      jobs: job("success"),
    };
    const w = worldOf(on, world);
    const reads = () => w.named("poll").map((e) => e.detail?.read);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.settled);
    expect(w.apis.length).toBe(4);

    world.view = at("2026-10-23T10:05:00Z");
    world.notes = [note(11, "alice")];
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits[0]).toContain("@alice commented on MR !7");

    world.view = at("2026-10-23T10:05:00Z", "running");
    world.jobs = job("running");
    await w.clock.advance(POLL_MS.settled);
    await w.clock.advance(POLL_MS.pending);
    expect(reads()).toEqual(["full", "hit", "miss", "miss", "full"]);
    expect(w.apis.length).toBe(16);
  });

  test("a merged MR is read back by IID, sent to the model, shown as merged, and read no further", async ($, on) => {
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
    expect(w.named("promote").map((e) => e.detail?.kind)).toEqual(["mr.merged"]);
    expect(w.submits).toEqual(["MR !7 merged: https://gitlab.example.com/g/r/-/merge_requests/7"]);
    expect(await w.shown($)).toBe("\u{f419} merged");

    world.approvals = "approvals should not be read again";
    await w.clock.advance(POLL_MS.closed);
    expect(w.named("poll.error")).toEqual([]);
    expect(await w.shown($)).toBe("\u{f419} merged");
  });

  test("stays idle without glab or outside an interactive session", async ($, on) => {
    const world: World = { branch: "topic", glab: new Error("ENOENT"), view: mr() };
    const w = worldOf(on, world);

    await $.session.start(START);
    world.glab = GLAB_OK;
    await $.session.start({ ...START, isInteractive: false });
    await w.clock.advance(POLL_MS.idle * 3);

    expect(w.named("session.start").map((e) => e.detail)).toEqual([
      { active: false, reason: "glab unavailable" },
      { active: false, reason: "non-interactive" },
    ]);
    expect(w.views).toEqual([]);
  });

  test("never polls with the watch option off", { options: { watch: false } }, async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr() });

    await $.session.start(START);
    await w.clock.advance(POLL_MS.idle * 3);

    expect(w.named("session.start")[0]?.detail).toEqual({ active: false, reason: "watch off" });
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
    expect(w.named("mr.none").map((e) => [e.detail?.reason, e.detail?.branch])).toEqual([
      ["default branch", "main"],
      ["no mr", "topic"],
    ]);
  });

  test("a checkout on another forge reads as no MR, not an error", async ($, on) => {
    const view =
      "None of the git remotes configured for this repository point to a known GitLab host.";
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view });

    await $.session.start(START);
    await w.clock.settle();

    expect(w.named("poll.error")).toEqual([]);
    expect(w.named("mr.none").map((e) => e.detail?.reason)).toEqual(["not gitlab"]);
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
    expect(await w.shown($)).toBe("you  \u{f444} 0/1  \u{f441} 1  \u{f421}");
  });

  test("an unexpected payload is a poll error", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr(), notes: { message: "x" } });

    await $.session.start(START);
    await w.clock.settle();

    expect(w.named("poll.error")[0]?.detail).toEqual({
      error: "MR notes returned an unexpected shape",
    });
  });

  test("/clear and /resume keep the watch running", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr() });

    await $.session.start(START);
    await w.clock.settle();
    const status = await w.shown($);
    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending);
    expect(w.views.length).toBe(2);
    await $.session.end({ reason: "resume", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending);

    expect(w.views.length).toBe(3);
    expect(status).not.toBe(undefined);
    expect(await w.shown($)).toBe(status);
  });

  test("logout stops the watch and clears the status", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr() });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "logout", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending * 3);

    expect(w.views.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
  });

  test("a send waiting on a busy session still advances the footer and the next poll", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr(), submitMs: POLL_MS.closed };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    const before = await w.shown($);
    world.jobs = job("failed");
    await w.clock.advance(POLL_MS.pending);
    expect(w.submits.length).toBe(1);
    expect(await w.shown($)).not.toBe(before);

    await w.clock.advance(POLL_MS.settled);
    expect(w.views.length).toBe(3);
    expect(w.submits.length).toBe(1);
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

  test("a poll from before a restart that fails leaves the new chain alone", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr(), slowMs: 20_000 };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.slowMs = 1_000;
    await $.session.end({ reason: "other", sessionId: "s1", resume: { id: "s1" } });
    await $.session.start(START);
    await w.clock.advance(1_000);
    world.view = "HTTP 502: Bad Gateway";
    await w.clock.advance(19_000);
    world.view = mr();
    await w.clock.advance(POLL_MS.pending);

    expect(w.named("poll.error")).toEqual([]);
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

  test("an MR with no pipeline and no approval rule waits on its author", async ($, on) => {
    const w = worldOf(on, {
      branch: "topic",
      glab: GLAB_OK,
      view: mr(null),
      approvals: { approvals_required: 0, approvals_left: 0, approved_by: [] },
    });

    await $.session.start(START);
    await w.clock.settle();

    expect(await w.shown($)).toBe("you");
  });

  test("an unchanged MR backs off until a turn or a change resets it", async ($, on) => {
    const world: World = {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.settled + QUIET_MS.reduce((sum, ms) => sum + ms));
    expect(w.views.length).toBe(8);
    expect(w.named("poll.backoff").map((e) => e.detail?.delayMs)).toEqual(QUIET_MS.slice(1));

    await w.clock.advance(30 * 60_000);
    await $.turn.complete(COMPLETE);
    await w.clock.advance(TICK_MS);
    expect(w.views.length).toBe(9);
    expect(w.named("poll.reset").map((e) => e.detail?.cause)).toEqual(["turn"]);

    await w.clock.advance(POLL_MS.settled * 2);
    world.view = mr("failed");
    world.jobs = job("failed");
    await w.clock.advance(QUIET_MS[1] ?? 0);
    expect(w.submits.length).toBe(1);
    expect(w.named("poll.reset").map((e) => e.detail?.cause)).toEqual(["turn", "change"]);
  });

  test("a turn soon after a poll brings the next one in to the unbacked wait", async ($, on) => {
    const w = worldOf(on, {
      branch: "topic",
      glab: GLAB_OK,
      view: mr("success"),
      jobs: job("success"),
    });

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.settled + (QUIET_MS[0] ?? 0));
    await $.turn.complete(COMPLETE);
    await w.clock.advance(TICK_MS);
    expect(w.views.length).toBe(3);
    expect(w.named("poll.reset").map((e) => e.detail?.cause)).toEqual(["turn"]);
    await w.clock.advance(POLL_MS.settled - TICK_MS);
    expect(w.views.length).toBe(4);
  });

  test("with no MR the backoff stops at the idle cap", async ($, on) => {
    const w = worldOf(on, {
      branch: "topic",
      glab: GLAB_OK,
      view: 'no open merge request available for "topic"',
    });

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(3 * 3_600_000);
    const delays = w.named("poll.backoff").map((e) => e.detail?.delayMs);
    expect(delays).toEqual([QUIET_MS[0], QUIET_MS[1], IDLE_CAP_MS]);
  });

  test("a poll due during a sleep runs on the first tick after the wake", async ($, on) => {
    const w = worldOf(on, { branch: "topic", glab: GLAB_OK, view: mr(), sleptMs: 30 * 60_000 });

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(30 * 60_000 + TICK_MS);

    expect(w.views.length).toBe(2);
    expect(w.named("poll.late")[0]?.detail).toEqual({
      gapMs: TICK_MS + 30 * 60_000,
      delayMs: POLL_MS.pending,
      lateMs: 30 * 60_000,
    });
  });

  test("a turn revives a ticker the engine stopped", async ($, on) => {
    const world: World = { branch: "topic", glab: GLAB_OK, view: mr(), isTickRefused: true };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(TICK_MS * 10);
    expect(w.views.length).toBe(1);

    world.isTickRefused = false;
    await $.turn.complete(COMPLETE);
    await w.clock.settle();
    expect(w.views.length).toBe(2);
    expect(w.named("watch.revived")[0]?.detail).toEqual({ silentMs: TICK_MS * 10, mr: 7 });
    expect(w.named("poll.late")).toEqual([]);
  });
});
