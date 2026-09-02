import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { CommandOptions, RunCommand } from "../command";
import {
  collectRun,
  discoverExports,
  downloadCommand,
  listCommand,
  selectRuns,
  type WorkflowRun,
} from "../collect-ci-runs";

const ARTIFACTS = path.join(import.meta.dirname, "artifacts");

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    databaseId: 1,
    conclusion: "success",
    createdAt: "2026-08-27T06:00:00Z",
    displayTitle: "eval",
    headBranch: "main",
    ...overrides,
  };
}

const runs = [
  makeRun({ databaseId: 1, createdAt: "2026-08-25T06:00:00Z" }),
  makeRun({ databaseId: 2, createdAt: "2026-08-27T06:00:00Z" }),
  makeRun({ databaseId: 3, createdAt: "2026-08-26T06:00:00Z", conclusion: "failure" }),
  makeRun({ databaseId: 4, createdAt: "2026-08-28T06:00:00Z", conclusion: "" }),
];

test.each<{ name: string; limit: number; conclusion?: string; expected: number[] }>([
  { name: "keeps successes, newest first", limit: 5, expected: [2, 1] },
  { name: "honors the limit", limit: 1, expected: [2] },
  {
    name: "collects any conclusion on request",
    limit: 5,
    conclusion: "any",
    expected: [4, 2, 3, 1],
  },
  { name: "can ask for failures", limit: 5, conclusion: "failure", expected: [3] },
])("selectRuns $name", ({ limit, conclusion, expected }) => {
  expect(selectRuns(runs, { limit, conclusion }).map((run) => run.databaseId)).toEqual(expected);
});

test.each<{ name: string; repo?: string; expected: string[] }>([
  {
    name: "omits --repo in the current checkout",
    expected: ["gh", "run", "download", "7", "--dir", "/tmp/x"],
  },
  {
    name: "targets another repo",
    repo: "bendrucker/claude",
    expected: ["gh", "run", "download", "7", "--dir", "/tmp/x", "--repo", "bendrucker/claude"],
  },
])("downloadCommand $name", ({ repo, expected }) => {
  expect(downloadCommand(7, "/tmp/x", repo)).toEqual(expected);
});

test("listCommand asks gh for the fields the selection reads", () => {
  expect(listCommand("eval.yml", 20)).toEqual([
    "gh",
    "run",
    "list",
    "--workflow",
    "eval.yml",
    "--json",
    "databaseId,conclusion,createdAt,displayTitle,headBranch",
    "--limit",
    "20",
  ]);
});

test("discoverExports keeps promptfoo exports and skips other artifact files", async () => {
  const found = await discoverExports(ARTIFACTS);

  expect(found.map((entry) => path.relative(ARTIFACTS, entry.path))).toEqual([
    path.join("eval-output", "output.json"),
  ]);
  expect(found[0]?.payload.evalId).toBe("eval-ci1-2026-08-27T06:15:00");
});

test("discoverExports tolerates a run that downloaded nothing", async () => {
  expect(await discoverExports(path.join(ARTIFACTS, "missing"))).toEqual([]);
});

interface Call {
  command: string[];
  options: CommandOptions | undefined;
}

const ARTIFACT_FILES = [
  path.join("eval-output", "output.json"),
  path.join("eval-output", "summary.txt"),
  path.join("notes", "metadata.json"),
];

/** Stands in for gh and promptfoo: unpacks the artifact tree where `--dir` points. */
function ciRunner(calls: Call[]): RunCommand {
  return async (command, options) => {
    calls.push({ command: [...command], options });
    const target = command[command.indexOf("--dir") + 1];
    if (command[1] === "run" && target !== undefined) {
      await Promise.all(
        ARTIFACT_FILES.map((file) =>
          Bun.write(path.join(target, file), Bun.file(path.join(ARTIFACTS, file))),
        ),
      );
    }
    return { code: 0, stdout: "", stderr: "" };
  };
}

test("collectRun imports each downloaded export and files a copy", async () => {
  const calls: Call[] = [];
  const dir = await mkdtemp(path.join(tmpdir(), "eval-ci-results-"));
  try {
    const collected = await collectRun(42, { dir, suite: "pr-body", run: ciRunner(calls) });

    expect(collected.map((file) => path.relative(dir, file))).toEqual([
      path.join("pr-body", "2026-08-27-eval-ci1-2026-08-27T06-15-00.json"),
    ]);
    expect(await Bun.file(collected[0] ?? "").json()).toEqual(
      await Bun.file(path.join(ARTIFACTS, "eval-output", "output.json")).json(),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  expect(calls.map((call) => call.command.slice(0, 3))).toEqual([
    ["gh", "run", "download"],
    ["bunx", "promptfoo", "import"],
  ]);
  expect(calls[1]?.command).toContain("--force");
});
