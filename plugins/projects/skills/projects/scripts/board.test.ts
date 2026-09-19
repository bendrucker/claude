import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { choices, focus, formatBoard, groupThreads, message, targetAgent } from "./board";
import type { CommandResult, Runner } from "./dispatch";
import { agents, item, NOW, observe, pr, PROJECT, row } from "./fixture";
import type { QueueItem } from "./items";
import { projectsDir, readProjects } from "./projects";
import { buildStatus, type Need, type Status, type Thread } from "./status";
import { appendDispatch, readLedger } from "./threads";

const ESC = "";

const thread = (need: Need, overrides: Partial<Thread> = {}): Thread => ({
  ...row({}),
  need,
  ...overrides,
});

const board = (threads: Thread[], queue: QueueItem[] = []): Status => ({
  projects: [],
  threads,
  queue,
});

// One thread per need the board can reach, so it has more than one section to order.
async function ledgerBoard(queue: QueueItem[] = []): Promise<Status> {
  const dataDir = mkdtempSync(join(tmpdir(), "board-"));
  const rows = [
    row({ workspace: "claude", tags: { project: "ledger", by: "lead-ledger" } }),
    row({
      branch: "add-outcomes",
      agent: "add-outcomes",
      pane: "wZZ:p2",
      workspace: "claude",
      tags: { project: "ledger", by: "lead-ledger" },
    }),
    row({
      ts: "2026-09-17T12:00:00.000Z",
      branch: "one-off",
      agent: null,
      workspace: "dotfiles",
      pane: "wA:p1",
      tags: { by: "chief" },
    }),
    row({
      ts: "2026-09-18T11:30:00.000Z",
      branch: "add-outcomes",
      agent: "add-outcomes",
      pane: "wZZ:p2",
      workspace: "claude",
      outcome: "blocked",
      pr: "https://example.test/pr/1",
      tags: { project: "ledger", by: "lead-ledger" },
    }),
  ];
  for (const entry of rows) appendDispatch(entry, dataDir);
  mkdirSync(join(projectsDir(dataDir), "ledger"), { recursive: true });
  await Bun.write(join(projectsDir(dataDir), "ledger", "project.md"), PROJECT);
  return buildStatus(
    await readProjects(dataDir),
    await readLedger(dataDir),
    {},
    observe({
      agents: agents(
        ["wZZ:p1", "fix-thing", "working"],
        ["wZZ:p2", "add-outcomes", "idle"],
        ["wLD:p1", "lead-ledger", "idle"],
      ),
      pullRequests: new Map([["https://example.test/pr/1", pr()]]),
    }),
    queue,
  );
}

describe("groupThreads", () => {
  test("gathers the threads by what they need, in the order Ben works through them", async () => {
    expect(
      groupThreads(await ledgerBoard()).map((group) => [
        group.need,
        group.threads.map((entry) => entry.branch),
      ]),
    ).toEqual([
      ["waiting-on-you", ["add-outcomes", "one-off"]],
      ["working", ["fix-thing"]],
    ]);
  });
});

describe("formatBoard", () => {
  test("renders a section per need, with every row naming where it came from", async () => {
    expect(formatBoard(await ledgerBoard(), NOW)).toMatchInlineSnapshot(`
      "NEEDS YOU
        observed
          ledger  add-outcomes  blocked     add-outcomes  30m  https://example.test/pr/1
          repo    one-off       dispatched  -             24h  -

      working
        ledger    fix-thing     dispatched  fix-thing     3h   -
      "
    `);
  });

  test("keeps a multi-line field from sliding later rows under the wrong header", () => {
    const status = board([
      thread("idle", { branch: "first", pr: "https://example.test/pr/1\nstray line" }),
      thread("idle", { branch: "second", agent: "second" }),
    ]);
    expect(formatBoard(status, NOW)).toMatchInlineSnapshot(`
      "idle
        repo  first   dispatched  fix-thing  3h  https://example.test/pr/1 stray line
        repo  second  dispatched  second     3h  -
      "
    `);
  });

  test("strips escape and format bytes before they reach the terminal", () => {
    const status = board([
      thread("idle", {
        branch: `${ESC}[2Jwiped`,
        agent: "bell",
        pr: "https://example.test/pr/1‮",
      }),
    ]);
    const rendered = formatBoard(status, NOW);
    expect(rendered.replaceAll("\n", "")).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(rendered).toContain("wiped");
  });

  test("keeps the board's own color codes when it paints", () => {
    const status = board([thread("waiting-on-you")]);
    expect(formatBoard(status, NOW, { color: true })).toContain(`${ESC}[1mNEEDS YOU${ESC}[0m`);
  });

  test("renders an empty field as the same placeholder a missing one gets", () => {
    const status = board([thread("idle", { branch: "blank", pr: "" })]);
    expect(formatBoard(status, NOW).trimEnd().endsWith("-")).toBe(true);
  });

  test("carries a read warning into the board, where a screen clear cannot reach it", () => {
    expect(
      formatBoard(board([]), NOW, {
        warnings: ["ledger:3: not JSON, skipped"],
      }),
    ).toMatchInlineSnapshot(`
      "no open threads

      ledger:3: not JSON, skipped
      "
    `);
  });

  test("truncates every line to the given width", async () => {
    const lines = formatBoard(await ledgerBoard(), NOW, { truncate: 20 })
      .trimEnd()
      .split("\n");
    expect(lines.every((line) => line.length <= 20)).toBe(true);
    expect(lines).toContain("    ledger  add-out…");
  });

  test("says so when nothing is open", () => {
    expect(formatBoard(board([]), NOW)).toBe("no open threads\n");
  });

  test("heads the board with what Ben was asked, and keeps what it inferred beneath", async () => {
    expect(
      formatBoard(
        await ledgerBoard([
          item({ id: "q1", kind: "review", text: "read the diff", agent: "add-outcomes" }),
          item({ id: "q2", ts: "2026-09-18T11:00:00.000Z", agent: "fix-thing" }),
        ]),
        NOW,
      ),
    ).toMatchInlineSnapshot(`
      "NEEDS YOU
        q1  review    3h  add-outcomes  read the diff       -
        q2  question  1h  fix-thing     which base branch?  -
        observed
          ledger  add-outcomes  blocked     add-outcomes  30m  https://example.test/pr/1
          repo    one-off       dispatched  -             24h  -

      working
        ledger    fix-thing     dispatched  fix-thing     3h   -
      "
    `);
  });

  test("keeps the section without the observed block when nothing derived it", () => {
    expect(formatBoard(board([thread("working")], [item({ id: "q1" })]), NOW))
      .toMatchInlineSnapshot(`
      "NEEDS YOU
        q1  question  3h  -  which base branch?  -

      working
        repo  fix-thing  dispatched  fix-thing  3h  -
      "
    `);
  });
});

