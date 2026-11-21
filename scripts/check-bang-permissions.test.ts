import { describe, expect, test } from "bun:test";
import {
  allowsCommand,
  allowsPath,
  bangCommands,
  subcommands,
  unapproved,
} from "./check-bang-permissions";

describe("bangCommands", () => {
  test.each<{ name: string; markdown: string; expected: string[] }>([
    { name: "inline after text", markdown: "- OS: !`uname -s`", expected: ["uname -s"] },
    { name: "alone on a line", markdown: "!`date`", expected: ["date"] },
    { name: "code span without a bang", markdown: "Run `uname -s`.", expected: [] },
    { name: "bang inside a fenced block", markdown: "```\n!`uname`\n```", expected: [] },
  ])("$name", ({ markdown, expected }) => {
    expect(bangCommands(markdown)).toEqual(expected);
  });
});

describe("subcommands", () => {
  test.each<{ name: string; command: string; expected: string[] }>([
    {
      name: "or-chain with a dropped stderr redirect",
      command: "grep '^- ' ~/x.md 2>/dev/null || echo 'a | b'",
      expected: ["grep '^- ' ~/x.md", "echo 'a | b'"],
    },
    {
      name: "pipeline keeps quoted operators inside one word",
      command: `gh api "a?x=1&y=2" | jq -r '.[] | .id'`,
      expected: [`gh api "a?x=1&y=2"`, "jq -r '.[] | .id'"],
    },
    {
      name: "fd duplication is a redirect, not a background job",
      command: "glab api user 2>&1",
      expected: ["glab api user"],
    },
    {
      name: "redirect with its target as a separate word",
      command: "command -v x > /dev/null; echo found",
      expected: ["command -v x", "echo found"],
    },
    {
      name: "double quotes stay on the word",
      command: 'touch "/tmp/a/$ID"',
      expected: ['touch "/tmp/a/$ID"'],
    },
  ])("$name", ({ command, expected }) => {
    expect(subcommands(command).map((words) => words.join(" "))).toEqual(expected);
  });
});

describe("allowsCommand", () => {
  test.each<{ name: string; rule: string; command: string; allowed: boolean }>([
    {
      name: "prefix matches with arguments",
      rule: "Bash(rg:*)",
      command: "rg -l x",
      allowed: true,
    },
    {
      name: "prefix matches the bare command",
      rule: "Bash(date:*)",
      command: "date",
      allowed: true,
    },
    { name: "prefix needs a word boundary", rule: "Bash(git:*)", command: "gitk", allowed: false },
    { name: "exact rule", rule: "Bash(pmset -g ps)", command: "pmset -g ps", allowed: true },
    {
      name: "exact rule rejects extra args",
      rule: "Bash(ifconfig)",
      command: "ifconfig -a",
      allowed: false,
    },
    {
      name: "glob crosses slashes",
      rule: "Bash(touch /tmp/a/*)",
      command: "touch /tmp/a/b/c",
      allowed: true,
    },
    {
      name: "glob sees quotes",
      rule: "Bash(touch /tmp/a/*)",
      command: 'touch "/tmp/a/b"',
      allowed: false,
    },
    { name: "bare Bash", rule: "Bash", command: "anything at all", allowed: true },
    { name: "another tool", rule: "Read", command: "cat x", allowed: false },
  ])("$name", ({ rule, command, allowed }) => {
    expect(allowsCommand(rule, command)).toBe(allowed);
  });
});

describe("allowsPath", () => {
  test.each<{ name: string; rule: string; tool: "Read" | "Edit"; path: string; allowed: boolean }>([
    {
      name: "home glob",
      rule: "Read(~/.config/a/**)",
      tool: "Read",
      path: "~/.config/a/b.json",
      allowed: true,
    },
    {
      name: "double-star covers its directory",
      rule: "Edit(//tmp/a/**)",
      tool: "Edit",
      path: "/tmp/a",
      allowed: true,
    },
    {
      name: "absolute rule form",
      rule: "Edit(//tmp/a/**)",
      tool: "Edit",
      path: "/tmp/a/x/y",
      allowed: true,
    },
    {
      name: "single star stops at a slash",
      rule: "Read(~/a/*)",
      tool: "Read",
      path: "~/a/b/c",
      allowed: false,
    },
    {
      name: "bare tool is not path-scoped",
      rule: "Read",
      tool: "Read",
      path: "~/a",
      allowed: false,
    },
    { name: "wrong tool", rule: "Read(//tmp/**)", tool: "Edit", path: "/tmp/x", allowed: false },
  ])("$name", ({ rule, tool, path, allowed }) => {
    expect(allowsPath(rule, tool, path)).toBe(allowed);
  });
});

test("unapproved reports each uncovered subcommand and path", () => {
  const skill = [
    "---",
    "name: probe",
    "allowed-tools:",
    "  - Bash(grep:*)",
    "  - Bash(mkdir:*)",
    "  - Edit(//tmp/claude/**)",
    "---",
    "",
    "!`grep -c x ~/.claude/a.md 2>/dev/null || echo none`",
    "!`mkdir -p /tmp/claude/x; touch /tmp/other/y`",
    "",
  ].join("\n");
  expect(unapproved("probe/SKILL.md", skill)).toMatchInlineSnapshot(`
    [
      "probe/SKILL.md: no Read rule covers \`~/.claude/a.md\` in \`grep -c x ~/.claude/a.md\`",
      "probe/SKILL.md: no Bash rule matches \`echo none\`",
      "probe/SKILL.md: no Bash rule matches \`touch /tmp/other/y\`",
      "probe/SKILL.md: no Edit rule covers \`/tmp/other/y\` in \`touch /tmp/other/y\`",
    ]
  `);
});
