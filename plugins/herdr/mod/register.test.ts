import type { AgentInfo, On, ProcessRunResult } from "claude-code";
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

const IDLE = { teammate_name: "reviewer", team_name: "team" };

const report = (seq: number, args: string) =>
  `herdr pane report-metadata w1:p1 --source bendrucker:herdr --seq ${seq} ${args}`;

const BRAND = `--display-agent ${String.fromCodePoint(0xec82)}`;

const glyph = (index: number) => String.fromCodePoint(0xf0a9e + index);

const CLEAR_ALL = [
  "subagents",
  "teammates",
  "agents_waiting",
  "agents_idle",
  "branch",
  "ctx_low",
  "ctx_mid",
  "ctx_high",
  "ctx_crit",
  "title",
]
  .map((name) => `--clear-token ${name}`)
  .join(" ");

const TAIL = "tail -c 262144 /t.jsonl";

const titleRecord = (type: string, field: string, title: string) =>
  JSON.stringify({ type, [field]: title });

const measure = (percent: number | undefined, tokens = 0) => ({
  context: { window: 1_000_000, tokens, ...(percent !== undefined && { percent }) },
  rateLimits: [],
  changed: ["context" as const],
});

function agent(status: AgentInfo["status"], teammateId?: string): AgentInfo {
  return {
    id: `a-${status}`,
    description: "",
    type: "Explore",
    status,
    kind: teammateId === undefined ? "local_agent" : "in_process_teammate",
    taskStatus: "running",
    label: "",
    startTime: 0,
    cwd: "/work",
    tokenCount: 0,
    tokenSamples: [],
    hasRow: false,
    ...(teammateId !== undefined && { teammateId }),
  };
}

function ran(exitCode: number, stdout: string, stderr: string): ProcessRunResult {
  return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false };
}

interface World {
  agents: AgentInfo[];
  branch: string;
  herdrExit: number | Error;
  emitMs: number;
  transcriptPath: string;
  tail: string;
  tailExit: number;
}

