import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommentFeatures } from "./features";
import {
  type AuditHistory,
  commentShapes,
  EMPTY_HISTORY,
  MIN_JUDGED,
  readHistory,
  shapeWeight,
  shapeWeights,
} from "./history";

function features(overrides: Partial<CommentFeatures> = {}): CommentFeatures {
  return {
    lines: 1,
    chars: 40,
    codeAlignment: 0,
    whyMarker: false,
    ticketId: false,
    dividerRule: false,
    ...overrides,
  };
}

describe("commentShapes", () => {
  it("finds no shape on a plain comment", () => {
    expect(commentShapes(features())).toEqual([]);
  });

  it("reads alignment at the threshold as code-aligned", () => {
    expect(commentShapes(features({ codeAlignment: 0.5 }))).toEqual(["code-aligned"]);
    expect(commentShapes(features({ codeAlignment: 0.49 }))).toEqual([]);
  });

  it("carries every shape a comment matches", () => {
    const all = features({ dividerRule: true, ticketId: true, whyMarker: true, codeAlignment: 1 });
    expect(commentShapes(all)).toEqual(["divider-rule", "ticket-id", "why-marker", "code-aligned"]);
  });
});

async function writeRun(
  jobBase: string,
  name: string,
  pairs: { id: string; features: Partial<CommentFeatures>; action: string }[],
): Promise<void> {
  const jobDir = join(jobBase, name);
  await mkdir(join(jobDir, "verdicts"), { recursive: true });
  await Bun.write(
    join(jobDir, "features.json"),
    JSON.stringify(Object.fromEntries(pairs.map((pair) => [pair.id, features(pair.features)]))),
  );
  await Bun.write(
    join(jobDir, "verdicts", "shard-0.json"),
    JSON.stringify({
      verdicts: pairs.map((pair) => ({ id: pair.id, verdict: { action: pair.action } })),
    }),
  );
}

function newJobBase(): string {
  return mkdtempSync(join(tmpdir(), "audit-history-"));
}

describe("readHistory", () => {
  it("is empty for a job base no run has written", async () => {
    expect(await readHistory(join(newJobBase(), "absent"))).toEqual(EMPTY_HISTORY);
  });

  it("pairs each verdict with its features and counts anything but keep as actioned", async () => {
    const base = newJobBase();
    await writeRun(base, "one", [
      { id: "a", features: { whyMarker: true }, action: "keep" },
      { id: "b", features: { whyMarker: true }, action: "trim" },
      { id: "c", features: { ticketId: true }, action: "rewrite" },
    ]);
    expect(await readHistory(base)).toEqual({
      runs: 1,
      judged: 3,
      actioned: 2,
      shapes: [
        { shape: "ticket-id", judged: 1, actioned: 1 },
        { shape: "why-marker", judged: 2, actioned: 1 },
      ],
    });
  });

  it("accumulates across runs", async () => {
    const base = newJobBase();
    await writeRun(base, "one", [{ id: "a", features: {}, action: "keep" }]);
    await writeRun(base, "two", [{ id: "a", features: {}, action: "trim" }]);
    const history = await readHistory(base);
    expect(history.runs).toBe(2);
    expect(history.judged).toBe(2);
  });

  it("skips a verdict whose comment left no features behind", async () => {
    const base = newJobBase();
    await writeRun(base, "one", [{ id: "a", features: {}, action: "trim" }]);
    await Bun.write(
      join(base, "one", "verdicts", "shard-1.json"),
      JSON.stringify({ verdicts: [{ id: "gone", verdict: { action: "trim" } }] }),
    );
    expect((await readHistory(base)).judged).toBe(1);
  });

  it("skips a verdict carrying an action this version does not know", async () => {
    const base = newJobBase();
    await writeRun(base, "one", [
      { id: "a", features: {}, action: "trim" },
      { id: "b", features: {}, action: "kepe" },
    ]);
    const history = await readHistory(base);
    expect(history.judged).toBe(1);
    expect(history.actioned).toBe(1);
  });

  it("counts a comment once when a re-judged shard verdicts it twice", async () => {
    const base = newJobBase();
    await writeRun(base, "one", [{ id: "a", features: {}, action: "trim" }]);
    await Bun.write(
      join(base, "one", "verdicts", "shard-0-retry.json"),
      JSON.stringify({ verdicts: [{ id: "a", verdict: { action: "keep" } }] }),
    );
    expect((await readHistory(base)).judged).toBe(1);
  });

  it("skips a job dir that never reached its verdicts", async () => {
    const base = newJobBase();
    await writeRun(base, "one", [{ id: "a", features: {}, action: "trim" }]);
    await mkdir(join(base, "abandoned"), { recursive: true });
    await Bun.write(join(base, "abandoned", "features.json"), JSON.stringify({ a: features() }));
    const history = await readHistory(base);
    expect(history.runs).toBe(1);
  });

  it("skips a job dir whose files are unreadable rather than failing the run", async () => {
    const base = newJobBase();
    await mkdir(join(base, "corrupt", "verdicts"), { recursive: true });
    await Bun.write(join(base, "corrupt", "features.json"), "{ truncated");
    expect(await readHistory(base)).toEqual(EMPTY_HISTORY);
  });

  it("keeps a features row written before a field existed", async () => {
    const base = newJobBase();
    await mkdir(join(base, "old", "verdicts"), { recursive: true });
    await Bun.write(join(base, "old", "features.json"), JSON.stringify({ a: { lines: 1 } }));
    await Bun.write(
      join(base, "old", "verdicts", "shard-0.json"),
      JSON.stringify({ verdicts: [{ id: "a", verdict: { action: "trim" } }] }),
    );
    expect((await readHistory(base)).judged).toBe(1);
  });
});