describe("targets", () => {
  test("labels every project and thread the way the board prints it", async () => {
    expect((await ledgerBoard()).threads).toHaveLength(3);
    expect(choices(await ledgerBoard(), NOW).map((choice) => choice.label)).toMatchInlineSnapshot(`
      [
        "ledger  Dispatch ledger, project routing, and the chief and lead sessions that read it  lead:live  open:2",
        "waiting-on-you  ledger  add-outcomes  blocked     add-outcomes  30m  https://example.test/pr/1",
        "waiting-on-you  repo    one-off       dispatched  -             24h  -",
        "working         ledger  fix-thing     dispatched  fix-thing     3h   -",
      ]
    `);
  });

  test("resolves a project to its lead and a thread to its agent", async () => {
    const [project, blocked] = choices(await ledgerBoard(), NOW);
    expect(targetAgent(project!.target)).toBe("lead-ledger");
    expect(targetAgent(blocked!.target)).toBe("add-outcomes");
  });

  test("falls back to a thread's pane when its agent is no longer live", async () => {
    const [, , oneOff, working] = choices(await ledgerBoard(), NOW);
    expect(oneOff!.label).toMatch(/one-off/);
    expect(targetAgent(oneOff!.target, agents())).toBe("wA:p1");
    expect(working!.label).toMatch(/fix-thing/);
    expect(targetAgent(working!.target, agents(["wZZ:p1", "fix-thing", "idle"]))).toBe("fix-thing");
    expect(targetAgent(working!.target, agents())).toBe("wZZ:p1");
  });

  test("refuses a pane another agent has taken over", async () => {
    const [, , , working] = choices(await ledgerBoard(), NOW);
    expect(targetAgent(working!.target, agents(["wZZ:p1", "someone-else", "idle"]))).toBeNull();
  });

  test("keeps every name targetable when herdr cannot say who is live", async () => {
    const [project, , , working] = choices(await ledgerBoard(), NOW);
    expect(targetAgent(project!.target, null)).toBe("lead-ledger");
    expect(targetAgent(working!.target, null)).toBe("fix-thing");
  });

  test("offers the queue before anything the board worked out for itself", async () => {
    const status = await ledgerBoard([item({ id: "q1", agent: "fix-thing" })]);
    const picked = choices(status, NOW);
    expect(picked[0]?.label).toMatch(/^q1\s+question/);
    expect(picked[1]?.label).toMatch(/^ledger/);
    expect(targetAgent(picked[0]!.target)).toBe("fix-thing");
  });

  test.each<[string, Partial<QueueItem>, string | null]>([
    ["the pane, once its agent is gone", { agent: "gone", pane: "wA:p1" }, "wA:p1"],
    ["nothing, with neither left", { agent: "gone" }, null],
  ])("resolves an item to %s", (_label, overrides, expected) => {
    const status = board([], [item({ id: "q1", ...overrides })]);
    const [picked] = choices(status, NOW);
    expect(targetAgent(picked!.target, agents())).toBe(expected);
  });

  test("has no lead to target when none is live", () => {
    expect(
      targetAgent({
        kind: "project",
        project: {
          slug: "p",
          name: "P",
          description: "d",
          repo: "/repo",
          lead: "none",
          open: 0,
        },
      }),
    ).toBeNull();
  });
});

describe("herdr commands", () => {
  const record = (): { calls: string[][]; run: Runner } => {
    const calls: string[][] = [];
    const result: CommandResult = { code: 0, stdout: "", stderr: "" };
    return {
      calls,
      run: (argv) => {
        calls.push([...argv]);
        return Promise.resolve(result);
      },
    };
  };

  test("focuses an agent's pane", async () => {
    const { calls, run } = record();
    await focus("lead-ledger", run);
    expect(calls).toEqual([["herdr", "agent", "focus", "lead-ledger"]]);
  });

  test("sends a message as one argv element", async () => {
    const { calls, run } = record();
    await message("add-outcomes", "what is blocking you?", run);
    expect(calls).toEqual([["herdr", "agent", "prompt", "add-outcomes", "what is blocking you?"]]);
  });
});
