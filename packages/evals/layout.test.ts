import { expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { serializeCase, writeCases } from "./cases";
import {
  artifactsPath,
  listCases,
  listTraces,
  parseResultPath,
  parseRunId,
  readCase,
  runId,
  suiteName,
  tracePath,
} from "./layout";
import { eachRun, Result } from "./result";

const tmp = () => mkdtempSync(join(tmpdir(), "layout-"));

test("listCases names the child directories holding case.yaml, sorted", async () => {
  const suite = tmp();
  await Promise.all([
    Bun.write(join(suite, "b/case.yaml"), "tags: []\n"),
    Bun.write(join(suite, "a/case.yaml"), "tags: []\n"),
    Bun.write(join(suite, "graders/x.md"), "---\ntype: regex\n---\n"),
    Bun.write(join(suite, "suite.yaml"), "{}\n"),
  ]);
  expect(await listCases(suite)).toEqual(["a", "b"]);
});

test("readCase applies defaults and keeps unknown keys", async () => {
  const suite = tmp();
  await Bun.write(join(suite, "c/case.yaml"), "name: c\ntags: [x]\n");
  expect(await readCase(suite, "c")).toEqual({ name: "c", tags: ["x"], plugins: [] });
});

test("serializeCase round-trips through the yaml parser", () => {
  const file = {
    schema_version: "1.1",
    name: "decide-x",
    tags: ["decide", "train"],
    plugins: ["../../.."],
    execution: { max_turns: 4, append_system_prompt: "line one: with colon\nline two" },
  };
  expect(parse(serializeCase(file))).toEqual(file);
});

test("writeCases writes changed files and removes stale ones under the prefix", async () => {
  const suite = tmp();
  await Promise.all([
    Bun.write(join(suite, "gen-keep/case.yaml"), "same\n"),
    Bun.write(join(suite, "gen-keep/old.md"), "stale\n"),
    Bun.write(join(suite, "gen-gone/case.yaml"), "x\n"),
    Bun.write(join(suite, "hand/case.yaml"), "untouched\n"),
  ]);
  const { written, removed } = await writeCases(
    suite,
    { "gen-keep/case.yaml": "same\n", "gen-new/case.yaml": "new\n" },
    { prefix: "gen-" },
  );
  expect(written).toEqual(["gen-new/case.yaml"]);
  expect(removed.toSorted()).toEqual(["gen-gone", "gen-gone/case.yaml", "gen-keep/old.md"]);
  expect(await listCases(suite)).toEqual(["gen-keep", "gen-new", "hand"]);
  expect(await Bun.file(join(suite, "gen-keep/old.md")).exists()).toBe(false);
  expect(await Bun.file(join(suite, "gen-new/case.yaml")).text()).toBe("new\n");
});

test.each([
  ["c-with-0", { case: "c", arm: "with", n: 0 }],
  ["multi-part-case-without-12", { case: "multi-part-case", arm: "without", n: 12 }],
  ["c-with-2.jsonl", { case: "c", arm: "with", n: 2 }],
  ["rank-x-base-3", { case: "rank-x", arm: "base", n: 3 }],
])("parseRunId(%p)", (stem, expected) => {
  expect(parseRunId(stem)).toEqual(expected);
});

test.each(["c-with", "with-0", "c-with-x", "c.jsonl"])("parseRunId(%p) is undefined", (stem) => {
  expect(parseRunId(stem)).toBeUndefined();
});

test("parseRunId inverts runId for any case name and dash-free arm", () => {
  hegel.test((tc) => {
    const name = tc.draw(gs.text({ alphabet: "ab-1", minSize: 1 }));
    const arm = tc.draw(gs.text({ alphabet: "ab1", minSize: 1 }));
    const n = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
    expect(parseRunId(runId(name, arm, n))).toEqual({ case: name, arm, n });
  });
});

test("runId, tracePath and parseRunId agree", () => {
  expect(runId("a-b", "with", 10)).toBe("a-b-with-10");
  expect(tracePath("/r", "a-b", "with", 10)).toBe("/r/traces/a-b-with-10.jsonl");
  expect(parseRunId(runId("a-b", "without", 7))).toEqual({ case: "a-b", arm: "without", n: 7 });
});

test("eachRun flattens cases, arms and runs in order", () => {
  const result = Result.parse({
    cases: [
      { name: "a", arms: { with: [{ score: 1 }, { score: 0 }], without: [{ score: 0.5 }] } },
      { name: "b", arms: { with: [{ score: 0 }] } },
    ],
  });
  expect([...eachRun(result)].map((r) => [r.case, r.arm, r.n, r.run.score])).toEqual([
    ["a", "with", 0, 1],
    ["a", "with", 1, 0],
    ["a", "without", 0, 0.5],
    ["b", "with", 0, 0],
  ]);
});

test.each([
  ["plugins/pull-request/evals/create", "pull-request/create"],
  ["evals/user/ship", "user/ship"],
  ["/repo/plugins/writing/evals/authoring/", "writing/authoring"],
  ["./evals/user/ship", "user/ship"],
])("suiteName(%p) is %p", (dir, name) => {
  expect(suiteName(dir)).toBe(name);
});

test("suiteName rejects a directory outside the suite globs", () => {
  expect(() => suiteName("plugins/x/scripts")).toThrow("not a suite directory");
});

test("listCases leaves out the examples and results directories", async () => {
  const suite = tmp();
  await Promise.all(
    ["a", "examples", "results"].map((d) => Bun.write(join(suite, d, "case.yaml"), "")),
  );
  expect(await listCases(suite)).toEqual(["a"]);
});

test("listTraces orders runs by case, arm, and run, and artifactsPath shares the run id", async () => {
  const results = tmp();
  await Promise.all(
    ["b-with-0", "a-without-1", "a-with-10", "a-with-2", "notes"].map((n) =>
      Bun.write(join(results, "traces", `${n}.jsonl`), ""),
    ),
  );
  expect(listTraces(results).map((t) => runId(t.case, t.arm, t.n))).toEqual([
    "a-with-2",
    "a-with-10",
    "a-without-1",
    "b-with-0",
  ]);
  expect(artifactsPath("/r", "a-b", "with", 3)).toBe("/r/artifacts/a-b-with-3");
});

test("parseResultPath names the suite and run of a result", () => {
  expect(parseResultPath("plugins/x/evals/y/results/2026-01-02/aggregate-result.json")).toEqual({
    suite: "x/y",
    run: "2026-01-02",
  });
});
