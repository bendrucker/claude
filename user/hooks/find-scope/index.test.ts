import { describe, expect, test } from "bun:test";
import type { HookInput } from "../../scripts/hook-input";
import { findsUnboundedFromBroadRoot, formatDenyOutput, isBroadRoot, processInput } from "./index";

function bashInput(command: string): HookInput {
  return {
    session_id: "test",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
}

// Commands taken from session history, where each one walked the whole disk and
// returned nothing before the Bash timeout.
describe("commands this hook exists to stop", () => {
  test.each([
    `find / -path "*skills/hook/SKILL.md" -not -path "*/node_modules/*" 2>/dev/null | head -5`,
    `find / -path /proc -prune -o -name "preflight.ts" -print 2>/dev/null | grep comments | head -5`,
    `find / -name "sdk.d.ts" -path "*claude-agent-sdk*" 2>/dev/null`,
    `find / -path '*tflint-plugin-sdk/helper*' -name '*.go' 2>/dev/null | head`,
    `grep -rn "class ShellError" $(find / -path "*/bun-types/*.d.ts" 2>/dev/null | grep -i shell) 2>/dev/null | head -50`,
    `cat /Users/ben/.claude/plugins/cache/*/skills/writing/SKILL.md 2>/dev/null | head -200 || find / -path '*/skills/writing/SKILL.md' 2>/dev/null`,
    `find ~ -name 'db.zo' 2>/dev/null`,
    `find $HOME -name "*.duckdb" 2>/dev/null`,
    `find /Users/ben -name "release" -path "*jdk*" 2>/dev/null | head`,
  ])("denies %s", (command) => {
    expect(processInput(bashInput(command))).toEqual(formatDenyOutput());
  });
});

// Commands from the same history that finished fast. A guard that fires on
// these is worse than no guard.
describe("searches that are already scoped", () => {
  test.each([
    `find . -name "*.parquet" -not -path "*/node_modules/*" | head -20`,
    `find /Users/ben/.claude/plugins/cache -iname "wt.sh" 2>/dev/null | head -5`,
    `find ~/.claude/projects -name '*.jsonl' -newermt '1 day ago'`,
    `find ~/src -maxdepth 2 -name ".git" -type d 2>/dev/null`,
    `find / -maxdepth 2 -iname "*.claude*" 2>/dev/null`,
    `find ~ -maxdepth 3 -iname "dotfiles" -type d 2>/dev/null`,
    `find $HOME -maxdepth 1 -name '.claude'`,
    `find node_modules/.bun -maxdepth 1 -iname "bun-types*"`,
    `find plugins -name "SKILL.md"`,
    `find /Users/ben/src/bendrucker/claude -name "*.ts"`,
  ])("allows %s", (command) => {
    expect(processInput(bashInput(command))).toBeNull();
  });
});

// `find` is a common English word and a substring of other commands, so the
// boundary rules carry most of the false-positive risk.
describe("text that is not a find invocation", () => {
  test.each([
    { name: "mdfind", command: `mdfind / -name foo` },
    { name: "a command whose name ends in find", command: `myfind / -name foo` },
    { name: "find as a word in an echo", command: `echo "we should find / the root"` },
    { name: "find inside a single-quoted grep pattern", command: `grep -rn 'find / -name' logs/` },
    { name: "find in a double-quoted string", command: `echo "run find / -name x to search"` },
    {
      name: "find in a heredoc body",
      command: [`cat > brief.md <<'BRIEF'`, `Do not run find / -name x here.`, `BRIEF`].join("\n"),
    },
    { name: "a git subcommand", command: `git find-object abc123` },
    {
      name: "prose beside a substitution in the same quoted span",
      command: `echo "checked $(date): find / is slow"`,
    },
    { name: "no find at all", command: `rg --files /Users/ben/.claude | head` },
    { name: "find with no operand", command: `find` },
  ])("allows $name", ({ command }) => {
    expect(processInput(bashInput(command))).toBeNull();
  });
});

describe("invocation position", () => {
  test.each([
    { name: "after a semicolon", command: `ls; find / -name x` },
    { name: "after &&", command: `cd /tmp && find / -name x` },
    { name: "after ||", command: `cat known.txt || find / -name x` },
    { name: "after a pipe", command: `echo x | xargs find / -name` },
    {
      name: "inside a command substitution",
      command: `grep -l q $(find / -name '*.ts')`,
    },
    { name: "inside backticks", command: "grep -l q `find / -name '*.ts'`" },
    {
      name: "inside a double-quoted command substitution",
      command: `cat "$(find / -name '*.ts' | head -1)"`,
    },
    { name: "inside a double-quoted assignment", command: `X="$(find ~ -name x)"; echo $X` },
    { name: "under sudo", command: `sudo find / -name x` },
    { name: "under command", command: `command find / -name x` },
    { name: "on a continuation line", command: `echo start\nfind / -name x` },
    { name: "with a leading -L flag", command: `find -L / -name x` },
    { name: "with a leading -E flag", command: `find -E ~ -regex '.*foo'` },
  ])("denies $name", ({ command }) => {
    expect(processInput(bashInput(command))).toEqual(formatDenyOutput());
  });
});

describe("-maxdepth binds to its own invocation", () => {
  test("a bounded find upstream does not excuse an unbounded one downstream", () => {
    expect(findsUnboundedFromBroadRoot(`find / -maxdepth 2 -name a; find / -name b`)).toBe(true);
  });

  test("a -maxdepth after a pipe does not bound the find", () => {
    expect(findsUnboundedFromBroadRoot(`find / -name a | grep -- -maxdepth`)).toBe(true);
  });

  test("a bounded find alongside a scoped one stays allowed", () => {
    expect(findsUnboundedFromBroadRoot(`find / -maxdepth 2 -name a; find ./src -name b`)).toBe(
      false,
    );
  });

  test("-maxdepth is not matched as a substring of another flag", () => {
    expect(findsUnboundedFromBroadRoot(`find / -name x-maxdepth`)).toBe(true);
  });
});

describe("isBroadRoot", () => {
  // oxlint-disable-next-line no-template-curly-in-string -- shell brace expansion is the operand under test.
  const bracedHome = "${HOME}";

  test.each([
    "/",
    "~",
    "~/",
    "$HOME",
    bracedHome,
    "$HOME/",
    "/Users/ben",
    "/Users/ben/",
    "/home/ben",
  ])("%s is broad", (operand) => {
    expect(isBroadRoot(operand)).toBe(true);
  });

  test.each([
    ".",
    "./src",
    "src",
    "~/.claude",
    "$HOME/src",
    "/Users/ben/src",
    "/Users",
    "/opt/homebrew",
    "node_modules",
  ])("%s is scoped", (operand) => {
    expect(isBroadRoot(operand)).toBe(false);
  });

  test("a quoted broad root is still broad", () => {
    expect(isBroadRoot(`"$HOME"`)).toBe(true);
    expect(isBroadRoot(`'/'`)).toBe(true);
  });
});

describe("malformed input", () => {
  test("returns null when the command is missing", () => {
    expect(processInput({ ...bashInput(""), tool_input: {} })).toBeNull();
  });

  test("returns null when tool_input is not an object", () => {
    expect(processInput({ ...bashInput(""), tool_input: null })).toBeNull();
  });
});
