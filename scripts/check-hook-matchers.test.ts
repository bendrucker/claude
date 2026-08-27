import { expect, test } from "bun:test";
import type { HookCommand, MatcherEntryContext } from "../packages/marketplace/index";
import { entries, violations } from "./check-hook-matchers";

function entry(matcher: string | undefined, ...ifs: (string | undefined)[]): MatcherEntryContext {
  const hooks: HookCommand[] = ifs.map((rule) => {
    const hook: HookCommand = { type: "command", command: "bun hook.ts" };
    if (rule !== undefined) hook.if = rule;
    return hook;
  });
  const entry: MatcherEntryContext["entry"] = { hooks };
  if (matcher !== undefined) entry.matcher = matcher;
  return { file: "plugins/example/hooks/hooks.json", entry };
}

test.each<{ name: string; entries: MatcherEntryContext[]; expected: number }>([
  { name: "tool name matcher", entries: [entry("Bash")], expected: 0 },
  { name: "alternation of tool names", entries: [entry("Bash|Monitor")], expected: 0 },
  { name: "mcp tool matcher", entries: [entry("mcp__linear__create_issue")], expected: 0 },
  { name: "no matcher", entries: [entry(undefined)], expected: 0 },
  {
    name: "gitlab Bash entry",
    entries: [entry("Bash", "Bash(glab *)", "Bash(gh *)")],
    expected: 0,
  },
  {
    name: "gitlab WebFetch entry",
    entries: [entry("WebFetch", "WebFetch(domain:gitlab.com)")],
    expected: 0,
  },
  {
    name: "WebFetch if with a URL instead of a domain",
    entries: [entry("WebFetch", "WebFetch(https://gitlab.com/*)")],
    expected: 1,
  },
  { name: "bare tool if", entries: [entry("Bash", "Bash")], expected: 0 },
  { name: "permission rule matcher", entries: [entry("Bash(gh pr create:*)")], expected: 1 },
  {
    name: "one defect per entry, not per segment",
    entries: [entry("Bash(gh pr create:*)|Bash(gh pr edit:*)")],
    expected: 1,
  },
  { name: "pipe-joined ifs", entries: [entry("Bash", "Bash(gh *)|Bash(glab *)")], expected: 1 },
  { name: "prose if", entries: [entry("Bash", "the command creates a PR")], expected: 1 },
  { name: "empty if", entries: [entry("Bash", "")], expected: 1 },
  { name: "nested parens in if", entries: [entry("Bash", "Bash(gh (pr) create:*)")], expected: 1 },
  {
    name: "every command is checked",
    entries: [entry("Bash", "Bash(gh *)", "", "gh pr create")],
    expected: 2,
  },
])("$name", ({ entries, expected }) => {
  expect(violations(entries)).toHaveLength(expected);
});

test("the pull-request matcher that never fired", () => {
  const matcher =
    "Bash(gh pr create:*)|Bash(gh pr edit:*)|Bash(glab mr create:*)|Bash(glab mr update:*)";
  expect(violations([entry(matcher)])).toMatchInlineSnapshot(`
    [
      "plugins/example/hooks/hooks.json: matcher "Bash(gh pr create:*)|Bash(gh pr edit:*)|Bash(glab mr create:*)|Bash(glab mr update:*)" uses permission-rule syntax and can never match a tool name. Move command scoping to a per-hook "if" field.",
    ]
  `);
});

// The ox commit gate sat behind a `Bash(git commit:*)` matcher in project
// settings and never fired, because this check only ever read plugin hooks.
test("scans both settings files alongside the plugins", async () => {
  const files = new Set((await entries()).map((context) => context.file));
  expect(files).toContain("user/settings.json");
  expect(files).toContain(".claude/settings.json");
});
