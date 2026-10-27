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
  versionMs?: number;
  submitMs?: number;
  drop?: string;
  /** Heads this checkout lacks, as a push from elsewhere leaves them. */
  foreign?: string[];
  /** A token that cannot read `/user`. */
  noLogin?: boolean;
  /** A sleep of the host that the ticker's next period waits out first. */
  sleptMs?: number;
  /** Refuses the ticker's periods, which ends it. */
  isTickRefused?: boolean;
  /** The current ETag of each REST path the gate probes; one left out answers 200 bare. */
  etags?: Record<string, string>;
  /** The GraphQL pull request the extras query reads. */
  extras?: Record<string, unknown>;
  /** The extras query fails, as a GraphQL rate limit makes it. */
  isExtrasFailing?: boolean;
}

// GitHub types the review app's login as a bot.
const EXTRAS = {
  comments: { nodes: [{ author: { __typename: "Bot", login: "review-app" } }] },
  isMergeQueueEnabled: false,
  autoMergeRequest: null,
  mergeQueueEntry: null,
  reviewThreads: { nodes: [] },
};

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
  const probes: string[] = [];
  const clock = mock.clock(on);
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
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
  on("command.register", () => ({ value: { command: "pr" } }));
  const panes = new Set<string>();
  on("ui.open", ($, e) => {
    panes.add(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.panes", () => ({
    value: [...panes].map((id) => ({
      id,
      title: id,
      isShown: true,
      isFocused: false,
      isPlaced: true,
    })),
  }));
  on("ui.close", ($, e) => {
    panes.delete(e.id);
    return { value: undefined };
  });
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
    if (argv === "gh api user --hostname github.com --jq .login") {
      return {
        value: {
          exitCode: world.noLogin === true ? 1 : 0,
          stdout: world.noLogin === true ? "" : "ben\n",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    if (argv.startsWith("gh api graphql") && world.isExtrasFailing === true) {
      return {
        value: {
          exitCode: 1,
          stdout: "",
          stderr: "API rate limit exceeded\n",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    if (argv.startsWith("gh api graphql")) {
      const pullRequest = { ...EXTRAS, ...world.extras };
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ data: { repository: { pullRequest } } }),
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    if (argv.startsWith("gh api -i")) {
      const path = e.argv[6] ?? "";
      probes.push(path);
      const etag = world.etags?.[path];
      const status = etag !== undefined && e.argv.at(-1) === `If-None-Match: ${etag}` ? 304 : 200;
      return {
        value: {
          exitCode: status === 200 ? 0 : 1,
          stdout: `HTTP/1.1 ${status} X\r\n${etag === undefined ? "" : `Etag: ${etag}\r\n`}\r\n`,
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
      if (world.versionMs !== undefined) await clock.sleep(world.versionMs);
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
  // The footer text the mod adds after the engine's hint, as last drawn.
  const shown = async ($: Engine) => {
    await $.ui.mount({
      plugin: "github",
      surface: "terminal",
      component: "PromptHint",
      props: HINT,
    });
    return tails.at(-1);
  };
  return { events, named, shown, submits, views, probes, clock };
}

const HINT = { isDraft: false, isWorking: false, hint: "? for shortcuts" };

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
    expect(await w.shown($)).toBe("ci      │ \u{f444} 0/1");

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
    expect(await w.shown($)).toBe("you     │ \u{f52f} 1");

    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);

    world.view = pr("SUCCESS");
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual(["ci.passing"]);
    expect(await w.shown($)).toBe("you     │ \u{f49e}");
  });

  test("every new review wakes the model with its state", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("SUCCESS", [
      { id: "r1", state: "COMMENTED", author: { login: "carol" } },
      { id: "r2", state: "CHANGES_REQUESTED", author: { login: "alice" } },
    ]);
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("@carol reviewed PR #7 (COMMENTED)");
    expect(w.submits[0]).toContain("@alice reviewed PR #7 (CHANGES_REQUESTED)");
    expect(w.named("drop")).toEqual([]);
  });

  test(
    "a review bot's check arrives with its review, and chatter only logs",
    { options: { ignore: "vercel[bot]" } },
    async ($, on) => {
      const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
      const w = worldOf(on, world);
      const verdict = {
        __typename: "CheckRun",
        name: "Review App",
        status: "COMPLETED",
        conclusion: "FAILURE",
        startedAt: "2026-10-06T10:05:00Z",
      };

      await $.session.start(START);
      await w.clock.settle();
      world.view = {
        ...pr("SUCCESS", [
          { id: "r1", state: "COMMENTED", author: { login: "review-app" }, body: "Summary" },
        ]),
        statusCheckRollup: [check("SUCCESS"), verdict],
        comments: [{ id: "c1", author: { login: "vercel[bot]" }, body: "Preview ready" }],
      };
      await w.clock.advance(POLL_MS.settled);
      await w.clock.advance(POLL_MS.settled);

      expect(w.submits.length).toBe(1);
      expect(w.submits[0]).toContain("@review-app reviewed PR #7 (COMMENTED)");
      expect(w.submits[0]).not.toContain("CI failed");
      expect(w.named("muted").map((e) => e.detail)).toEqual([
        {
          pr: 7,
          head: "aaaaaaa1111",
          id: "aaaaaaa1111:Review App",
          author: "review-app",
          reason: "review.check",
        },
        { pr: 7, head: "aaaaaaa1111", id: "c1", author: "vercel[bot]", reason: "author" },
      ]);
      expect(w.named("inject")[0]?.detail?.muted).toEqual(["aaaaaaa1111:Review App", "c1"]);
      expect(await w.shown($)).toBe("you     │ \u{f49e}");
    },
  );

  test("whose turn the review is shows in the footer and logs on each change", async ($, on) => {
    const asked = { id: "r1", state: "CHANGES_REQUESTED", author: { login: "alice" } };
    const world: World = {
      branch: "topic",
      gh: GH_OK,
      view: { ...pr("SUCCESS"), latestReviews: [asked] },
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(await w.shown($)).toBe("you     │ \u{f49e}  \u{f4a8}");

    const pushed = { ...pr("SUCCESS"), headRefOid: "bbbbbbb2222", latestReviews: [asked] };
    world.view = pushed;
    await w.clock.advance(POLL_MS.settled);
    world.view = { ...pushed, reviewRequests: [{ login: "alice" }] };
    await w.clock.advance(POLL_MS.settled);
    expect(await w.shown($)).toBe("review  │ \u{f49e}  \u{f4e3} 1");
    expect(w.named("review.turn").map((e) => e.detail)).toEqual([
      { pr: 7, head: "aaaaaaa1111", turn: "author", waiting: ["alice"] },
      { pr: 7, head: "bbbbbbb2222", turn: "reviewer", waiting: ["alice"] },
    ]);
  });

  test("chatter already on a PR first seen is logged as the baseline", async ($, on) => {
    const ack = "<!-- reply marker -->\nActions performed";
    const view = {
      ...pr("SUCCESS"),
      comments: [{ id: "c1", author: { login: "review-app" }, body: ack }],
    };
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view });

    await $.session.start(START);
    await w.clock.settle();
    expect(w.named("muted").map((e) => e.detail)).toEqual([
      {
        pr: 7,
        head: "aaaaaaa1111",
        baseline: true,
        id: "c1",
        author: "review-app",
        reason: "marked",
      },
    ]);
    expect(await w.shown($)).toBe("you     │ \u{f49e}");
  });

  test(
    "an invalid body pattern is reported at start",
    { options: { ignoreBody: "(" } },
    async ($, on) => {
      const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("SUCCESS") });
      await $.session.start(START);
      await w.clock.settle();
      expect(w.named("ignoreBody.invalid")[0]).toMatchObject({ ok: false });
    },
  );

  test("a conflict wakes the model once, through a mergeability recompute", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);
    const merging = (mergeable: string) => ({ ...pr("SUCCESS"), mergeable, baseRefName: "main" });

    await $.session.start(START);
    await w.clock.settle();
    world.view = merging("CONFLICTING");
    await w.clock.advance(POLL_MS.settled);
    world.view = merging("UNKNOWN");
    await w.clock.advance(POLL_MS.settled);
    world.view = merging("CONFLICTING");
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("PR #7 has merge conflicts with `main` at aaaaaaa.");
    expect(w.submits[0]).toContain("`git:conflicts`");
    expect(await w.shown($)).toBe("you     │ \u{f419}\u{f467}  \u{f49e}");

    world.view = merging("MERGEABLE");
    await w.clock.advance(QUIET_MS[1] ?? 0);
    expect(w.named("drop").map((e) => e.detail?.kind)).toEqual(["unblocked"]);
  });

  test("a PR already conflicting when first seen is announced once", async ($, on) => {
    const conflicting = { ...pr("FAILURE"), mergeable: "CONFLICTING", baseRefName: "main" };
    const world: World = { branch: "topic", gh: GH_OK, view: conflicting };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain("PR #7 has merge conflicts");
    expect(w.submits[0]).not.toContain("CI failed");
    expect(w.named("promote")[0]?.detail).toMatchObject({ kind: "conflict", baseline: true });
  });

  test("my own thread replies never come back as reviews", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = {
      ...pr("SUCCESS", [{ id: "r1", state: "COMMENTED", author: { login: "ben" } }]),
      comments: [{ id: "c1", author: { login: "ben" }, viewerDidAuthor: true }],
    };
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits).toEqual([]);
  });

  test("a push from elsewhere wakes the model, and one from this checkout does not", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = { ...pr("SUCCESS"), headRefOid: "bbbbbbb2222" };
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits).toEqual([]);

    world.foreign = ["ccccccc3333"];
    world.view = { ...pr("SUCCESS"), headRefOid: "ccccccc3333" };
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
    expect(w.submits[0]).toContain(
      "moved from bbbbbbb to ccccccc, a commit this checkout does not have",
    );
  });

  test("a merge wakes the model and a dropped one is retried after the PR ends", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS"), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = { ...pr("SUCCESS"), state: "MERGED" };
    await w.clock.advance(POLL_MS.settled);
    delete world.drop;
    await w.clock.advance(POLL_MS.closed);

    expect(w.submits).toEqual([
      "PR #7 merged: https://github.com/o/r/pull/7",
      "PR #7 merged: https://github.com/o/r/pull/7",
    ]);
    expect(await w.shown($)).toBe("\u{f419} merged");
  });

  test("a dropped close is not retried once the PR reopens", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS"), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = { ...pr("SUCCESS"), state: "CLOSED" };
    await w.clock.advance(POLL_MS.settled);
    delete world.drop;
    world.view = pr("SUCCESS");
    await w.clock.advance(POLL_MS.closed);
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits).toEqual(["PR #7 closed without merging: https://github.com/o/r/pull/7"]);
  });

  async function dropConflictThenRecheck($: Engine, on: On, settled: string): Promise<number> {
    const view = (headRefOid: string, mergeable: string) => ({
      ...pr("SUCCESS"),
      headRefOid,
      mergeable,
    });
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS"), drop: "busy" };
    const w = worldOf(on, world);
    await $.session.start(START);
    await w.clock.settle();
    world.view = view("aaaaaaa1111", "CONFLICTING");
    await w.clock.advance(POLL_MS.settled);
    delete world.drop;
    world.view = view("bbbbbbb2222", "UNKNOWN");
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
    world.view = view("bbbbbbb2222", settled);
    await w.clock.advance(POLL_MS.settled);
    return w.submits.length;
  }

  test("a dropped conflict waits out a recheck and goes when the new commit still conflicts", async ($, on) => {
    expect(await dropConflictThenRecheck($, on, "CONFLICTING")).toBe(2);
  });

  test("a dropped conflict waits out a recheck and is gone when the new commit is clean", async ($, on) => {
    expect(await dropConflictThenRecheck($, on, "MERGEABLE")).toBe(1);
  });

  test("a push while a conflict stands does not announce it again", async ($, on) => {
    const view = (headRefOid: string, mergeable: string) => ({
      ...pr("SUCCESS"),
      headRefOid,
      mergeable,
    });
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);
    await $.session.start(START);
    await w.clock.settle();
    world.view = view("aaaaaaa1111", "CONFLICTING");
    await w.clock.advance(POLL_MS.settled);
    world.view = view("bbbbbbb2222", "UNKNOWN");
    await w.clock.advance(POLL_MS.settled);
    world.view = view("bbbbbbb2222", "CONFLICTING");
    await w.clock.advance(POLL_MS.settled);
    expect(w.submits.length).toBe(1);
  });

  test("a PR reopened with its conflict announces it again", async ($, on) => {
    const conflicting = { ...pr("SUCCESS"), mergeable: "CONFLICTING" };
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);
    await $.session.start(START);
    await w.clock.settle();
    world.view = conflicting;
    await w.clock.advance(POLL_MS.settled);
    world.view = { ...conflicting, state: "CLOSED" };
    await w.clock.advance(POLL_MS.settled);
    world.view = conflicting;
    await w.clock.advance(POLL_MS.closed);
    expect(w.named("promote").map((e) => e.detail?.kind)).toEqual([
      "conflict",
      "pr.closed",
      "conflict",
    ]);
  });

  test("a token that cannot read the login still watches the PR", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS"), noLogin: true };
    const w = worldOf(on, world);
    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.settled);
    expect(w.named("poll.error")).toEqual([]);
    expect(w.submits.length).toBe(1);
  });

  test("a review after a sent alert carries only the review", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    world.view = pr("FAILURE", [{ id: "r1", state: "COMMENTED", author: { login: "bot" } }]);
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(2);
    expect(w.submits[1]).toContain("@bot reviewed PR #7 (COMMENTED)");
    expect(w.submits[1]).not.toContain("CI failed");
    expect(await w.shown($)).toBe("you     │ \u{f52f} 1");
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

  test("a session that ends during the gh check never polls", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr(""), versionMs: 1000 });

    const starting = $.session.start(START);
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(1000 + POLL_MS.idle * 3);
    await starting;

    expect(w.named("session.start")).toEqual([]);
    expect(w.views).toEqual([]);
  });

  test("never polls with the watch option off", { options: { watch: false } }, async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("") });

    await $.session.start(START);
    await w.clock.advance(POLL_MS.idle * 3);

    expect(w.named("session.start")[0]?.detail).toEqual({ active: false, reason: "watch off" });
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
    expect(await w.shown($)).toBe(undefined);
    expect(w.named("poll.error")).toEqual([]);
    expect(w.named("pr.none").map((e) => [e.detail?.reason, e.detail?.branch])).toEqual([
      ["default branch", "main"],
      ["no pr", "topic"],
    ]);
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
    expect(await w.shown($)).toBe("ci      │ \u{f444} 0/1");
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
    expect(await w.shown($)).toBe(undefined);
  });

  test("/clear and /resume keep the watch running", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("") });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending);
    expect(w.views.length).toBe(2);
    await $.session.end({ reason: "resume", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending);

    expect(w.views.length).toBe(3);
    expect(await w.shown($)).toBe("ci      │ \u{f444} 0/1");
  });

  test("logout stops the watch and clears the status", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("") });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "logout", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(POLL_MS.pending * 3);

    expect(w.views.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
  });

  test("a send waiting on a busy session still advances the footer and the next poll", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), submitMs: POLL_MS.closed };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    expect(w.submits.length).toBe(1);
    expect(await w.shown($)).toBe("you     │ \u{f52f} 1");

    await w.clock.advance(POLL_MS.settled);
    expect(w.views.length).toBe(3);
    expect(w.submits.length).toBe(1);
  });

  test("a poll still in flight at session end leaves the status cleared", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr(""), slowMs: 10_000 });

    await $.session.start(START);
    await w.clock.settle();
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(10_000 + POLL_MS.pending * 3);

    expect(w.views.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
  });

  test("a send still in flight at session end leaves the status cleared", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), submitMs: 10_000 };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await w.clock.advance(10_000 + POLL_MS.settled * 2);

    expect(w.submits.length).toBe(1);
    expect(await w.shown($)).toBe(undefined);
    expect(w.views.length).toBe(2);
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

  test("a poll from before a restart that fails leaves the new chain alone", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), slowMs: 20_000 };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.slowMs = 1_000;
    await $.session.end({ reason: "other", sessionId: "s1", resume: { id: "s1" } });
    await $.session.start(START);
    await w.clock.advance(1_000);
    world.view = "HTTP 502: Bad Gateway";
    await w.clock.advance(19_000);
    world.view = pr("");
    await w.clock.advance(POLL_MS.pending);

    expect(w.named("poll.error")).toEqual([]);
    expect(w.views.length).toBe(3);
  });

  test("unchanged ETags skip the full read until one resource moves", async ($, on) => {
    const etags: Record<string, string> = {
      "repos/o/r/pulls/7": 'W/"p1"',
      "repos/o/r/pulls/7/reviews?per_page=100": 'W/"r1"',
      "repos/o/r/commits/aaaaaaa1111/check-runs?per_page=100": 'W/"c1"',
      "repos/o/r/commits/aaaaaaa1111/status?per_page=100": 'W/"s1"',
    };
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS"), etags };
    const w = worldOf(on, world);
    const reads = () => w.named("poll").map((e) => [e.detail?.read, e.detail?.changed]);

    await $.session.start(START);
    await w.clock.settle();
    expect(w.probes).toEqual([]);
    await w.clock.advance(POLL_MS.settled);
    await w.clock.advance(POLL_MS.settled);
    expect(w.views.length).toBe(2);
    expect(w.probes.length).toBe(8);

    world.view = pr("FAILURE");
    etags["repos/o/r/commits/aaaaaaa1111/check-runs?per_page=100"] = 'W/"c2"';
    await w.clock.advance(QUIET_MS[1] ?? 0);
    expect(w.views.length).toBe(3);
    expect(w.submits[0]).toContain("CI failed on PR #7 at aaaaaaa: ci / test.");
    expect(reads()).toEqual([
      ["full", undefined],
      ["miss", ["pull", "reviews", "checks", "statuses"]],
      ["hit", []],
      ["miss", ["checks"]],
    ]);

    world.branch = "other";
    await w.clock.advance(POLL_MS.settled);
    expect(w.probes.length).toBe(12);
    expect(w.views.length).toBe(4);
  });

  test("a probe miss whose full read fails probes as a miss again", async ($, on) => {
    const checks = "repos/o/r/commits/aaaaaaa1111/check-runs?per_page=100";
    const etags: Record<string, string> = {
      "repos/o/r/pulls/7": 'W/"p1"',
      "repos/o/r/pulls/7/reviews?per_page=100": 'W/"r1"',
      [checks]: 'W/"c1"',
      "repos/o/r/commits/aaaaaaa1111/status?per_page=100": 'W/"s1"',
    };
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS"), etags };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.settled);
    etags[checks] = 'W/"c2"';
    world.view = "HTTP 502: Bad Gateway";
    await w.clock.advance(QUIET_MS[0] ?? 0);
    expect(w.named("poll.error").length).toBe(1);

    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.error);
    expect(w.submits[0]).toContain("CI failed on PR #7 at aaaaaaa: ci / test.");
  });

  test("an undecided mergeability or a closed PR is always read in full", async ($, on) => {
    const etags: Record<string, string> = { "repos/o/r/pulls/7": 'W/"p1"' };
    const view = { ...pr("SUCCESS"), mergeable: "UNKNOWN" };
    const world: World = { branch: "topic", gh: GH_OK, view, etags };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.settled);
    world.view = { ...pr("SUCCESS"), state: "MERGED" };
    await w.clock.advance(POLL_MS.settled + POLL_MS.closed);
    expect(w.probes).toEqual([]);
    expect(w.named("poll").map((e) => e.detail?.read)).toEqual(["full", "full", "full", "full"]);
  });

  test("an injection the engine drops is logged as dropped", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);

    expect(w.named("inject")[0]).toEqual(
      expect.objectContaining({ ok: false, detail: expect.objectContaining({ dropped: "busy" }) }),
    );
  });

  test("a dropped injection is retried until the engine takes it", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), drop: "busy" };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = pr("FAILURE");
    await w.clock.advance(POLL_MS.pending);
    delete world.drop;
    await w.clock.advance(POLL_MS.settled);

    expect(w.submits.length).toBe(2);
    expect(w.submits[1]).toContain("CI failed on PR #7 at aaaaaaa: ci / test.");
    expect(w.named("inject").map((e) => [e.ok, e.detail?.attempt])).toEqual([
      [false, 1],
      [true, 2],
    ]);

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

  test("a PR with no checks and no review waits on its author", async ($, on) => {
    const w = worldOf(on, {
      branch: "topic",
      gh: GH_OK,
      view: { ...pr(""), statusCheckRollup: [] },
    });

    await $.session.start(START);
    await w.clock.settle();

    expect(await w.shown($)).toBe("you");
  });

  test("a running turn shows the agent at work on the author's move", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("FAILURE") });

    await $.session.start(START);
    await w.clock.settle();
    expect(await w.shown($)).toBe("you     │ \u{f52f} 1");

    await $.turn.start({ text: "fix it", turnId: "t1" });
    expect(await w.shown($)).toBe("agent   │ \u{f52f} 1");

    await $.turn.complete(COMPLETE);
    expect(await w.shown($)).toBe("you     │ \u{f52f} 1");
  });

  test("a second /pr closes the pane", async ($, on) => {
    const RUN = {
      command: "pr",
      args: "",
      origin: { kind: "composer" as const },
      presentation: { isFullscreen: false, columns: 120 },
    };
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("SUCCESS") });

    await $.session.start(START);
    await w.clock.settle();
    await $.command.run(RUN);
    expect(w.named("pane.open")).toHaveLength(1);
    await $.command.run(RUN);
    expect(w.named("pane.close")).toHaveLength(1);
  });

  test("the pane lists every check and the muted chatter it hides until opened", async ($, on) => {
    const ack = "<!-- reply marker -->\n✅ Actions performed";
    const w = worldOf(on, {
      branch: "topic",
      gh: GH_OK,
      view: {
        ...pr("FAILURE"),
        statusCheckRollup: [check("FAILURE"), { ...check("SUCCESS"), name: "lint" }],
        comments: [{ id: "c1", author: { login: "review-app" }, body: ack }],
      },
    });

    await $.session.start(START);
    await w.clock.settle();
    const pane = await $.ui.mount({
      plugin: "github",
      surface: "terminal",
      component: "Pane",
      requestId: "pr",
      props: {
        title: "PR",
        isFocused: false,
        bodyColumns: 60,
        placement: "dock",
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    });

    expect((await pane.find({ type: "Text", text: /✗ ci \/ test/ }))?.text).toContain(
      "✗ ci / test",
    );
    expect(await pane.find({ type: "Text", text: /✓ ci \/ lint/ })).toBeDefined();
    expect(await pane.find({ type: "Text", text: /review-app · marked/ })).toBeUndefined();

    await pane.press({ key: "muted" });
    expect((await pane.find({ type: "Text", text: /review-app/ }))?.text).toContain(
      "review-app · marked",
    );
    expect(w.named("pane.muted").map((e) => e.detail)).toEqual([{ open: true, count: 1 }]);
    await pane.unmount();
  });

  test("a failed extras read keeps the PR's last threads and merge state", async ($, on) => {
    const world: World = {
      branch: "topic",
      gh: GH_OK,
      view: pr("SUCCESS"),
      extras: { autoMergeRequest: { enabledAt: "2026-10-23T10:00:00Z" } },
    };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    expect(await w.shown($)).toBe("merging │ \u{f49e}  \u{f419}");

    world.isExtrasFailing = true;
    world.view = { ...pr("SUCCESS"), reviewDecision: "APPROVED" };
    await w.clock.advance(POLL_MS.settled);

    expect(await w.shown($)).toBe("merging │ \u{f49e}  \u{f42e}  \u{f419}");
    expect(w.named("poll.error")).toEqual([]);
    expect(w.named("extras.read").map((e) => e.detail?.error)).toEqual(["API rate limit exceeded"]);
    expect(w.submits).toEqual([]);
  });

  test("a failed check beside one still running keeps the fast poll", async ($, on) => {
    const view = {
      ...pr(""),
      statusCheckRollup: [check("FAILURE"), { ...check(""), name: "slow" }],
    };
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view });

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.pending * 3);

    expect(w.views.length).toBe(4);
  });

  test("a failing poll marks the last status stale", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("FAILURE") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    world.view = "HTTP 401: Bad credentials";
    await w.clock.advance(POLL_MS.settled);

    expect(await w.shown($)).toBe("you     │ \u{f52f} 1  \u{f421}");
  });

  test("a checkout on another forge reads as no PR, not an error", async ($, on) => {
    const view =
      "none of the git remotes configured for this repository point to a known GitHub host.";
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view });

    await $.session.start(START);
    await w.clock.settle();

    expect(w.named("poll.error")).toEqual([]);
    expect(w.named("pr.none").map((e) => e.detail?.reason)).toEqual(["not github"]);
  });

  test("failing polls wait longer each time, up to the backoff cap", async ($, on) => {
    const view = "GraphQL: API rate limit already exceeded for user ID 1.";
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view });

    await $.session.start(START);
    await w.clock.settle();
    const minute = 60_000;
    await w.clock.advance(5 * minute - TICK_MS);
    expect(w.views.length).toBe(1);
    await w.clock.advance(TICK_MS);
    expect(w.views.length).toBe(2);
    await w.clock.advance((10 + 20 + 40 + 80 + 120) * minute);
    expect(w.views.length).toBe(7);
    await w.clock.advance(120 * minute - TICK_MS);
    expect(w.views.length).toBe(7);
    await w.clock.advance(TICK_MS);
    expect(w.views.length).toBe(8);
    expect(w.named("poll.error").length).toBe(1);
  });

  test("an unchanged PR backs off until a turn or a change resets it", async ($, on) => {
    const world: World = { branch: "topic", gh: GH_OK, view: pr("SUCCESS") };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(POLL_MS.settled + QUIET_MS.reduce((sum, ms) => sum + ms));
    expect(w.views.length).toBe(8);
    expect(w.named("poll.backoff").map((e) => e.detail?.delayMs)).toEqual(QUIET_MS.slice(1));

    await w.clock.advance(30 * 60_000);
    expect(w.views.length).toBe(8);

    await $.turn.complete(COMPLETE);
    await w.clock.advance(TICK_MS);
    expect(w.views.length).toBe(9);
    expect(w.named("poll.reset").map((e) => e.detail?.cause)).toEqual(["turn"]);

    await w.clock.advance(POLL_MS.settled * 2);
    world.view = pr("FAILURE");
    await w.clock.advance(QUIET_MS[1] ?? 0);
    expect(w.submits.length).toBe(1);
    expect(w.named("poll.reset").map((e) => e.detail?.cause)).toEqual(["turn", "change"]);
  });

  test("a merged PR backs off to hourly and beyond", async ($, on) => {
    const view = { ...pr("SUCCESS"), state: "MERGED" };
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view });

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(4 * 3_600_000);
    expect(w.views.length).toBe(7);
    expect(w.named("poll.backoff").at(-1)?.detail?.delayMs).toBe(QUIET_MS.at(-1));
  });

  test("a turn soon after a poll brings the next one in to the unbacked wait", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr("SUCCESS") });

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

  test("with no PR the backoff stops at the idle cap", async ($, on) => {
    const w = worldOf(on, {
      branch: "topic",
      gh: GH_OK,
      view: 'no pull requests found for branch "topic"',
    });

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(3 * 3_600_000);
    const delays = w.named("poll.backoff").map((e) => e.detail?.delayMs);
    expect(delays).toEqual([QUIET_MS[0], QUIET_MS[1], IDLE_CAP_MS]);
  });

  test("a poll due during a sleep runs on the first tick after the wake", async ($, on) => {
    const w = worldOf(on, { branch: "topic", gh: GH_OK, view: pr(""), sleptMs: 30 * 60_000 });

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
    const world: World = { branch: "topic", gh: GH_OK, view: pr(""), isTickRefused: true };
    const w = worldOf(on, world);

    await $.session.start(START);
    await w.clock.settle();
    await w.clock.advance(TICK_MS * 10);
    expect(w.views.length).toBe(1);

    world.isTickRefused = false;
    await $.turn.complete(COMPLETE);
    await w.clock.settle();
    expect(w.views.length).toBe(2);
    expect(w.named("watch.revived")[0]?.detail).toEqual({ silentMs: TICK_MS * 10, pr: 7 });
    expect(w.named("poll.late")).toEqual([]);
    await w.clock.advance(POLL_MS.pending);
    expect(w.views.length).toBe(3);
  });
});