function measured(shapes: AuditHistory["shapes"], judged: number, actioned: number): AuditHistory {
  return { runs: 1, judged, actioned, shapes };
}

describe("shapeWeights", () => {
  it("weighs nothing until a shape reaches the threshold", () => {
    const thin = measured(
      [{ shape: "why-marker", judged: MIN_JUDGED - 1, actioned: MIN_JUDGED - 1 }],
      100,
      50,
    );
    expect(shapeWeights(thin).size).toBe(0);
  });

  it("lifts a shape the judge acts on above the overall rate", () => {
    const lifted = measured([{ shape: "why-marker", judged: 40, actioned: 20 }], 200, 50);
    expect(shapeWeights(lifted).get("why-marker")).toBe(2);
  });

  it("clamps a lift at both ends, so one shape cannot swamp the score", () => {
    const extreme = measured(
      [
        { shape: "why-marker", judged: 40, actioned: 40 },
        { shape: "ticket-id", judged: 40, actioned: 0 },
      ],
      1000,
      50,
    );
    const weights = shapeWeights(extreme);
    expect(weights.get("why-marker")).toBe(2);
    expect(weights.get("ticket-id")).toBe(0.5);
  });

  it("weighs nothing when no comment has been actioned", () => {
    expect(
      shapeWeights(measured([{ shape: "why-marker", judged: 40, actioned: 0 }], 40, 0)).size,
    ).toBe(0);
    expect(shapeWeights(EMPTY_HISTORY).size).toBe(0);
  });
});

describe("shapeWeight", () => {
  const weights = new Map([
    ["why-marker", 2],
    ["ticket-id", 0.5],
  ] as const);

  it("leaves a comment carrying no measured shape alone", () => {
    expect(shapeWeight(features(), weights)).toBe(1);
    expect(shapeWeight(features({ dividerRule: true }), weights)).toBe(1);
  });

  it("applies the shape's own weight", () => {
    expect(shapeWeight(features({ whyMarker: true }), weights)).toBe(2);
  });

  it("averages the shapes a comment matches, so one offsets the other", () => {
    expect(shapeWeight(features({ whyMarker: true, ticketId: true }), weights)).toBe(1.25);
  });

  it("ignores a matched shape with no measured rate", () => {
    expect(shapeWeight(features({ whyMarker: true, dividerRule: true }), weights)).toBe(2);
  });
});
