import type { On } from "claude-code";
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

function herdrOf(on: On, env: Record<string, string>, exitCode: number | Error = 0) {
  const calls: string[] = [];
  const logs: string[] = [];
  const clock = mock.clock(on);
  mock.env(on, env);
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("tool.call", () => ({ result: "answered" }));
  on("ui.log", ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  on("process.run", ($, e) => {
    calls.push(e.argv.join(" "));
    if (exitCode instanceof Error) throw exitCode;
    return { value: { exitCode, stdout: "", stderr: exitCode === 0 ? "" : "pane_not_found\n" } };
  });
  return { calls, logs, clock };
}

const end = ($: Engine) =>
  $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });

describe("register", () => {
  test("reports each main-loop transition, then releases", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await $.turn.start({ text: "hi", turnId: "t1" });
    await $.turn.complete({ ...COMPLETE, agentId: "a1" });
    await $.turn.complete(COMPLETE);
    await end($);
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([
      "herdr pane report-agent --state idle --source bendrucker:herdr --agent claude --seq 1 w1:p1",
      "herdr pane report-agent --state working --source bendrucker:herdr --agent claude --seq 2 w1:p1",
      "herdr pane report-agent --state idle --source bendrucker:herdr --agent claude --seq 3 w1:p1",
      "herdr pane release-agent --source bendrucker:herdr --agent claude --seq 4 w1:p1",
    ]);
  });

  test("a /clear keeps the pane reporting", async ($, on) => {
    const herdr = herdrOf(on, HERDR);

    await $.session.start(START);
    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
    await $.turn.start({ text: "hi", turnId: "t1" });
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([
      "herdr pane report-agent --state idle --source bendrucker:herdr --agent claude --seq 1 w1:p1",
      "herdr pane report-agent --state idle --source bendrucker:herdr --agent claude --seq 2 w1:p1",
      "herdr pane report-agent --state working --source bendrucker:herdr --agent claude --seq 3 w1:p1",
    ]);
  });

  test("an AskUserQuestion blocks until it is answered", async ($, on) => {
    const herdr = herdrOf(on, { ...HERDR, HERDR_BIN_PATH: "/opt/herdr" });

    await $.session.start(START);
    await $.tool.call({ tool: "AskUserQuestion", questions: [] });
    await herdr.clock.settle();

    expect(herdr.calls).toEqual([
      "/opt/herdr pane report-agent --state idle --source bendrucker:herdr --agent claude --seq 1 w1:p1",
      "/opt/herdr pane report-agent --state blocked --source bendrucker:herdr --agent claude --seq 2 w1:p1",
      "/opt/herdr pane report-agent --state working --source bendrucker:herdr --agent claude --seq 3 w1:p1",
    ]);
  });

  test("a failed report goes to the debug log", async ($, on) => {
    const herdr = herdrOf(on, HERDR, 1);

    await $.session.start(START);
    await herdr.clock.settle();

    expect(herdr.logs).toEqual(["herdr report-agent failed: pane_not_found"]);
  });

  test("a herdr that cannot start goes to the debug log", async ($, on) => {
    const herdr = herdrOf(on, HERDR, new Error("ENOENT"));

    await $.session.start(START);
    await end($);
    await herdr.clock.settle();

    expect(herdr.logs.map((line) => line.split(":")[0])).toEqual([
      "herdr report-agent failed",
      "herdr release-agent failed",
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
    });
  }
});
