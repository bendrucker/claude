import { describe, expect, test } from "bun:test";
import { type Command, commandsOf, hasFlag, parseCommands, positionals } from "./command-segments";

function programs(source: string): string[] {
  return parseCommands(source).map((command) => command.program);
}

describe("parseCommands", () => {
  test.each<{ name: string; source: string; programs: string[] }>([
    { name: "a single command", source: "glab mr list", programs: ["glab"] },
    { name: "a pipeline", source: "glab api user | jq .id", programs: ["glab", "jq"] },
    { name: "and/or lists", source: "a && b || c; d & e", programs: ["a", "b", "c", "d", "e"] },
    { name: "newlines", source: "a\nb", programs: ["a", "b"] },
    { name: "env assignments", source: "FOO=1 BAR='x y' glab mr list", programs: ["glab"] },
    { name: "the command builtin", source: "command glab mr list", programs: ["glab"] },
    { name: "a substitution", source: "echo $(glab mr list)", programs: ["echo", "glab"] },
    { name: "backticks", source: "echo `glab mr list`", programs: ["echo", "glab"] },
    {
      name: "a substitution inside double quotes",
      source: 'echo "$(glab mr list)"',
      programs: ["echo", "glab"],
    },
    {
      name: "loop keywords",
      source: "until glab ci status; do sleep 5; done",
      programs: ["glab", "sleep", "done"],
    },
    { name: "a subshell", source: "(cd x && glab mr list)", programs: ["cd", "glab"] },
    {
      name: "a redirect to the stdout fd",
      source: "glab mr list 2>&1 | jq .",
      programs: ["glab", "jq"],
    },
  ])("finds $name", ({ source, programs: expected }) => {
    expect(programs(source)).toEqual(expected);
  });

  test.each<{ name: string; source: string; programs: string[] }>([
    { name: "single-quoted text", source: "echo 'glab mr list; glab x'", programs: ["echo"] },
    { name: "double-quoted text", source: 'echo "a && glab mr list"', programs: ["echo"] },
    { name: "a comment", source: "echo hi # glab mr list", programs: ["echo"] },
    { name: "a quoted heredoc body", source: "cat <<'EOF'\nglab mr list\nEOF", programs: ["cat"] },
    {
      name: "an unquoted heredoc body",
      source: "cat <<EOF\nglab mr list\nEOF\nls",
      programs: ["cat", "ls"],
    },
    { name: "a tab-stripped heredoc", source: "cat <<-EOF\n\tglab x\n\tEOF", programs: ["cat"] },
    {
      name: "a heredoc inside a substitution",
      source: "gh pr create --body \"$(cat <<'EOF'\nglab mr list\nEOF\n)\"",
      programs: ["gh", "cat"],
    },
    { name: "an escaped separator", source: String.raw`echo a\;glab`, programs: ["echo"] },
  ])("skips $name", ({ source, programs: expected }) => {
    expect(programs(source)).toEqual(expected);
  });

  test("resumes after a heredoc body", () => {
    expect(programs("cat <<EOF | glab api user\nbody\nEOF\nls")).toEqual(["cat", "glab", "ls"]);
  });

  test("records heredoc bodies and whether the delimiter was quoted", () => {
    const [quoted, bare] = [
      parseCommands("cat <<'EOF'\n$x\nEOF")[0],
      parseCommands("cat <<EOF\n$x\nEOF")[0],
    ];
    expect(quoted?.heredocs).toEqual([{ body: "$x", quoted: true }]);
    expect(bare?.heredocs).toEqual([{ body: "$x", quoted: false }]);
  });

  test("links a substitution to the command that holds it", () => {
    const commands = parseCommands("glab api graphql -f query=\"$(cat <<'G'\nq\nG\n)\"");
    expect(commands.map((command) => command.parent?.program ?? null)).toEqual([null, "glab"]);
  });

  test("closes a backtick substitution that opens on a subshell at the backtick", () => {
    const commands = parseCommands("echo `(glab mr list)`; glab ci status");
    expect(commands.map((command) => command.parent?.program ?? null)).toEqual([
      null,
      "echo",
      null,
    ]);
  });

  test("keeps assignments and keywords", () => {
    const [command] = parseCommands("while GH_REPO=o/r gh pr view");
    expect(command?.program).toBe("gh");
    expect(command?.assignments).toEqual(["GH_REPO=o/r"]);
    expect(command?.keywords).toEqual(["while"]);
  });

  test("removes quotes from arguments and reports how they were quoted", () => {
    const [command] = parseCommands(`glab api x -f 'a=b c' -F "d=e" -q`);
    expect(command?.args.map(({ text, quote }) => [text, quote])).toEqual([
      ["api", "bare"],
      ["x", "bare"],
      ["-f", "bare"],
      ["a=b c", "single"],
      ["-F", "bare"],
      ["d=e", "double"],
      ["-q", "bare"],
    ]);
  });

  test("drops the backslash before a dollar in double quotes", () => {
    const [command] = parseCommands(String.raw`echo "\$x"`);
    expect(command?.args[0]?.text).toBe("$x");
  });
});

function only(source: string): Command {
  const [command] = parseCommands(source);
  if (command == null) throw new Error(`no command in ${source}`);
  return command;
}

describe("helpers", () => {
  test("commandsOf matches by program name or path", () => {
    expect(commandsOf(parseCommands("/opt/bin/glab x; glabber y"), "glab")).toHaveLength(1);
  });

  test("positionals skip flags and the repository value", () => {
    expect(positionals(only("glab mr -R grp/proj note create 5 -m hi --yes"))).toEqual([
      "mr",
      "note",
      "create",
      "5",
      "hi",
    ]);
  });

  test("hasFlag matches the flag and its = form", () => {
    const command = only("glab api x --jq=.a");
    expect(hasFlag(command, "--jq")).toBe(true);
    expect(hasFlag(command, "-q")).toBe(false);
  });
});
