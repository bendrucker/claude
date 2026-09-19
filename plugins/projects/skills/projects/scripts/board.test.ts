import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { choices, focus, formatBoard, groupThreads, message, targetAgent } from "./board";
import type { CommandResult, Runner } from "./dispatch";
import { NOW, PROJECT, row } from "./fixture";
import { projectsDir, readProjects } from "./projects";
import { buildStatus, type Status } from "./status";
import { appendDispatch, readLedger } from "./threads";

const ESC = "";

// Two workspaces, so the board has more than one section to order.
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
    new Set(["lead-ledger", "add-outcomes"]),
  );
}

describe("groupThreads", () => {
  test("nests tagged threads under their project, in workspace order", async () => {
    expect(
      groupThreads(await board()).map((group) => [
        group.workspace,
        group.projects.map((project) => [project.slug, project.threads.map((r) => r.branch)]),
        group.threads.map((r) => r.branch),
      ]),
    ).toEqual([
      ["claude", [["ledger", ["fix-thing", "add-outcomes"]]], []],
      ["dotfiles", [], ["one-off"]],
    ]);
  });
});

describe("formatBoard", () => {
  test("renders a section per workspace", async () => {
    expect(formatBoard(await board(), NOW)).toMatchInlineSnapshot(`
      "claude
        ledger  Dispatch ledger, project routing, and the chief and lead sessions that read it
          fix-thing     dispatched  fix-thing     3h   -
          add-outcomes  blocked     add-outcomes  30m  https://example.test/pr/1

      dotfiles
        one-off  dispatched  -  24h  -
      "
    `);
  });

  test("keeps a multi-line field from sliding later rows under the wrong header", () => {
    const status: Status = {
      projects: [],
      threads: [
        row({ branch: "first", pr: "https://example.test/pr/1\nstray line" }),
        row({ branch: "second", agent: "second" }),
      ],
    };
    expect(formatBoard(status, NOW)).toMatchInlineSnapshot(`
      "wZZ
        first   dispatched  fix-thing  3h  https://example.test/pr/1 stray line
        second  dispatched  second     3h  -
      "
    `);
  });

  test("strips escape and format bytes before they reach the terminal", () => {
    const status: Status = {
      projects: [],
      threads: [
        row({
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
    const status: Status = { projects: [], threads: [row({ branch: "painted" })] };
    expect(formatBoard(status, NOW, { color: true })).toContain(`${ESC}[1mwZZ${ESC}[0m`);
  });

  test("renders an empty field as the same placeholder a missing one gets", () => {
    const status: Status = { projects: [], threads: [row({ branch: "blank", pr: "" })] };
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
    expect(lines).toContain("  ledger  Dispatch …");
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
        "fix-thing     dispatched  fix-thing     3h   -",
        "add-outcomes  blocked     add-outcomes  30m  https://example.test/pr/1",
        "one-off       dispatched  -             24h  -",
      ]
    `);
  });

  test("resolves a project to its lead and a thread to its agent", async () => {
    const [project, , , oneOff] = choices(await board(), NOW);
    expect(targetAgent(project!.target)).toBe("lead-ledger");
    expect(targetAgent(oneOff!.target)).toBeNull();
  });

  test("has nothing to target when a thread's agent is no longer live", async () => {
    const [, thread] = choices(await board(), NOW);
    expect(targetAgent(thread!.target, new Set(["fix-thing"]))).toBe("fix-thing");
    expect(targetAgent(thread!.target, new Set())).toBeNull();
  });

  test("keeps every name targetable when herdr cannot say who is live", async () => {
    const [project] = choices(await board(), NOW);
    expect(targetAgent(project!.target, null)).toBe("lead-ledger");
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
