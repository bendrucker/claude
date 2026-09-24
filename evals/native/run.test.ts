import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { casePlugins, prepare } from "./run";

let repo: string;

const files: Record<string, string> = {
  "plugins/p/.claude-plugin/plugin.json": '{"name":"p"}',
  "plugins/p/skills/s/SKILL.md": "committed skill",
  "plugins/q/.claude-plugin/plugin.json": '{"name":"q"}',
  "plugins/p/evals/suite/one/case.yaml": "plugins: [../../.., ../../../../q]\n",
  "plugins/p/evals/suite/one/prompt.md": "committed prompt",
  "user/skills/tdd/SKILL.md": "committed user skill",
  "user/rules/ts.md": "committed rule",
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
  ]);
});

const read = (path: string) => Bun.file(path).text();

test("casePlugins resolves each case's plugins against the repo", async () => {
  expect(await casePlugins(repo, "plugins/p/evals/suite")).toEqual(["plugins/p", "plugins/q"]);
});

describe("prepare", () => {
  test.each([
    { ref: "HEAD", skill: "committed skill" },
    { ref: undefined, skill: "working skill" },
  ])("stages plugins at ref $ref beside the working-tree suite", async ({ ref, skill }) => {
    const { target, evalDir } = await prepare(repo, "plugins/p/evals/suite", ref);
    expect(evalDir).toBe("p/evals/suite");
    expect(await read(join(target, "p/skills/s/SKILL.md"))).toBe(skill);
    expect(await read(join(target, "q/.claude-plugin/plugin.json"))).toBe('{"name":"q"}');
    expect(await read(join(target, evalDir, "one/prompt.md"))).toBe("working prompt");
  });

  test("wraps skills and context that are not a plugin", async () => {
    const { target, evalDir } = await prepare(repo, "evals/user/tdd", "HEAD");
    expect(evalDir).toBe("evals");
    expect(await read(join(target, ".claude-plugin/plugin.json"))).toContain('"name": "user"');
    expect(await read(join(target, "skills/tdd/SKILL.md"))).toBe("committed user skill");
    expect(await read(join(target, "context/ts.md"))).toBe("committed rule");
    expect(await read(join(target, "hooks/hooks.json"))).toContain("SessionStart");
    expect(await Bun.file(join(target, "evals/one/case.yaml")).exists()).toBe(true);
  });
});
