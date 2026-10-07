import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { blocks, chain, LIMIT, pick, runAlls } from "../mod/commands";

type Segment =
  | { kind: "command"; command: string; line: string }
  | { kind: "blank" | "fence" | "prose"; line: string };

const word = gs.text({ alphabet: "abcxyz019-_./=", minSize: 1, maxSize: 6 });

const commandText = gs
  .arrays(gs.oneOf(word, gs.sampledFrom(["!", "|", "&&", "2>&1", "'a b'", "$X", "\\"])), {
    minSize: 1,
    maxSize: 5,
  })
  .map((parts) => parts.join(" "));

const commandSegment: gs.Generator<Segment> = gs
  .record({
    command: commandText,
    indent: gs.sampledFrom(["", " ", "  ", "\t"]),
    bullet: gs.sampledFrom(["", "- ", "* "]),
    ticks: gs.booleans(),
    gap: gs.sampledFrom([" ", "  ", "\t"]),
    tail: gs.sampledFrom(["", " ", "  "]),
  })
  .map(({ command, indent, bullet, ticks, gap, tail }) => {
    const tick = ticks ? "`" : "";
    return {
      kind: "command",
      command,
      line: `${indent}${bullet}${tick}!${gap}${command}${tick}${tail}`,
    };
  });

const segment: gs.Generator<Segment> = gs.oneOf(
  commandSegment,
  gs.sampledFrom(["", " ", "\t"]).map((line) => ({ kind: "blank", line })),
  gs.sampledFrom(["```", "```sh", "  ```bash"]).map((line) => ({ kind: "fence", line })),
  gs
    .arrays(word, { minSize: 1, maxSize: 4 })
    .map((words) => ({ kind: "prose", line: `Then ${words.join(" ")}:` })),
);

/** The grouping spelled out over segments, with no line parsing. */
function model(segments: readonly Segment[]): string[][] {
  const found: string[][] = [];
  let open = false;
  for (const part of segments) {
    if (part.kind === "command") {
      if (open) found.at(-1)?.push(part.command);
      else found.push([part.command]);
      open = true;
    } else if (part.kind === "prose") {
      open = false;
    }
  }
  return found;
}

