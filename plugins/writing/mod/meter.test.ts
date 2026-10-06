import { describe, expect, test, tier } from "claude-code/testing";
import { type Score, createMeter, parseReport, record, replyText, startTurn } from "./meter.ts";

tier("user");

function score(words: number, categories: Record<string, number> = {}): Score {
  const list = Object.entries(categories).map(([category, hits]) => ({ category, hits }));
  return { words, hits: list.reduce((sum, { hits }) => sum + hits, 0), categories: list };
}

describe("replyText", () => {
  test("joins text blocks and drops the rest", () => {
    expect(
      replyText([
        { type: "thinking", thinking: "hm", signature: "s" },
        { type: "text", text: " First. " },
        { type: "tool_use", id: "t", name: "Bash", input: {} },
        { type: "text", text: "Second." },
      ]),
    ).toBe("First. \nSecond.");
  });
});

describe("parseReport", () => {
  test("reads the prose group of a score report", () => {
    const stdout = JSON.stringify({
      groups: [
        {
          group: "prose",
          wordCount: 65,
          categories: [
            { category: "AI vocabulary", hits: 1, density: 15.4 },
            { category: "load-bearing", hits: 2, density: 30.8 },
          ],
        },
      ],
    });

    expect(parseReport(stdout)).toEqual(score(65, { "AI vocabulary": 1, "load-bearing": 2 }));
  });

  const NOT_REPORTS: [string, string][] = [
    ["a module error", "error: Cannot find module 'natural'"],
    [
      "no prose group",
      JSON.stringify({ groups: [{ group: "comments", wordCount: 1, categories: [] }] }),
    ],
    ["no groups", JSON.stringify({})],
  ];

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const [name, stdout] of NOT_REPORTS) {
    test(`rejects ${name}`, () => {
      expect(parseReport(stdout)).toBeUndefined();
    });
  }
});

describe("record", () => {
  test("sums a turn's rows and starts over at the next turn", () => {
    const meter = createMeter();
    const lines: (string | undefined | null)[] = [];

    startTurn(meter);
    lines.push(record(meter, meter.generation, "a", score(100, { "spaced em dash": 1 })).status);
    lines.push(
      record(meter, meter.generation, "b", score(100, { "AI vocabulary": 2, "spaced em dash": 2 }))
        .status,
    );
    startTurn(meter);
    lines.push(record(meter, meter.generation, "c", score(200)).status);

    expect(lines).toEqual([
      "voice 10/1k · spaced em dash",
      "voice 25/1k · spaced em dash",
      "voice 0/1k",
    ]);
  });

  test("logs every score with its density", () => {
    const meter = createMeter();

    expect(record(meter, 0, "row-1", score(50, { "AI vocabulary": 2 })).event).toEqual({
      event: "voice.score",
      ok: true,
      detail: {
        uuid: "row-1",
        density: 40,
        words: 50,
        hits: 2,
        categories: [{ category: "AI vocabulary", hits: 2 }],
      },
    });
  });

  test("logs a scan from an earlier turn without touching the line", () => {
    const meter = createMeter();
    const started = meter.generation;
    startTurn(meter);

    const outcome = record(meter, started, "late", score(10, { "AI vocabulary": 1 }));

    expect(outcome).toEqual({
      event: expect.objectContaining({ detail: expect.objectContaining({ uuid: "late" }) }),
      status: null,
    });
    expect(meter.turn).toEqual(score(0));
  });

  test("turns off and clears the line when the scan cannot run", () => {
    const meter = createMeter();

    expect(record(meter, 0, "x", "bun: not found")).toEqual({
      event: { event: "voice.unavailable", ok: false, detail: { reason: "bun: not found" } },
      status: undefined,
    });
    expect(meter.unavailable).toBe(true);
  });

  test("logs a scan that lands after the meter turned off without redrawing", () => {
    const meter = createMeter();
    record(meter, 0, "x", "timed out");

    expect(record(meter, 0, "y", score(10, { "AI vocabulary": 1 })).status).toBeNull();
  });

  test("logs a second failure without clearing the line again", () => {
    const meter = createMeter();
    record(meter, 0, "x", "timed out");

    expect(record(meter, 0, "y", "timed out").status).toBeNull();
  });
});