function herdrOf(on: On, env: Record<string, string>, world: Partial<World> = {}) {
  const state: World = {
    agents: [],
    branch: "main",
    herdrExit: 0,
    emitMs: 0,
    transcriptPath: "",
    tail: "",
    tailExit: 0,
    ...world,
  };
  const calls: string[] = [];
  const tails: string[] = [];
  const timeouts: (number | undefined)[] = [];
  const order: string[] = [];
  const events: {
    event: string;
    ok?: boolean | undefined;
    detail?: Readonly<Record<string, unknown>> | undefined;
  }[] = [];
  const clock = mock.clock(on);
  mock.env(on, env);
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("session.end", ($, e) => {
    order.push("session.end");
    return { sessionId: e.sessionId };
  });
  on("classic.SubagentStart", () => ({}));
  on("classic.SubagentStop", () => ({}));
  on("classic.TeammateIdle", () => ({}));
  on("agent.list", () => ({ value: state.agents }));
  on("session.info", () => ({ value: { transcriptPath: state.transcriptPath } }));
  on("session.measure", ($, e) => ({ changed: e.changed }));
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", async ($, e) => {
    if (state.emitMs > 0) await clock.sleep(state.emitMs);
    events.push({ event: e.event, ok: e.ok, detail: e.detail });
    order.push(e.event);
    return { value: undefined };
  });
  on("process.run", ($, e) => {
    if (e.argv[0] === "git") {
      return { value: ran(0, `${state.branch}\n`, "") };
    }
    if (e.argv[0] === "tail") {
      tails.push(e.argv.join(" "));
      return { value: ran(state.tailExit, state.tail, "") };
    }
    calls.push(e.argv.join(" "));
    timeouts.push(e.init?.timeoutMs);
    const exit = state.herdrExit;
    if (exit instanceof Error) throw exit;
    return { value: ran(exit, "", exit === 0 ? "" : "pane_not_found\n") };
  });
  const failures = () => events.filter((event) => event.ok === false);
  return { calls, tails, events, failures, clock, state, timeouts, order };
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

    expect(herdr.calls).toEqual([report(1, `${BRAND} --token branch=main`), report(2, CLEAR_ALL)]);
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
      report(1, `${BRAND} --token subagents=↳1 --token branch=main`),
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
      report(1, `${BRAND} --token subagents=↳1 --token branch=main`),
      report(2, "--clear-token subagents"),
    ]);
  });

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each
  for (const [name, fire] of [
    [
      "SubagentStart",
      ($: Engine) => $.classic.SubagentStart({ agent_id: "a1", agent_type: "Explore" }),
    ],
    [
      "SubagentStop",
      ($: Engine) =>
        $.classic.SubagentStop({
          agent_id: "a1",
          agent_type: "Explore",
          agent_transcript_path: "/t",
          stop_hook_active: false,
        }),
    ],
    ["TeammateIdle", ($: Engine) => $.classic.TeammateIdle(IDLE)],
  ] as const) {
    test(`${name} re-reads the counts`, async ($, on) => {
      const herdr = herdrOf(on, HERDR);

      await $.session.start(START);
      await herdr.clock.settle();
      herdr.state.agents = [agent("running")];
      await fire($);
      await herdr.clock.settle();

      expect(herdr.calls.at(-1)).toBe(report(2, "--token subagents=↳1"));
    });
  }

  test("the end's clear fits the session.end budget and is recorded before it returns", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    herdr.state.emitMs = 5;
    const ended = end($);
    await herdr.clock.advance(5);
    await ended;

    expect(herdr.timeouts.at(-1)).toBe(1000);
    expect(herdr.order.slice(-2)).toEqual(["herdr.call", "session.end"]);
  });

  test("the dial follows the context fill and clears the other three tokens", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await $.session.measure(measure(30));
    await herdr.clock.settle();
    await $.session.measure(measure(85));
    await herdr.clock.settle();

    expect(herdr.calls.slice(1)).toEqual([
      report(2, `--token ctx_low=${glyph(2)}`),
      report(3, `--clear-token ctx_low --token ctx_crit=${glyph(5)}`),
    ]);
    expect(herdr.events.filter(({ event }) => event === "dial")).toEqual([
      { event: "dial", ok: undefined, detail: { token: "ctx_low", percent: 30 } },
      { event: "dial", ok: undefined, detail: { token: "ctx_crit", percent: 85 } },
    ]);
  });

  test("a context past 200k turns the dial a step hotter", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await $.session.measure(measure(30, 250_000));
    await herdr.clock.settle();

    expect(herdr.calls.at(-1)).toBe(report(2, `--token ctx_mid=${glyph(2)}`));
  });

  test("a compacted context with no percent clears the dial", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await $.session.measure(measure(30));
    await herdr.clock.settle();
    await $.session.measure(measure(undefined));
    await herdr.clock.settle();

    expect(herdr.calls.at(-1)).toBe(report(3, "--clear-token ctx_low"));
  });

  test("a measurement where the context did not move leaves the dial", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await $.session.measure({ ...measure(85), changed: ["cost"] });
    await herdr.clock.settle();

    expect(herdr.calls).toHaveLength(1);
  });

  test("the last title record in the transcript tail names the session", async ($, on) => {
    const herdr = herdrOf(on, HERDR, {
      transcriptPath: "/t.jsonl",
      tail: [
        '{"type":"assistant","message":{"content":"cut mid-line and ai-title',
        titleRecord("ai-title", "aiTitle", "First name"),
        JSON.stringify({ type: "user", message: { content: "an ai-title quoted in a prompt" } }),
        titleRecord("custom-title", "customTitle", "Final\nname"),
        '{"type":"ai-title","aiTitle":"half written',
      ].join("\n"),
    });

    await $.session.start(START);
    await herdr.clock.settle();

    expect(herdr.tails).toEqual([TAIL]);
    expect(herdr.calls.at(-1)).toContain("--token title=Final name");
    expect(herdr.events).toContainEqual({
      event: "title",
      ok: undefined,
      detail: { title: "Final name" },
    });
  });

  test("a title that appears later is reported once and kept across a tail with none", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { transcriptPath: "/t.jsonl" });

    await $.session.start(START);
    await herdr.clock.settle();
    herdr.state.tail = titleRecord("ai-title", "aiTitle", "Named");
    await $.turn.complete(COMPLETE);
    await herdr.clock.settle();
    herdr.state.tail = "";
    await $.turn.complete(COMPLETE);
    await herdr.clock.settle();

    expect(herdr.calls.slice(1)).toEqual([report(2, "--token title=Named")]);
  });

  test("a failed tail leaves the title alone", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { transcriptPath: "/t.jsonl", tailExit: 1 });

    await $.session.start(START);
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([report(1, `${BRAND} --token branch=main`)]);
  });

  test("the full token set and the brand are re-sent hourly", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await $.session.measure(measure(30));
    await herdr.clock.settle();
    await herdr.clock.advance(3_599_000);
    const before = herdr.calls.length;
    await herdr.clock.advance(1000);
    await herdr.clock.settle();

    expect([before, herdr.calls.length]).toEqual([2, 3]);
    expect(herdr.calls.at(-1)).toBe(
      report(3, `${BRAND} --token branch=main --token ctx_low=${glyph(2)}`),
    );
  });

  test("the hourly re-send stops at the end", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await end($);
    await herdr.clock.settle();
    await herdr.clock.advance(7_200_000);

    expect(herdr.calls).toHaveLength(2);
  });

  test("a /clear keeps the tokens", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await herdr.clock.settle();
    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([report(1, `${BRAND} --token branch=main`)]);
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
      report(1, `${BRAND} --token branch=main`),
      report(2, `${BRAND} --token branch=main`),
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

  test("stops calling herdr after three failed starts", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { herdrExit: new Error("ENOENT") });

    const polled = async (turnId: string) => {
      herdr.state.agents = [agent("running")];
      await $.turn.start({ text: "hi", turnId });
      await herdr.clock.settle();
      await herdr.clock.advance(30_000);
    };

    await $.session.start(START);
    await herdr.clock.settle();
    await polled("t1");
    await polled("t2");
    await polled("t3");
    await end($);
    await herdr.clock.settle();

    expect(herdr.calls).toHaveLength(3);
    expect(herdr.events.filter(({ event }) => event === "herdr.suspend")).toEqual([
      {
        event: "herdr.suspend",
        ok: false,
        detail: { suspended: true, spawnFailures: 3 },
      },
    ]);
  });

  test("a call that starts resets the failed-start count", async ($, on) => {
    const herdr = herdrOf(on, HERDR, { herdrExit: new Error("ENOENT") });

    await $.session.start(START);
    await herdr.clock.settle();
    await $.turn.start({ text: "hi", turnId: "t1" });
    await herdr.clock.settle();
    herdr.state.herdrExit = 1;
    await $.turn.complete(COMPLETE);
    await herdr.clock.settle();
    herdr.state.herdrExit = new Error("ENOENT");
    await $.turn.start({ text: "hi", turnId: "t2" });
    await herdr.clock.settle();
    await $.turn.start({ text: "hi", turnId: "t3" });
    await herdr.clock.settle();

    expect(herdr.calls).toHaveLength(5);
    expect(herdr.events.some(({ event }) => event === "herdr.suspend")).toBe(false);
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
