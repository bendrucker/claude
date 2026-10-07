import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { blocks, chain, commands, LIMIT, pick, runAlls } from "../mod/commands";

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
      for (const command of commands(text)) {
        expect(command).not.toBe("");
        expect(command).toBe(command.trim());
        expect(command).not.toMatch(/[`\n]/);
      }
    });
  });
});

const SAFE_SUFFIXES = ["", " 2>&1", " &>/dev/null", " | cat", " && true", " || false"];
const UNSAFE_SUFFIXES = ["; true", " # note", " &"];

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
      name: "a quoted semicolon, refused conservatively",
      block: ['git commit -m "a; b"', "c"],
      expected: undefined,
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
