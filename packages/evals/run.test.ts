import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { collectTraces, keepCases, pluginErrors, prepare, splitCases, strayArgs } from "./run";
import { casePlugins, withDependencies } from "./suite";
import { openInvocation, siblingLinks } from "./wrap";

let repo: string;

const files: Record<string, string> = {
  "plugins/p/.claude-plugin/plugin.json": '{"name":"p"}',
  "plugins/p/skills/s/SKILL.md": "committed skill",
  "plugins/q/.claude-plugin/plugin.json": '{"name":"q","dependencies":["r"]}',
  "plugins/r/.claude-plugin/plugin.json": '{"name":"r","dependencies":["s","q"]}',
  "plugins/s/.claude-plugin/plugin.json": '{"name":"s"}',
  "plugins/bad/.claude-plugin/plugin.json": '{"name":"bad","dependencies":["missing"]}',
  "plugins/p/evals/suite/one/case.yaml": "plugins: [../../.., ../../../../q]\n",
  "plugins/p/evals/suite/one/prompt.md": "committed prompt",
  "plugins/p/evals/suite/suite.yaml": "stage: [packages/stubs]\ngraders:\n  fired: '*'\n",
  "packages/stubs/install.sh": "committed stub",
  "plugins/p/evals/suite/graders/fired.md": "shared grader",
  "user/skills/tdd/SKILL.md":
    "---\ndisable-model-invocation: true\n---\ncommitted user skill [v](../other/LANGUAGE.md)",
  "user/rules/ts.md": "committed rule",
  "user/skills/other/LANGUAGE.md": "sibling vocabulary",
  "evals/user/tdd/suite.yaml":
    "wrap:\n  skills: [user/skills/tdd]\n  context: [user/rules/ts.md]\n",
  "evals/user/tdd/one/case.yaml": "plugins: [../..]\n",
};

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "run-repo-"));
  await Promise.all(Object.entries(files).map(([p, body]) => Bun.write(join(repo, p), body)));
  await $`git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init`
    .cwd(repo)
    .quiet();
  await Promise.all([
    Bun.write(join(repo, "plugins/p/skills/s/SKILL.md"), "working skill"),
    Bun.write(join(repo, "plugins/p/evals/suite/one/prompt.md"), "working prompt"),
    Bun.write(join(repo, "user/skills/tdd/SKILL.md"), "working user skill"),
    Bun.write(join(repo, "packages/stubs/install.sh"), "working stub"),
  ]);
});

const read = (path: string) => Bun.file(path).text();

test("casePlugins resolves each case's plugins and their dependencies against the repo", async () => {
  expect(await casePlugins(repo, "plugins/p/evals/suite")).toEqual([
    "plugins/p",
    "plugins/q",
    "plugins/r",
    "plugins/s",
  ]);
});

test("withDependencies rejects a dependency with no sibling plugin", async () => {
  const failure = await withDependencies(repo, ["plugins/bad"]).catch((error: unknown) => error);
  expect(String(failure)).toContain("plugins/missing is not a plugin");
});

describe("prepare", () => {
  test.each([
    { ref: "HEAD", skill: "committed skill" },
    { ref: undefined, skill: "working skill" },
  ])("stages plugins at ref $ref beside the working-tree suite", async ({ ref, skill }) => {
    const { target, evalDir } = await prepare(repo, "plugins/p/evals/suite", ref);
    expect(evalDir).toBe("p/evals/suite");
    expect(await read(join(target, "p/skills/s/SKILL.md"))).toBe(skill);
    expect(await read(join(target, "s/.claude-plugin/plugin.json"))).toBe('{"name":"s"}');
    expect(await read(join(target, evalDir, "one/case.yaml"))).toBe(
      "plugins: [ ../../.., ../../../../q, ../../../../r, ../../../../s ]\n",
    );
    expect(await read(join(target, evalDir, "one/prompt.md"))).toBe("working prompt");
    expect(await read(join(target, evalDir, "one/graders/fired.md"))).toBe("shared grader");
    expect(await Bun.file(join(target, evalDir, "graders/fired.md")).exists()).toBe(false);
    expect(await read(join(target, "../packages/stubs/install.sh"))).toBe("working stub");
  });

  test("wraps skills and context that are not a plugin", async () => {
    const { target, evalDir } = await prepare(repo, "evals/user/tdd", "HEAD");
    expect(evalDir).toBe("evals");
    expect(await read(join(target, ".claude-plugin/plugin.json"))).toContain('"name": "user"');
    expect(await read(join(target, "skills/tdd/SKILL.md"))).toBe(
      "---\n---\ncommitted user skill [v](../other/LANGUAGE.md)",
    );
    expect(await read(join(target, "skills/other/LANGUAGE.md"))).toBe("sibling vocabulary");
    expect(await read(join(target, "context/ts.md"))).toBe("committed rule");
    expect(await read(join(target, "hooks/hooks.json"))).toContain("SessionStart");
    expect(await Bun.file(join(target, "evals/one/case.yaml")).exists()).toBe(true);
  });
});

