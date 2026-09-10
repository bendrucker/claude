import { describe, expect, test } from "bun:test";
import { type Change, render, type SemResult, type Sources, scopeBlock } from "./sem-scope";

function change(overrides: Partial<Change> = {}): Change {
  return {
    entityId: "plugins/writing/hooks/pretooluse.ts::function::dispatch",
    changeType: "modified",
    entityType: "function",
    entityName: "dispatch",
    oldEntityName: null,
    filePath: "plugins/writing/hooks/pretooluse.ts",
    oldFilePath: null,
    structuralChange: true,
    ...overrides,
  };
}

function sources(overrides: Partial<Sources> = {}): Sources {
  return {
    runSem: () => Promise.resolve({ ok: true, stdout: JSON.stringify({ changes: [] }) }),
    mergeBase: () => Promise.resolve("abc123"),
    ...overrides,
  };
}

function lines(block: string): string[] {
  return block.split("\n");
}

function oneRow(row: string): string {
  return [
    "Entities (origin/main...HEAD, structural only):",
    "  plugins/writing/hooks/pretooluse.ts",
    `    ${row}`,
  ].join("\n");
}

describe("render", () => {
  test.each<[string, Partial<Change>, string]>([
    ["added", { changeType: "added" }, "A function dispatch"],
    ["modified", { changeType: "modified" }, "M function dispatch"],
    ["deleted", { changeType: "deleted" }, "D function dispatch"],
    ["moved", { changeType: "moved" }, "V function dispatch"],
    ["reordered", { changeType: "reordered" }, "O function dispatch"],
    [
      "renamed, keeping both names",
      { changeType: "renamed", entityName: "newName", oldEntityName: "oldName" },
      "R function oldName → newName",
    ],
    [
      "moved from another file, naming it",
      { changeType: "moved", oldFilePath: "plugins/writing/hooks/old.ts" },
      "V function dispatch (from plugins/writing/hooks/old.ts)",
    ],
  ])("%s prints as %p", (_name, overrides, row) => {
    expect(render([change(overrides)], "origin/main...HEAD")).toBe(oneRow(row));
  });

  test.each([
    [
      "chunks collapse per file, not per row",
      [
        change({ entityType: "chunk", filePath: "a.snap", structuralChange: null }),
        change({ entityType: "chunk", filePath: "a.snap", structuralChange: null }),
        change({ entityType: "chunk", filePath: "b.snap", structuralChange: null }),
      ],
      "  unparsed: 2 files",
    ],
    [
      "cosmetic entities collapse into a count",
      [change(), change({ structuralChange: false }), change({ structuralChange: false })],
      "  cosmetic-only: 2 entities",
    ],
    [
      "orphans collapse into the module-level count",
      [change(), change({ entityType: "orphan", structuralChange: null })],
      "  module-level: 1",
    ],
    [
      "a null structuralChange stays a row",
      [change({ structuralChange: null }), change({ entityType: "orphan" })],
      "  module-level: 1",
    ],
    [
      "every collapsed kind shares one line",
      [
        change(),
        change({ structuralChange: false }),
        change({ entityType: "orphan", structuralChange: null }),
        change({ entityType: "chunk", filePath: "a.snap", structuralChange: null }),
      ],
      "  cosmetic-only: 1 entity · module-level: 1 · unparsed: 1 file",
    ],
  ])("%s", (_name, changes, trailer) => {
    expect(lines(render(changes, "origin/main...HEAD")).at(-1)).toBe(trailer);
  });

  test("an all-cosmetic diff says so instead of counting", () => {
    const cosmetic = [change({ structuralChange: false }), change({ structuralChange: false })];
    expect(render(cosmetic, "origin/main...HEAD")).toBe(
      "Entities (origin/main...HEAD, structural only):\n  cosmetic-only diff",
    );
  });

  test("a structural-only diff has no trailing count", () => {
    expect(lines(render([change()], "origin/main...HEAD")).at(-1)).toBe("    M function dispatch");
  });

  test("an empty change list says so", () => {
    expect(render([], "origin/main...HEAD")).toBe(
      "Entities (origin/main...HEAD, structural only):\n  no entity changes",
    );
  });

  test("files sort and group their own rows", () => {
    expect(
      render(
        [
          change({ filePath: "z.ts", entityName: "last" }),
          change({ filePath: "a.ts", entityName: "first" }),
          change({ filePath: "z.ts", entityName: "also-last", changeType: "added" }),
        ],
        "origin/main...HEAD",
      ),
    ).toMatchSnapshot();
  });
});

describe("scopeBlock", () => {
  test("--base diffs the merge-base against the working tree", async () => {
    const calls: string[][] = [];
    const block = await scopeBlock(
      { base: "origin/main" },
      sources({
        mergeBase: (base) => Promise.resolve(base === "origin/main" ? "deadbeef" : null),
        runSem: (args): Promise<SemResult> => {
          calls.push(args);
          return Promise.resolve({ ok: true, stdout: JSON.stringify({ changes: [change()] }) });
        },
      }),
    );

    expect(calls).toEqual([["diff", "deadbeef", "--format", "json"]]);
    expect(lines(block)[0]).toBe("Entities (origin/main...HEAD, structural only):");
  });

  test("--range passes the range through and labels the block with it", async () => {
    const calls: string[][] = [];
    const block = await scopeBlock(
      { range: "main...feature" },
      sources({
        mergeBase: () => {
          throw new Error("merge-base should not run for an explicit range");
        },
        runSem: (args): Promise<SemResult> => {
          calls.push(args);
          return Promise.resolve({ ok: true, stdout: JSON.stringify({ changes: [change()] }) });
        },
      }),
    );

    expect(calls).toEqual([["diff", "main...feature", "--format", "json"]]);
    expect(lines(block)[0]).toBe("Entities (main...feature, structural only):");
  });

  test("a missing binary prints the install note", async () => {
    expect(
      await scopeBlock(
        { base: "origin/main" },
        sources({ runSem: () => Promise.resolve({ ok: false, reason: "missing" }) }),
      ),
    ).toBe("sem: not installed (brew install sem-cli)");
  });

  test.each([
    [
      "sem exits non-zero",
      sources({ runSem: () => Promise.resolve({ ok: false, reason: "failed" }) }),
    ],
    [
      "stdout is not JSON",
      sources({ runSem: () => Promise.resolve({ ok: true, stdout: "not json" }) }),
    ],
    [
      "the JSON does not match the schema",
      sources({
        runSem: () => Promise.resolve({ ok: true, stdout: JSON.stringify({ changes: [{}] }) }),
      }),
    ],
    ["the base does not resolve", sources({ mergeBase: () => Promise.resolve(null) })],
  ])("%s leaves the block out", async (_name, injected) => {
    expect(await scopeBlock({ base: "origin/main" }, injected)).toBe("");
  });

  test("unknown JSON fields do not reject the diff", async () => {
    const stdout = JSON.stringify({
      summary: { total: 1 },
      binaryChanges: [],
      changes: [{ ...change(), startLine: 1, beforeContent: null, afterContent: "x" }],
    });
    const block = await scopeBlock(
      { base: "origin/main" },
      sources({ runSem: () => Promise.resolve({ ok: true, stdout }) }),
    );
    expect(lines(block).at(-1)).toBe("    M function dispatch");
  });
});
