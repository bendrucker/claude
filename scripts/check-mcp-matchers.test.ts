import { expect, test } from "bun:test";
import { missingVariants } from "./check-mcp-matchers";

const FILE = "plugins/example/hooks/hooks.json";

const resolve = (server: string): string | null => (server === "unknown" ? null : server);

test.each<{ name: string; pattern: string; also?: string[]; expected: string[] }>([
  {
    name: "non-mcp matcher",
    pattern: "Bash",
    expected: [],
  },
  {
    name: "already plugin-scoped",
    pattern: "mcp__plugin_linear_linear__create_issue",
    expected: [],
  },
  {
    name: "already Claude AI scoped",
    pattern: "mcp__claude_ai_Linear__save_issue",
    expected: [],
  },
  {
    name: "server with no known plugin",
    pattern: "mcp__unknown__do_thing",
    expected: [],
  },
  {
    name: "unmapped server wants only the plugin variant",
    pattern: "mcp__things__add_todo",
    expected: [
      `${FILE}: matcher "mcp__things__add_todo" is missing plugin variant "mcp__plugin_things_things__add_todo"`,
    ],
  },
  {
    name: "unmapped server with the plugin variant present",
    pattern: "mcp__things__add_todo",
    also: ["mcp__plugin_things_things__add_todo"],
    expected: [],
  },
  {
    name: "mapped server wants both variants, with the tool renamed",
    pattern: "mcp__linear__create_issue",
    expected: [
      `${FILE}: matcher "mcp__linear__create_issue" is missing plugin variant "mcp__plugin_linear_linear__create_issue"`,
      `${FILE}: matcher "mcp__linear__create_issue" is missing Claude AI variant "mcp__claude_ai_Linear__save_issue"`,
    ],
  },
  {
    name: "mapped server keeps a tool name it has no rename for",
    pattern: "mcp__linear__list_issues",
    also: ["mcp__plugin_linear_linear__list_issues"],
    expected: [
      `${FILE}: matcher "mcp__linear__list_issues" is missing Claude AI variant "mcp__claude_ai_Linear__list_issues"`,
    ],
  },
  {
    name: "mapped server fully covered",
    pattern: "mcp__linear__create_issue",
    also: ["mcp__plugin_linear_linear__create_issue", "mcp__claude_ai_Linear__save_issue"],
    expected: [],
  },
])("$name", ({ pattern, also = [], expected }) => {
  expect(missingVariants(FILE, pattern, [pattern, ...also], resolve)).toEqual(expected);
});
