import { describe, expect, test } from "bun:test";
import { invokesRunList, invokesWorkflowRun, simpleCommands } from "./gh-invocations";

describe("simpleCommands", () => {
  test("keeps separators inside quotes as argument text", () => {
    expect(simpleCommands(`git commit -m "a && gh run list" ; echo 'x|y'`)).toEqual([
      ["git", "commit", "-m", "a && gh run list"],
      ["echo", "x|y"],
    ]);
  });

  test("splits on newlines, pipes, subshells, and substitutions", () => {
    expect(simpleCommands("a\nb | c\n(d) $(e) `f`")).toEqual([
      ["a"],
      ["b"],
      ["c"],
      ["d"],
      ["$"],
      ["e"],
      ["f"],
    ]);
  });
});

describe("invokesWorkflowRun", () => {
  test.each<[string, boolean]>([
    ["gh workflow run session-bench.yml --ref main", true],
    ["cd repo && gh workflow run cloud-sessions.yml", true],
    ["gh -R bendrucker/claude workflow run eval.yml -f suite=x", true],
    ["gh --repo=bendrucker/claude workflow run eval.yml", true],
    ["GH_REPO=bendrucker/claude gh workflow run eval.yml", true],
    ["for s in a b; do gh workflow run eval.yml -f suite=$s; done", true],
    ["id=$(gh workflow run eval.yml)", true],
    ["gh run view 123", false],
    ["gh workflow list", false],
    ["echo gh workflow running", false],
    ["echo gh workflow run", false],
    ['git commit -m "chore: gh workflow run eval.yml"', false],
  ])("%p -> %p", (command, expected) => {
    expect(invokesWorkflowRun(command)).toBe(expected);
  });
});

describe("invokesRunList", () => {
  test.each<[string, boolean]>([
    ["gh run list --workflow eval.yml --limit 1", true],
    ["sleep 5; gh run list -L 2 | jq .", true],
    ["gh run view 123", false],
    ["gh pr list", false],
    ["echo 'then gh run list'", false],
  ])("%p -> %p", (command, expected) => {
    expect(invokesRunList(command)).toBe(expected);
  });
});
