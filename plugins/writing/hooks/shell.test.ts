import { describe, expect, test } from "bun:test";
import { parseShell, type ShellCommand } from "./shell";

interface Summary {
  name: string;
  args: string[];
  stdin: string[];
}

function summarize(command: ShellCommand): Summary {
  return { name: command.name, args: command.args.map((arg) => arg.text), stdin: command.stdin };
}

describe("parseShell", () => {
  test.each<{ name: string; source: string; expected: Summary[] }>([
    {
      name: "a redirect after a list belongs to its last command",
      source: "cd x && note post < body.md",
      expected: [
        { name: "cd", args: ["x"], stdin: [] },
        { name: "note", args: ["post"], stdin: ["body.md"] },
      ],
    },
    {
      name: "a redirect stays with its own pipeline stage",
      source: "note post < body.md | tee out",
      expected: [
        { name: "note", args: ["post"], stdin: ["body.md"] },
        { name: "tee", args: ["out"], stdin: [] },
      ],
    },
    {
      name: "a quoted redirect target loses its quotes",
      source: `note post < "a b.md"`,
      expected: [{ name: "note", args: ["post"], stdin: ["a b.md"] }],
    },
    {
      name: "output and fd redirects are not stdin",
      source: "note post 2>/dev/null > out.txt",
      expected: [{ name: "note", args: ["post"], stdin: [] }],
    },
    {
      name: "a heredoc body is never a command or a redirect",
      source: "note post <<'EOF'\nuse a < f.md here && rm x\nEOF",
      expected: [{ name: "note", args: ["post"], stdin: [] }],
    },
    {
      name: "escaped quotes and expansions inside double quotes",
      source: String.raw`gh --body "say \"hi\" to $USER"`,
      expected: [{ name: "gh", args: ["--body", 'say "hi" to $USER'], stdin: [] }],
    },
    {
      name: "a flag inside another command's quoted argument stays an argument",
      source: `echo "--body 'x'"`,
      expected: [{ name: "echo", args: ["--body 'x'"], stdin: [] }],
    },
    {
      name: "concatenated quoting and backslash escapes",
      source: String.raw`tool --title='a b' x\ y`,
      expected: [{ name: "tool", args: ["--title=a b", "x y"], stdin: [] }],
    },
    {
      name: "wrappers and assignments drop out of the name",
      source: "FOO=1 command env note post",
      expected: [{ name: "note", args: ["post"], stdin: [] }],
    },
  ])("$name", ({ source, expected }) => {
    expect(parseShell(source).map(summarize)).toEqual(expected);
  });

  test.each<{ name: string; source: string; inner: Summary }>([
    {
      name: "cat",
      source: `note -m "$(cat body.md)"`,
      inner: { name: "cat", args: ["body.md"], stdin: [] },
    },
    {
      name: "a bare redirect",
      source: `note -m "$(< body.md)"`,
      inner: { name: "cat", args: [], stdin: ["body.md"] },
    },
  ])("a substitution holding $name makes the argument non-literal", ({ source, inner }) => {
    const message = parseShell(source)[0]?.args[1];
    expect(message?.literal).toBe(false);
    expect(message?.substitutions.map(summarize)).toEqual([inner]);
  });
});