describe("blocks", () => {
  test.each<{ name: string; text: string; expected: string[][] }>([
    {
      name: "blank lines and fences keep a block open",
      text: "Run:\n\n! git restore -- a\n\n! rm -r b\n```\n! git push\n```\nThen:\n! pwd",
      expected: [["git restore -- a", "rm -r b", "git push"], ["pwd"]],
    },
    {
      name: "bullets, backticks, and padding are stripped",
      text: "!echo nospace\n* ! ls -la  \n`! wt list `",
      expected: [["ls -la", "wt list"]],
    },
    { name: "an inline command is prose", text: "or run ! pwd inline", expected: [] },
    { name: "a bang with only whitespace is no command", text: "!  \n` !  `", expected: [] },
  ])("$name", ({ text, expected }) => {
    expect(blocks(text)).toEqual(expected);
  });

  test("matches the segment model", () => {
    hegel.test((tc) => {
      const segments = tc.draw(gs.arrays(segment, { maxSize: 12 }));
      const text = segments.map((part) => part.line).join("\n");
      expect(blocks(text)).toEqual(model(segments));
    });
  });

  test("returns trimmed single-line commands from arbitrary text", () => {
    hegel.test((tc) => {
      const text = tc.draw(gs.text({ alphabet: "!`-* \t\nab;&#" }));
      for (const command of blocks(text).flat()) {
        expect(command).not.toBe("");
        expect(command).toBe(command.trim());
        expect(command).not.toMatch(/[`\n]/);
      }
    });
  });
});

const SAFE_SUFFIXES = [
  "",
  " 2>&1",
  " &>/dev/null",
  " | cat",
  " && true",
  ' "a; b"',
  " 'x || y'",
  String.raw` a\;`,
];
const UNSAFE_SUFFIXES = [
  "; true",
  " # note",
  " &",
  " || true",
  " |",
  " \\",
  " &&",
  " 'open",
  ' "open',
  " $(open",
  " <<EOF",
  " && source env",
  " && eval x",
  String.raw` $'\'`,
  ' "$(open)"',
];

const step = gs.record({
  fails: gs.booleans(),
  suffix: gs.sampledFrom([...SAFE_SUFFIXES, ...UNSAFE_SUFFIXES]),
});

// The helper body contains `;`, so it is defined outside the chained commands.
const STEP = 'step() { echo "$1"; return "$2"; }';

describe("chain", () => {
  test.each<{ name: string; block: string[]; expected: string | undefined }>([
    { name: "plain commands", block: ["a", "b"], expected: "a && b" },
    {
      name: "redirects and inner && chain",
      block: ["make 2>&1", "x &>log", "c && d"],
      expected: "make 2>&1 && x &>log && c && d",
    },
    { name: "a single command", block: ["a"], expected: undefined },
    { name: "a semicolon", block: ["a; b", "c"], expected: undefined },
    { name: "a comment", block: ["a # note", "c"], expected: undefined },
    { name: "a backgrounding &", block: ["sleep 1 &", "c"], expected: undefined },
    {
      name: "an || that would run after a failure",
      block: ["false", "a || b"],
      expected: undefined,
    },
    { name: "a trailing pipe", block: ["cat log |", "wc -l"], expected: undefined },
    { name: "an unbalanced quote", block: ['echo "a', "b"], expected: undefined },
    { name: "a heredoc opener", block: ["cat <<EOF", "b"], expected: undefined },
    {
      name: "a here-string and an escaped quote",
      block: ["cat <<<x", String.raw`echo \"`],
      expected: String.raw`cat <<<x && echo \"`,
    },
    {
      name: "operators that are quoted or escaped",
      block: ['git commit -m "a; b"', String.raw`echo 'x || y' a\; "it's"`],
      expected: String.raw`git commit -m "a; b" && echo 'x || y' a\; "it's"`,
    },
    {
      name: "a sourced script",
      block: ["source .venv/bin/activate", "pytest"],
      expected: undefined,
    },
    { name: "a dot-sourced script", block: ["cd x && . ./env", "make"], expected: undefined },
    {
      name: "an eval",
      block: ['eval "set -e; false; echo continued"', "next"],
      expected: undefined,
    },
    {
      name: "a child shell keeps its own set -e",
      block: ['bash -c "set -e; false"', "next"],
      expected: 'bash -c "set -e; false" && next',
    },
    {
      name: "a quote opened inside the other kind",
      block: [`echo "a'" 'b"`, "c"],
      expected: undefined,
    },
    {
      name: "an ANSI-C quote holding an escaped quote",
      block: [String.raw`echo $'\''`, "c"],
      expected: String.raw`echo $'\'' && c`,
    },
    { name: "an ANSI-C quote left open", block: [String.raw`echo $'\'`, "c"], expected: undefined },
    {
      name: "a substitution in double quotes",
      block: ['echo "$(date)"', "c"],
      expected: undefined,
    },
    {
      name: "a trailing escaped backslash",
      block: [String.raw`echo a\\`, "c"],
      expected: String.raw`echo a\\ && c`,
    },
  ])("$name", ({ block, expected }) => {
    expect(chain(block)).toBe(expected);
  });

  test("refuses exactly the blocks holding an unchainable suffix", () => {
    hegel.test((tc) => {
      const steps = tc.draw(gs.arrays(step, { minSize: 2, maxSize: 5 }));
      const block = steps.map((s, i) => `echo ${i}${s.suffix}`);
      const unsafe = steps.some((s) => UNSAFE_SUFFIXES.includes(s.suffix));
      expect(chain(block) === undefined).toBe(unsafe);
    });
  });

  test("runs in order and stops at the first failing command", () => {
    hegel.test(
      (tc) => {
        const suffixes = SAFE_SUFFIXES.filter((suffix) => suffix !== " &>/dev/null");
        const steps = tc.draw(
          gs.arrays(gs.record({ fails: gs.booleans(), suffix: gs.sampledFrom(suffixes) }), {
            minSize: 2,
            maxSize: 5,
          }),
        );
        const joined = chain(steps.map((s, i) => `step ${i} ${s.fails ? 1 : 0}${s.suffix}`));
        expect(joined).toBeDefined();
        // A pipeline takes its last command's status, so `| cat` hides a failure.
        const stops = steps.findIndex((s) => s.fails && s.suffix !== " | cat");
        const ran = stops === -1 ? steps.length : stops + 1;
        const run = Bun.spawnSync(["bash", "-c", `${STEP}\n${joined ?? ""}`]);
        expect(run.stdout.toString()).toBe(
          steps
            .slice(0, ran)
            .map((_, i) => `${i}\n`)
            .join(""),
        );
        expect(run.exitCode === 0).toBe(stops === -1);
      },
      { testCases: 60 },
    );
  });

  test("an accepted chain runs as the commands do one at a time in bash", () => {
    // Most draws chain, so the bash comparison runs on most cases.
    const quoted = gs.sampledFrom([
      "x",
      "'a b'",
      '"c;d"',
      `"it's"`,
      String.raw`e\;`,
      String.raw`\\`,
      String.raw`$'\''`,
      "|",
      "&&",
      "$(true)",
    ]);
    const open = gs.sampledFrom([String.raw`$'\'`, '"', "'", "(", ")", "#", ";", "&", '"$(true)"']);
    const fragments = gs.oneOf(quoted, quoted, quoted, open);
    const bash = (script: string) => Bun.spawnSync(["bash", "-c", `${STEP}\n${script}`]);
    hegel.test(
      (tc) => {
        const steps = tc.draw(
          gs.arrays(
            gs.record({ fails: gs.booleans(), args: gs.arrays(fragments, { maxSize: 3 }) }),
            {
              minSize: 2,
              maxSize: 3,
            },
          ),
        );
        const block = steps.map((s, i) => [`step ${i} ${s.fails ? 1 : 0}`, ...s.args].join(" "));
        const joined = chain(block);
        if (joined === undefined) return;
        let expected = "";
        let syntaxError = false;
        for (const command of block) {
          const alone = bash(command);
          expected += alone.stdout.toString();
          syntaxError ||= alone.exitCode === 2;
          if (alone.exitCode !== 0) break;
        }
        const output = bash(joined).stdout.toString();
        expect(output === expected || (syntaxError && output === "")).toBe(true);
      },
      { testCases: 100 },
    );
  }, 60_000);
});

describe("runAlls", () => {
  test("covers the listed commands of each chainable block", () => {
    hegel.test((tc) => {
      const found = tc.draw(
        gs.arrays(gs.arrays(gs.oneOf(word, gs.just("a;b")), { minSize: 1, maxSize: 5 }), {
          maxSize: 6,
        }),
      );
      const flat = found.flat();
      const runs = runAlls(found);
      let previousEnd = 0;
      for (const run of runs) {
        expect(run.count).toBeGreaterThanOrEqual(2);
        expect(run.first).toBeGreaterThan(previousEnd);
        expect(run.first + run.count - 1).toBeLessThanOrEqual(LIMIT);
        expect(run.command).toBe(flat.slice(run.first - 1, run.first - 1 + run.count).join(" && "));
        previousEnd = run.first + run.count - 1;
      }
      let first = 1;
      const expected = found.flatMap((block) => {
        const listed = block.slice(0, Math.max(0, LIMIT - first + 1));
        const start = first;
        first += block.length;
        const chainable = listed.length >= 2 && listed.every((c) => !c.includes(";"));
        return chainable ? [{ first: start, count: listed.length }] : [];
      });
      expect(runs.map((run) => ({ first: run.first, count: run.count }))).toEqual(expected);
    });
  });
});

describe("pick", () => {
  test.each<{ input: string; expected: string | undefined }>([
    { input: "2", expected: "wt list" },
    { input: "3", expected: undefined },
    { input: "0", expected: undefined },
    { input: "ls", expected: undefined },
  ])("$input", ({ input, expected }) => {
    expect(pick(input, ["git status --short", "wt list"])).toBe(expected);
  });
});
