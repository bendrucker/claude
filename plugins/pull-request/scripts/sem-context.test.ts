import { describe, expect, test } from "bun:test";
import { type BaseLookups, type Change, render, resolveBase, stackParent } from "./sem-context";

function change(overrides: Partial<Change> & Pick<Change, "entityName" | "filePath">): Change {
  return {
    entityId: overrides.entityName,
    changeType: "modified",
    entityType: "function",
    oldEntityName: null,
    oldFilePath: null,
    structuralChange: true,
    ...overrides,
  };
}

describe("render", () => {
  test("renders a mixed diff grouped by file", () => {
    const changes = [
      change({ entityName: "dispatch", filePath: "hooks/pretooluse.ts" }),
      change({ entityName: "targetOf", filePath: "hooks/pretooluse.ts", changeType: "added" }),
      change({
        entityName: "newName",
        filePath: "hooks/pretooluse.ts",
        changeType: "renamed",
        oldEntityName: "oldName",
      }),
      change({
        entityName: "relocated",
        filePath: "hooks/pretooluse.ts",
        changeType: "moved",
        oldFilePath: "hooks/legacy.ts",
      }),
      change({ entityName: "ordering", filePath: "hooks/pretooluse.ts", changeType: "reordered" }),
      change({
        entityName: "retired",
        filePath: "scripts/scan.ts",
        changeType: "deleted",
        entityType: "method",
      }),
      change({ entityName: "spacing", filePath: "scripts/scan.ts", structuralChange: false }),
      change({ entityName: "imports", filePath: "scripts/scan.ts", entityType: "orphan" }),
      change({
        entityName: "chunk-1",
        filePath: "scripts/__snapshots__/a.snap",
        entityType: "chunk",
      }),
      change({
        entityName: "chunk-2",
        filePath: "scripts/__snapshots__/a.snap",
        entityType: "chunk",
      }),
    ];

    expect(render(changes, { base: "origin/main" })).toMatchSnapshot();
  });

  test.each<[string, Change[], string, string]>([
    [
      "reports a cosmetic-only diff",
      [
        change({ entityName: "a", filePath: "src/a.ts", structuralChange: false }),
        change({ entityName: "b", filePath: "src/a.ts", structuralChange: false }),
      ],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  cosmetic-only diff\n  cosmetic-only: 2 entities",
    ],
    [
      "keeps the count line beside a cosmetic-only body",
      [
        change({ entityName: "a", filePath: "src/a.ts", structuralChange: false }),
        change({ entityName: "chunk-1", filePath: "a.snap", entityType: "chunk" }),
      ],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  cosmetic-only diff\n  cosmetic-only: 1 entity · unparsed: 1 file",
    ],
    ["reports no changes at all", [], "origin/main", "Entities (origin/main...HEAD): none"],
    [
      "omits the count line when nothing was dropped",
      [change({ entityName: "dispatch", filePath: "src/a.ts" })],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  src/a.ts\n    M function dispatch",
    ],
    [
      "counts module-level rows with no body of their own",
      [change({ entityName: "imports", filePath: "src/a.ts", entityType: "orphan" })],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  module-level: 1",
    ],
    [
      "drops a chunk row that also reports no structural change",
      [
        change({
          entityName: "chunk-1",
          filePath: "a.snap",
          entityType: "chunk",
          structuralChange: false,
        }),
      ],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  unparsed: 1 file",
    ],
    [
      "keeps a row whose structural flag is unknown",
      [change({ entityName: "widget", filePath: "src/a.ts", structuralChange: null })],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  src/a.ts\n    M function widget",
    ],
    [
      "names the resolved base in the header",
      [change({ entityName: "dispatch", filePath: "src/a.ts" })],
      "origin/feature",
      "Entities (origin/feature...HEAD, structural only):\n  src/a.ts\n    M function dispatch",
    ],
    [
      "falls back to a modified marker on an unrecognized change type",
      [change({ entityName: "dispatch", filePath: "src/a.ts", changeType: "resurrected" })],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  src/a.ts\n    M function dispatch",
    ],
    [
      "prints a rename with no path change as a bare name",
      [
        change({
          entityName: "dispatch",
          filePath: "src/a.ts",
          changeType: "renamed",
          oldEntityName: "dispatch",
        }),
      ],
      "origin/main",
      "Entities (origin/main...HEAD, structural only):\n  src/a.ts\n    R function dispatch",
    ],
  ])("%s", (_name, changes, base, expected) => {
    expect(render(changes, { base })).toBe(expected);
  });
});

describe("stackParent", () => {
  const stack = ["root", "\tchild", "\t\tgrandchild", "\tsibling", "", "loner"].join("\n");

  test.each<[string, string, string | null]>([
    ["finds the parent one tab up", "child", "root"],
    ["finds the nearest parent for a deeper layer", "grandchild", "child"],
    ["skips past a deeper preceding layer", "sibling", "root"],
    ["returns null at depth zero", "root", null],
    ["returns null for another branch at depth zero", "loner", null],
    ["returns null for a branch the stack does not list", "absent", null],
  ])("%s", (_name, branch, expected) => {
    expect(stackParent(stack, branch)).toBe(expected);
  });
});

describe("resolveBase", () => {
  const stack = ["root", "\tchild"].join("\n");

  function lookups(overrides: Partial<BaseLookups>): BaseLookups {
    return {
      prBase: () => Promise.resolve(null),
      currentBranch: () => Promise.resolve("child"),
      stackFile: () => Promise.resolve(null),
      originHead: () => Promise.resolve(null),
      ...overrides,
    };
  }

  test("prefers the PR base ref", async () => {
    const base = await resolveBase(
      lookups({
        prBase: () => Promise.resolve("release"),
        stackFile: () => Promise.resolve(stack),
        originHead: () => Promise.resolve("refs/remotes/origin/trunk"),
      }),
    );
    expect(base).toBe("origin/release");
  });

  test("falls back to the stack parent", async () => {
    const base = await resolveBase(
      lookups({
        stackFile: () => Promise.resolve(stack),
        originHead: () => Promise.resolve("refs/remotes/origin/trunk"),
      }),
    );
    expect(base).toBe("origin/root");
  });

  test("falls back to the default branch when the stack lists no parent", async () => {
    const base = await resolveBase(
      lookups({
        currentBranch: () => Promise.resolve("root"),
        stackFile: () => Promise.resolve(stack),
        originHead: () => Promise.resolve("refs/remotes/origin/trunk"),
      }),
    );
    expect(base).toBe("origin/trunk");
  });

  test("falls back to origin/main when every lookup misses", async () => {
    expect(await resolveBase(lookups({}))).toBe("origin/main");
  });
});
