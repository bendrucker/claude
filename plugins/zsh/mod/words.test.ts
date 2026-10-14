import { describe, expect, test } from "claude-code/testing";
import { type Context, words } from "./words";

/** Each word as `text`, its context when not plain, and `!` under every quoted character. */
function shape(command: string): string[] {
  return words(command).map((w) => {
    const quoted = w.unquoted.some((u) => !u)
      ? ` ${w.unquoted.map((u) => (u ? " " : "!")).join("")}`
      : "";
    const context = w.context === "plain" ? "" : ` <${w.context}>`;
    return `${w.text}${context}${quoted}`;
  });
}

describe("words", () => {
  test("splits, quotes, and contexts", () => {
    const cases: [string, string, string[]][] = [
      ["plain words", "ls -la src", ["ls", "-la", "src"]],
      [
        "single quotes",
        "grep '--include=*.ts' x",
        ["grep", "'--include=*.ts' !!!!!!!!!!!!!!!!", "x"],
      ],
      ["double quotes", 'echo "a b"', ["echo", '"a b" !!!!!']],
      ["partial quote", "x --a='*.ts'", ["x", "--a='*.ts'     !!!!!!"]],
      ["backslash", String.raw`echo \*`, ["echo", String.raw`\* !!`]],
      ["ansi-c quote", String.raw`echo $'a\'b'`, ["echo", String.raw`$'a\'b' !!!!!!!`]],
      [
        "heredoc body",
        "cat <<EOF > f.md\necho ===\n*.ts\nEOF\necho done",
        ["cat", "f.md", "echo", "done"],
      ],
      ["quoted heredoc", "cat <<'EOF'\n===\nEOF", ["cat"]],
      ["stripped heredoc", "cat <<-EOF\n\t===\n\tEOF\nls", ["cat", "ls"]],
      [
        "test brackets",
        "[[ $a == b ]] && echo ok",
        ["[[ <test>", "$a <test> ! ", "== <test>", "b <test>", "]] <test>", "echo", "ok"],
      ],
      [
        "test after if",
        "if [[ -f x ]]; then ls; fi",
        ["if", "[[ <test>", "-f <test>", "x <test>", "]] <test>", "then", "ls", "fi"],
      ],
      ["arith command", "(( i > 2 )) && ls", ["(( i > 2 )) <arith> !!!!!!!!!!!", "ls"]],
      ["comment", "ls # *.ts ===", ["ls"]],
      ["comment line", "# ===\nls", ["ls"]],
      ["hash mid-word", "echo a#b", ["echo", "a#b"]],
      ["assignment", "FOO=*.ts cmd --x=*.ts", ["FOO=*.ts <assign>", "cmd", "--x=*.ts"]],
      ["declared assignment", "local x=*.ts", ["local", "x=*.ts <assign>"]],
      ["assignment after the name", "cmd x=*.ts", ["cmd", "x=*.ts"]],
      ["fd redirect", "ls *.nope 2>/dev/null", ["ls", "*.nope", "/dev/null"]],
      ["glob qualifier", "ls *(.)", ["ls", "*(.)"]],
      [
        "nested substitution",
        'echo "$(grep --include=*.ts $(echo ===) x)"',
        [
          "echo",
          '"$(grep --include=*.ts $(echo ===) x)" !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
          "grep",
          "--include=*.ts",
          "$(echo ===) !!!!!!!!!!!",
          "echo",
          "===",
          "x",
        ],
      ],
      ["backticks", "echo `ls *.ts`", ["echo", "`ls *.ts` !!!!!!!!!", "ls", "*.ts"]],
      ["parameter expansion", 'echo ${a:-"x y"}', ["echo", '${a:-"x y"} !!!!!!!!!!!']],
      [
        "subshell in substitution",
        "x=$( (cd a; ls) )",
        ["x=$( (cd a; ls) ) <assign>   !!!!!!!!!!!!!!!", "cd", "a", "ls"],
      ],
      [
        "case in substitution",
        "$(case a in a) ls;; esac)",
        [
          "$(case a in a) ls;; esac) !!!!!!!!!!!!!!!!!!!!!!!!!",
          "case",
          "a",
          "in",
          "a",
          "ls",
          "esac",
        ],
      ],
    ];
    for (const [name, command, want] of cases) {
      expect({ name, got: shape(command) }).toEqual({ name, got: want });
    }
  });

  test("unbalanced input yields no words", () => {
    const cases: [string, string][] = [
      ["single quote", "echo 'abc"],
      ["double quote", 'echo "abc'],
      ["substitution", "echo $(ls"],
      ["backtick", "echo `ls"],
      ["brace", "echo ${a"],
      ["heredoc", "cat <<EOF\nabc"],
      ["stray paren", "ls )"],
    ];
    for (const [name, command] of cases) {
      expect({ name, got: words(command) }).toEqual({ name, got: [] });
    }
  });

  test("numbers words by command and position", () => {
    const got = words("cd x && find . -name *.ts | head").map(
      (w): [string, number, number, Context] => [w.text, w.command, w.index, w.context],
    );
    const [cd, x, find, dot, name, glob, head] = got.map(([, command, index]) => [command, index]);
    expect([cd, x]).toEqual([
      [cd?.[0], 0],
      [cd?.[0], 1],
    ]);
    expect([find, dot, name, glob]).toEqual([
      [find?.[0], 0],
      [find?.[0], 1],
      [find?.[0], 2],
      [find?.[0], 3],
    ]);
    expect(head?.[1]).toBe(0);
    expect(new Set([cd?.[0], find?.[0], head?.[0]]).size).toBe(3);
  });

  test("spans index the source", () => {
    const command = 'echo "$(grep --include=*.ts x)"';
    for (const w of words(command)) {
      expect(command.slice(w.start, w.end)).toBe(w.text);
      expect(w.unquoted.length).toBe(w.text.length);
    }
  });
});
