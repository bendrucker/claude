import { describe, expect, test } from "claude-code/testing";
import { type Class, explain } from "./explain";

describe("explain", () => {
  test("each class matches real zsh output", () => {
    const cases: [string, string, Class][] = [
      ["glob", "zsh:1: no matches found: *.nope", "glob"],
      ["glob in eval", "(eval):3: no matches found: src/**/*.ts", "glob"],
      ["equals", "zsh:1: == not found", "equals"],
      ["reserved status", "zsh:1: read-only variable: status", "reserved"],
      ["reserved pipestatus", "zsh:1: read-only variable: pipestatus", "reserved"],
      ["split", "zsh:1: command not found: ls -l", "split"],
      ["bad substitution", "zsh:1: bad substitution", "bash-syntax"],
      ["bad math", "zsh:1: bad math expression: operand expected at end of string", "bash-syntax"],
      ["invalid subscript", "zsh:1: invalid subscript", "bash-syntax"],
    ];
    for (const [name, text, expected] of cases) {
      const notes = explain(text, new Set());
      expect(
        notes.map((n) => n.class),
        name,
      ).toEqual([expected]);
      expect(notes[0]!.repeat, name).toBe(false);
    }
  });

  test("names the offending subject in the full note", () => {
    expect(explain("zsh:1: no matches found: *.nope", new Set())[0]!.note).toContain("*.nope");
    expect(explain("zsh:1: command not found: ls -l", new Set())[0]!.note).toContain("ls -l");
    expect(explain("zsh:1: == not found", new Set())[0]!.note).toContain("==");
    expect(explain("zsh:1: read-only variable: status", new Set())[0]!.note).toContain("status");
  });

  test("first note is full, later notes are a short reminder", () => {
    const seen = new Set<Class>();
    const text = "zsh:1: no matches found: *.nope";
    const [first] = explain(text, seen);
    const [second] = explain(text, seen);
    expect(first!.repeat).toBe(false);
    expect(second!.repeat).toBe(true);
    expect(second!.note.length).toBeLessThan(first!.note.length);
    expect([...seen]).toEqual(["glob"]);
  });

  test("a URL gets only the quoting hint", () => {
    const [note] = explain("zsh:1: no matches found: https://x.com/a?b=1", new Set());
    expect(note!.note).toContain("https://x.com/a?b=1");
    expect(note!.note).toContain("Quote");
    expect(note!.note).not.toContain("nullglob");
  });

  test("multiple classes come back in first-seen order, once each", () => {
    const text = [
      "zsh:1: bad substitution",
      "zsh:2: no matches found: *.nope",
      "zsh:3: bad substitution",
      "zsh:4: read-only variable: status",
    ].join("\n");
    const seen = new Set<Class>(["glob"]);
    const notes = explain(text, seen);
    expect(notes.map((n) => [n.class, n.repeat])).toEqual([
      ["bash-syntax", false],
      ["glob", true],
      ["reserved", false],
    ]);
    expect([...seen]).toEqual(["glob", "bash-syntax", "reserved"]);
  });

  test("unrelated text yields nothing", () => {
    const cases: [string, string][] = [
      ["plain output", "total 0\nfile.txt"],
      ["not a zsh line", "bash: no matches found: x"],
      ["unprefixed", "no matches found: x"],
      ["command not found without a space", "zsh:1: command not found: foo"],
      ["other zsh error", "zsh:1: permission denied: ./x"],
    ];
    for (const [name, text] of cases) {
      const seen = new Set<Class>();
      expect(explain(text, seen), name).toEqual([]);
      expect(seen.size, name).toBe(0);
    }
  });
});
