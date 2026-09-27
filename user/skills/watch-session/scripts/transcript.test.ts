import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { render, splitLines, TurnTracker } from "./transcript";

const encoder = new TextEncoder();

function jsonl(entries: object[]): Uint8Array {
  return encoder.encode(entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

const prompt = (content: string, promptSource = "typed") => ({
  type: "user",
  promptSource,
  message: { content },
});
const assistant = (...content: object[]) => ({ type: "assistant", message: { content } });
const result = (text: string, isError = false) => ({
  type: "user",
  message: { content: [{ type: "tool_result", is_error: isError, content: text }] },
});
const toolUse = (name: string, input: object = {}) => ({ type: "tool_use", name, input });
const turnEnd = { type: "system", subtype: "turn_duration", durationMs: 4200 };

const session = [
  prompt("/hill-climb claude-sync-perf"),
  assistant(toolUse("Skill", { skill: "hill-climb" })),
  {
    type: "user",
    message: {
      content: [
        { type: "text", text: "Base directory for this skill: /repo/skills/hill-climb\n\n# Hill" },
      ],
    },
  },
  assistant(toolUse("Bash", { command: "bench" })),
  result("exit 1", true),
  assistant(toolUse("AskUserQuestion", { questions: [{ question: "Keep the regression?" }] })),
  result("yes"),
  assistant({ type: "text", text: "Benchmark regressed 4%." }),
  turnEnd,
  { type: "file-history-snapshot" },
  prompt("try again"),
  assistant(toolUse("Bash")),
  {
    type: "user",
    message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] },
  },
  { type: "assistant", isSidechain: true, message: { content: [toolUse("Read")] } },
];

function events(bytes: Uint8Array) {
  const tracker = new TurnTracker();
  return splitLines(bytes, 0).lines.flatMap((line) => tracker.feed(line));
}

describe("TurnTracker", () => {
  test("digests completed and interrupted turns", () => {
    expect(events(jsonl(session))).toMatchSnapshot();
  });

  test("takes the last typed command before the answer as the prompt", () => {
    const typed = [
      {
        type: "user",
        isMeta: true,
        message: { content: "<local-command-caveat>Caveat</local-command-caveat>" },
      },
      prompt("<command-name>/add-dir</command-name><command-args>/tmp/dev</command-args>"),
      prompt("<local-command-stdout>Added /tmp/dev</local-command-stdout>"),
      prompt(
        "<command-message>hill-climb</command-message><command-name>/hill-climb</command-name><command-args>bin/sync</command-args>",
      ),
      {
        type: "user",
        message: {
          content: [{ type: "text", text: "Base directory for this skill: /repo/hill-climb" }],
        },
      },
      assistant({ type: "text", text: "Climbing." }),
      turnEnd,
    ];
    const [turn] = events(jsonl(typed));
    expect(turn).toMatchObject({ prompt: "/hill-climb bin/sync", skills: ["hill-climb"] });
  });

  test("a turn stays open until its end marker arrives", () => {
    const open = events(jsonl(session.slice(0, 8)));
    expect(open.map((e) => e.event)).toEqual(["blocked"]);
  });
});

describe("splitLines", () => {
  test("reads cut at any byte yield the same lines as one read", () => {
    const bytes = jsonl(session);
    const whole = splitLines(bytes, 0).lines;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: bytes.length }), (cut) => {
        const head = splitLines(bytes.subarray(0, cut), 0);
        const tail = splitLines(bytes.subarray(head.consumed), head.consumed);
        expect([...head.lines, ...tail.lines]).toEqual(whole);
      }),
    );
  });

  test("skips lines that are not JSON", () => {
    const bytes = new Uint8Array([...encoder.encode("not json\n"), ...jsonl([turnEnd])]);
    expect(splitLines(bytes, 0).lines).toHaveLength(1);
  });
});

test("render prints one line per block", () => {
  expect(render(splitLines(jsonl(session), 0).lines, 40)).toMatchSnapshot();
});