test("collectTraces copies kept traces beside the results and removes the runner's temp dirs", async () => {
  const output = mkdtempSync(join(tmpdir(), "run-output-"));
  const kept = mkdtempSync(join(tmpdir(), "e-"));
  const trace = join(kept, "out/trace.jsonl");
  await Bun.write(trace, '{"type":"result","result":"reply"}');
  const runs = [{ tracePath: trace }, { tracePath: join(kept, "gone/trace.jsonl") }, {}];
  await Bun.write(
    join(output, "aggregate-result.json"),
    JSON.stringify({ cases: [{ name: "one", arms: { with: runs } }] }),
  );
  await collectTraces(output);
  expect(await read(join(output, "traces/one-with-0.jsonl"))).toContain("reply");
  expect(await Bun.file(join(output, "traces/one-with-1.jsonl")).exists()).toBe(false);
  expect(await Bun.file(trace).exists()).toBe(false);
});

test.each([
  {
    name: "drops the key and keeps the rest",
    skill: "---\nname: tdd\ndisable-model-invocation: true\n---\n\n# TDD\n",
  },
  { name: "leaves a model-invocable skill alone", skill: "---\nname: tdd\n---\n\n# TDD\n" },
  { name: "leaves a file without frontmatter alone", skill: "# TDD\n" },
])("openInvocation $name", ({ skill }) => {
  expect(openInvocation(skill)).toMatchSnapshot();
});

test.each<{ url: string; expected: string[] }>([
  { url: "../other/LANGUAGE.md", expected: ["user/skills/other/LANGUAGE.md"] },
  { url: "../other/LANGUAGE.md#depth", expected: ["user/skills/other/LANGUAGE.md"] },
  { url: "references/local.md", expected: [] },
  { url: "../../rules/ts.md", expected: [] },
  { url: "https://example.com/x.md", expected: [] },
  { url: "#section", expected: [] },
])("siblingLinks resolves $url", ({ url, expected }) => {
  const text = `See [it](${url}).`;
  expect(siblingLinks("user/skills/tdd", "user/skills/tdd/SKILL.md", text)).toEqual(expected);
});

test.each<{ args: string[]; cases: string[]; rest: string[] }>([
  { args: ["--case", "a", "--case=b*", "--runs", "2"], cases: ["a", "b*"], rest: ["--runs", "2"] },
  { args: ["--tag", "dev"], cases: [], rest: ["--tag", "dev"] },
])("splitCases($args)", ({ args, cases, rest }) => {
  expect(splitCases(args)).toEqual([cases, rest]);
});

test("keepCases prunes staged cases to those any glob matches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cases-"));
  await Promise.all(
    ["quiet-a", "quiet-b", "loud", "examples", "results"].map((d) =>
      Bun.write(join(dir, d, "case.yaml"), ""),
    ),
  );
  await Bun.write(join(dir, "data", "index.duckdb"), "");
  expect(await keepCases(dir, ["quiet-*", "{loud,none}"])).toEqual(["loud", "quiet-a", "quiet-b"]);
  expect(await keepCases(dir, ["quiet-[a]"])).toEqual(["quiet-a"]);
  expect(await Bun.file(join(dir, "quiet-b/case.yaml")).exists()).toBe(false);
  expect(await Bun.file(join(dir, "examples/case.yaml")).exists()).toBe(true);
  expect(await Bun.file(join(dir, "data/index.duckdb")).exists()).toBe(true);
  expect(keepCases(dir, ["nope"])).rejects.toThrow("No case matches");
});

describe("pluginErrors", () => {
  const init = (errors: unknown) =>
    `${JSON.stringify({ type: "system", subtype: "hook_started" })}\n${JSON.stringify({ type: "system", subtype: "init", plugin_errors: errors })}\n`;

  test("lists each init plugin error by case, arm, and run", async () => {
    const output = mkdtempSync(join(tmpdir(), "run-output-"));
    const runs = [{}, {}];
    await Bun.write(
      join(output, "aggregate-result.json"),
      JSON.stringify({ cases: [{ name: "one", arms: { with: runs, without: runs } }] }),
    );
    const error = { plugin: "gitlab@inline", type: "dependency-unsatisfied", message: "no git" };
    await Bun.write(join(output, "traces/one-with-1.jsonl"), init([error]));
    await Bun.write(join(output, "traces/one-with-0.jsonl"), init([]));
    await Bun.write(join(output, "traces/one-without-0.jsonl"), init(null));
    expect(await pluginErrors(output)).toEqual([
      "one/with/1: gitlab@inline dependency-unsatisfied: no git",
    ]);
  });

  test("is empty without a result", async () => {
    expect(await pluginErrors(mkdtempSync(join(tmpdir(), "run-output-")))).toEqual([]);
  });
});

test.each<{ name: string; args: string[]; stray: string[] }>([
  { name: "only the suite", args: ["s"], stray: [] },
  { name: "runner args after --", args: ["s", "--", "--case", "a"], stray: [] },
  {
    name: "run.ts flags before --",
    args: ["--ref", "main", "s", "--label=x", "--", "--runs", "2"],
    stray: [],
  },
  {
    name: "a runner flag before --",
    args: ["s", "--case", "a", "--", "--runs", "2"],
    stray: ["--case", "a"],
  },
  { name: "runner args without --", args: ["s", "--runs", "2"], stray: ["--runs", "2"] },
])("strayArgs with $name", ({ args, stray }) => {
  expect(strayArgs(args)).toEqual(stray);
});
