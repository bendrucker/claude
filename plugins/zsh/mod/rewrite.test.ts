import { describe, expect, test } from "claude-code/testing";
import { type Gates, type Rule, rewrite } from "./rewrite";
import { words } from "./words";

const ALL: Gates = { glob: true, equals: true };

describe("rewrite", () => {
  test("quotes what zsh would expand", () => {
    const cases: [string, string, string, Rule[]][] = [
      [
        "include glob",
        "grep -r --include=*.ts foo src",
        "grep -r --include='*.ts' foo src",
        ["flag-glob"],
      ],
      [
        "brace with glob",
        "grep -r --exclude-dir={a,b}* x",
        "grep -r --exclude-dir={a,b}'*' x",
        ["flag-glob"],
      ],
      [
        "brace runs",
        "grep --include={*.ts,*.md} x",
        "grep --include={'*.ts','*.md'} x",
        ["flag-glob"],
      ],
      ["question mark", "rg --glob=a?c x", "rg --glob='a?c' x", ["flag-glob"]],
      ["find name", "find . -name *.ts", "find . -name '*.ts'", ["flag-glob"]],
      [
        "find path",
        "/usr/bin/find src -ipath */x/* -print",
        "/usr/bin/find src -ipath '*/x/*' -print",
        ["flag-glob"],
      ],
      [
        "find after cd",
        "cd x && find . -iname [ab]*",
        "cd x && find . -iname '[ab]*'",
        ["flag-glob"],
      ],
      ["triple equals", "echo ===", "echo '==='", ["equals"]],
      ["equals banner", "echo ==SESSIONS===", "echo '==SESSIONS==='", ["equals"]],
      ["url", "curl https://x.test/a?b=1", "curl 'https://x.test/a?b=1'", ["url"]],
      [
        "inside substitution",
        'echo "$(grep --include=*.ts x)"',
        `echo "$(grep --include='*.ts' x)"`,
        ["flag-glob"],
      ],
      [
        "inside backticks",
        "echo `grep --include=*.ts x`",
        "echo `grep --include='*.ts' x`",
        ["flag-glob"],
      ],
      [
        "several rules",
        "echo === && grep --include=*.ts x; echo ===",
        "echo '===' && grep --include='*.ts' x; echo '==='",
        ["equals", "flag-glob"],
      ],
    ];
    for (const [name, command, want, rules] of cases) {
      const got = rewrite(command, ALL);
      expect({ name, got }).toEqual({ name, got: { command: want, rules } });
      expect({ name, count: words(got.command).length }).toEqual({
        name,
        count: words(command).length,
      });
    }
  });

  test("leaves the command alone", () => {
    const cases: [string, string][] = [
      ["single quoted", "grep '--include=*.ts' x"],
      ["double quoted", 'grep "--include=*.ts" x'],
      ["quoted value", 'grep --include="*.ts" x'],
      ["partly quoted value", 'grep --include=*"x".ts y'],
      ["escaped", String.raw`grep --include=\*.ts x`],
      ["no glob", "grep --include=foo x"],
      ["brace only", "grep --exclude-dir={a,b} x"],
      ["heredoc body", "cat <<EOF > f.md\necho ===\n--include=*.ts\nEOF"],
      ["test equality", "[[ $a == b ]]"],
      ["test assign", "[[ x = y ]]"],
      ["assignment equals", "X==== cmd"],
      ["assignment glob", "X=*.ts cmd"],
      ["dollar", "grep --include=$pat* x"],
      ["comment", "ls # --include=*.ts ==="],
      ["unbalanced", "grep --include=*.ts 'x"],
      ["lone equals", "test a = b"],
      ["arith", "(( a == b ))"],
      ["find quoted", "find . -name '*.ts'"],
      ["predicate outside find", "ls -name *.ts"],
      ["url without glob", "curl https://x.test/a"],
      ["tilde value", "find . -path ~/x*"],
    ];
    for (const [name, command] of cases) {
      expect({ name, got: rewrite(command, ALL) }).toEqual({ name, got: { command, rules: [] } });
    }
  });

  test("gates", () => {
    const cases: [string, Gates, string, string, Rule[]][] = [
      ["all off", { glob: false, equals: false }, "echo === --x=*", "echo === --x=*", []],
      ["glob off", { glob: false, equals: true }, "echo === --x=*", "echo '===' --x=*", ["equals"]],
      [
        "equals off",
        { glob: true, equals: false },
        "echo === --x=*",
        "echo === --x='*'",
        ["flag-glob"],
      ],
      [
        "url off",
        { glob: false, equals: true },
        "curl https://x.test/?a",
        "curl https://x.test/?a",
        [],
      ],
    ];
    for (const [name, gates, command, want, rules] of cases) {
      expect({ name, got: rewrite(command, gates) }).toEqual({
        name,
        got: { command: want, rules },
      });
    }
  });
});
