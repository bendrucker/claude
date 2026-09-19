import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { choices, focus, formatBoard, groupThreads, message, targetAgent } from "./board";
import type { CommandResult, Runner } from "./dispatch";
import { agents, NOW, observe, pr, PROJECT, row } from "./fixture";
import { projectsDir, readProjects } from "./projects";
import { buildStatus, type Need, type Status, type Thread } from "./status";
import { appendDispatch, readLedger } from "./threads";

const ESC = "";

const thread = (need: Need, overrides: Partial<Thread> = {}): Thread => ({
  ...row({}),
  need,
  ...overrides,
});

// One thread per need the board can reach, so it has more than one section to order.
async function board(): Promise<Status> {
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
  );
}

describe("groupThreads", () => {
  test("gathers the threads by what they need, in the order Ben works through them", async () => {
    expect(
      groupThreads(await board()).map((group) => [
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
    expect(formatBoard(await board(), NOW)).toMatchInlineSnapshot(`
      "waiting-on-you
        ledger  add-outcomes  blocked     add-outcomes  30m  https://example.test/pr/1
        repo    one-off       dispatched  -             24h  -

      working
        ledger  fix-thing     dispatched  fix-thing     3h   -
      "
    `);
  });

  test("keeps a multi-line field from sliding later rows under the wrong header", () => {
    const status: Status = {
      projects: [],
      threads: [
        thread("idle", { branch: "first", pr: "https://example.test/pr/1\nstray line" }),
        thread("idle", { branch: "second", agent: "second" }),
      ],
    };
    expect(formatBoard(status, NOW)).toMatchInlineSnapshot(`
      "idle
        repo  first   dispatched  fix-thing  3h  https://example.test/pr/1 stray line
        repo  second  dispatched  second     3h  -
      "
    `);
  });

  test("strips escape and format bytes before they reach the terminal", () => {
    const status: Status = {
      projects: [],
      threads: [
        thread("idle", {
          branch: `${ESC}[2Jwiped`,
          agent: "bell",
          pr: "https://example.test/pr/1‮",
        }),
      ],
    };
    const rendered = formatBoard(status, NOW);
    expect(rendered.replaceAll("\n", "")).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(rendered).toContain("wiped");
  });

  test("keeps the board's own color codes when it paints", () => {
    const status: Status = { projects: [], threads: [thread("waiting-on-you")] };
    expect(formatBoard(status, NOW, { color: true })).toContain(`${ESC}[1mwaiting-on-you${ESC}[0m`);
  });

  test("renders an empty field as the same placeholder a missing one gets", () => {
    const status: Status = { projects: [], threads: [thread("idle", { branch: "blank", pr: "" })] };
    expect(formatBoard(status, NOW).trimEnd().endsWith("-")).toBe(true);
  });

  test("carries a read warning into the board, where a screen clear cannot reach it", () => {
    expect(
      formatBoard({ projects: [], threads: [] }, NOW, {
        warnings: ["ledger:3: not JSON, skipped"],
      }),
    ).toMatchInlineSnapshot(`
      "no open threads

      ledger:3: not JSON, skipped
      "
    `);
  });

  test("truncates every line to the given width", async () => {
    const lines = formatBoard(await board(), NOW, { truncate: 20 })
      .trimEnd()
      .split("\n");
    expect(lines.every((line) => line.length <= 20)).toBe(true);
    expect(lines).toContain("  ledger  add-outco…");
  });

  test("says so when nothing is open", () => {
    expect(formatBoard({ projects: [], threads: [] }, NOW)).toBe("no open threads\n");
  });
});

describe("targets", () => {
  test("labels every project and thread the way the board prints it", async () => {
    expect((await board()).threads).toHaveLength(3);
    expect(choices(await board(), NOW).map((choice) => choice.label)).toMatchInlineSnapshot(`
      [
        "ledger  Dispatch ledger, project routing, and the chief and lead sessions that read it  lead:live  open:2",
        "waiting-on-you  ledger  add-outcomes  blocked     add-outcomes  30m  https://example.test/pr/1",
        "waiting-on-you  repo    one-off       dispatched  -             24h  -",
        "working         ledger  fix-thing     dispatched  fix-thing     3h   -",
      ]
    `);
  });

  test("resolves a project to its lead and a thread to its agent", async () => {
    const [project, blocked] = choices(await board(), NOW);
    expect(targetAgent(project!.target)).toBe("lead-ledger");
    expect(targetAgent(blocked!.target)).toBe("add-outcomes");
  });

  test("falls back to a thread's pane when its agent is no longer live", async () => {
    const [, , oneOff, working] = choices(await board(), NOW);
    expect(oneOff!.label).toMatch(/one-off/);
    expect(targetAgent(oneOff!.target, agents())).toBe("wA:p1");
    expect(working!.label).toMatch(/fix-thing/);
    expect(targetAgent(working!.target, agents(["wZZ:p1", "fix-thing", "idle"]))).toBe("fix-thing");
    expect(targetAgent(working!.target, agents())).toBe("wZZ:p1");
  });

  test("refuses a pane another agent has taken over", async () => {
    const [, , , working] = choices(await board(), NOW);
    expect(targetAgent(working!.target, agents(["wZZ:p1", "someone-else", "idle"]))).toBeNull();
  });

  test("keeps every name targetable when herdr cannot say who is live", async () => {
    const [project, , , working] = choices(await board(), NOW);
    expect(targetAgent(project!.target, null)).toBe("lead-ledger");
    expect(targetAgent(working!.target, null)).toBe("fix-thing");
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
