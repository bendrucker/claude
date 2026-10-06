import type { AgentInfo, On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

const HERDR = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" };

const START = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

const COMPLETE = {
  answer: "",
  durationMs: 1,
  isAborted: false,
  turnId: "t1",
  reason: "answer",
} as const;

const report = (seq: number, args: string) =>
  `herdr pane report-metadata w1:p1 --source bendrucker:herdr --seq ${seq} ${args}`;

const CLEAR_ALL = ["subagents", "teammates", "agents_waiting", "agents_idle", "branch"]
  .map((name) => `--clear-token ${name}`)
  .join(" ");

function agent(status: AgentInfo["status"], teammateId?: string): AgentInfo {
  return { id: `a-${status}`, description: "", type: "Explore", status, teammateId };
}

interface World {
  agents: AgentInfo[];
  branch: string;
  herdrExit: number | Error;
}

function herdrOf(on: On, env: Record<string, string>, world: Partial<World> = {}) {
  const state: World = { agents: [], branch: "main", herdrExit: 0, ...world };
  const calls: string[] = [];
  const events: { event: string; ok?: boolean; detail?: Record<string, unknown> }[] = [];
  const clock = mock.clock(on);
  mock.env(on, env);
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("agent.list", () => ({ value: state.agents }));
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    events.push({ event: e.event, ok: e.ok, detail: e.detail });
    return { value: undefined };
  });
  on("process.run", ($, e) => {
    if (e.argv[0] === "git") {
      return { value: { exitCode: 0, stdout: `${state.branch}\n`, stderr: "" } };
    }
    calls.push(e.argv.join(" "));
    const exit = state.herdrExit;
    if (exit instanceof Error) throw exit;
    return { value: { exitCode: exit, stdout: "", stderr: exit === 0 ? "" : "pane_not_found\n" } };
  });
  const failures = () => events.filter((event) => event.ok === false);
  return { calls, events, failures, clock, state };
}

const end = ($: Engine) =>
  $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });

describe("register", () => {
  test("publishes the branch at start and clears it at the end", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await end($);
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([report(1, "--token branch=main"), report(2, CLEAR_ALL)]);
    expect(herdr.events.map(({ event, ok }) => [event, ok])).toEqual([
      ["session.start", undefined],
      ["herdr.call", true],
      ["herdr.call", true],
    ]);
  });

  test("counts live subagents and teammates by status", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    herdr.state.agents = [
      agent("running"),
      agent("waiting"),
      agent("completed"),
      agent("idle", "reviewer@team"),
    ];
    await $.turn.complete({ ...COMPLETE, agentId: "a-completed" });
    await herdr.clock.settle();

    expect(herdr.calls.at(-1)).toBe(
      report(
        2,
        "--token subagents=↳2 --token teammates=⇄1 --token agents_waiting=?1 --token agents_idle=·1",
      ),
    );
  });

  test("reports only tokens that changed", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { agents: [agent("running")] });

    await $.session.start(START);
    await herdr.clock.settle();
    await $.turn.start({ text: "hi", turnId: "t1" });
    await herdr.clock.settle();
    herdr.state.agents = [];
    herdr.state.branch = "topic";
    await $.turn.complete(COMPLETE);
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([
      report(1, "--token subagents=↳1 --token branch=main"),
      report(2, "--clear-token subagents --token branch=topic"),
    ]);
  });

  test("re-reads the counts on a timer while an agent is counted", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { agents: [agent("running")] });

    await $.session.start(START);
    await herdr.clock.settle();
    herdr.state.agents = [];
    await herdr.clock.advance(10_000);
    await herdr.clock.advance(30_000);

    expect(herdr.calls).toEqual([
      report(1, "--token subagents=↳1 --token branch=main"),
      report(2, "--clear-token subagents"),
    ]);
  });

  test("a /clear keeps the tokens", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([report(1, "--token branch=main")]);
  });

  test("a failed report emits an event and is retried on the next event", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { herdrExit: 1 });

    await $.session.start(START);
    await herdr.clock.settle();
    herdr.state.herdrExit = 0;
    await $.turn.start({ text: "hi", turnId: "t1" });
    await herdr.clock.settle();

    expect(herdr.failures()).toEqual([
      {
        event: "herdr.call",
        ok: false,
        detail: { op: "report-metadata", exitCode: 1, stderr: "pane_not_found" },
      },
    ]);
    expect(herdr.calls).toEqual([
      report(1, "--token branch=main"),
      report(2, "--token branch=main"),
    ]);
  });

  test("a herdr that cannot start emits a failed call", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { herdrExit: new Error("ENOENT") });

    await $.session.start(START);
    await herdr.clock.settle();

    expect(herdr.failures().map(({ event, detail }) => [event, detail?.exitCode])).toEqual([
      ["herdr.call", -1],
    ]);
  });

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each
  for (const [name, env, start] of [
    ["outside herdr", {}, START],
    ["with no pane", { HERDR_ENV: "1" }, START],
    ["in a -p run", HERDR, { ...START, surface: null, isInteractive: false }],
  ] as const) {
    test(`${name} nothing is reported`, async ($, on) => {
      const herdr = herdrOf(on, env);

      await $.session.start(start);
      await $.turn.start({ text: "hi", turnId: "t1" });
      await $.turn.complete(COMPLETE);
      await end($);
      await herdr.clock.settle();

      expect(herdr.calls).toEqual([]);
      expect(herdr.events).toEqual([
        { event: "session.start", ok: undefined, detail: { isHosted: false } },
      ]);
    });
  }
});
