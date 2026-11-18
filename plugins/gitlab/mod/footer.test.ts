import { describe, expect, test } from "claude-code/testing";
import { cellsOf, fit, URGENCY, widthOf, type Chip, type Fitted, type Placed } from "./footer.tsx";
import { OCT, type Part } from "./mr.ts";

const part = (text: string, tone: Part["tone"]): Part => ({ text, tone });

const chip = (iid: number, over: Partial<Chip> = {}): Chip => ({
  key: `g/p!${iid}`,
  iid,
  url: `https://gitlab.example/g/p/-/merge_requests/${iid}`,
  lead: part("author", "warning"),
  parts: [part(OCT.checkCircle, "success"), part(OCT.reply, "warning")],
  needsAuthor: false,
  isBranch: false,
  isLabelled: true,
  ...over,
});

const placedOf = (fitted: Fitted): Placed[] => {
  if (fitted.kind !== "chips") throw new Error("expected chips");
  return fitted.placed;
};

const textOf = (placed: Placed): string =>
  [placed.label, ...placed.parts]
    .filter((p) => p !== undefined)
    .map((p) => p.text)
    .join(" ");

describe("cellsOf", () => {
  test("counts glyphs and box drawing as one cell", () => {
    expect(cellsOf(`${OCT.gitMerge}│ ab`)).toBe(5);
  });
});

describe("one chip", () => {
  const wide = chip(12, {
    parts: [
      part(`${OCT.xCircle} 12`, "error"),
      part(`${OCT.dotFill} 10/12`, "warning"),
      part(OCT.reply, "warning"),
    ],
  });
  const one = [wide];
  const tierAt = (budget: number) => placedOf(fit(one, budget))[0]?.tier;

  test("richest tier when wide", () => {
    expect(tierAt(200)).toBe("lead");
    expect(textOf(placedOf(fit(one, 200))[0]!)).toBe(
      `!12 author │ ${OCT.xCircle} 12 ${OCT.dotFill} 10/12 ${OCT.reply}`,
    );
  });

  test("steps down as the budget shrinks", () => {
    expect([100, 50, 27].map(tierAt)).toEqual(["lead", "lead", "lead"]);
    expect(tierAt(26)).toBe("full");
    expect(tierAt(20)).toBe("full");
    expect(tierAt(17)).toBe("mark");
    expect(tierAt(10)).toBe("mark");
    expect(tierAt(8)).toBe("mark");
  });

  test("id drops the parts but keeps the label", () => {
    const bare = chip(12, { parts: [part("x".repeat(30), "error")] });
    const placed = placedOf(fit([bare], 8))[0]!;
    expect(placed.tier).toBe("id");
    expect(textOf(placed)).toBe("!12");
  });

  test("collapses to a count below the minimum budget", () => {
    expect(fit(one, 7)).toEqual({ kind: "count", count: 1, tone: "error" });
    expect(fit(one, 4)).toEqual({ kind: "count", count: 1, tone: "error" });
  });

  test("a chip without a lead starts at full", () => {
    const ended = chip(3, { lead: undefined, parts: [part(`${OCT.gitMerge} merged`, "merged")] });
    const placed = placedOf(fit([ended], 200))[0]!;
    expect(placed.tier).toBe("full");
    expect(placed.label?.tone).toBe("subtle");
  });

  test("a lead with no parts draws no divider", () => {
    const bare = chip(4, { parts: [] });
    expect(textOf(placedOf(fit([bare], 200))[0]!)).toBe("!4 author");
  });

  test("mark keeps the most urgent part", () => {
    expect(placedOf(fit(one, 10))[0]?.parts).toEqual([part(`${OCT.xCircle} 12`, "error")]);
  });

  test("mark keeps the first part on a tie", () => {
    const tied = chip(1, { parts: [part("aaaa", "success"), part("bbbb", "success")] });
    expect(placedOf(fit([tied], 10))[0]?.parts).toEqual([part("aaaa", "success")]);
  });
});

describe("five chips", () => {
  const five = [
    chip(1, { lead: part("review", "suggestion"), parts: [part(OCT.check, "success")] }),
    chip(2, { lead: part("ci", "subtle"), parts: [part(`${OCT.dotFill} 1/3`, "warning")] }),
    chip(3, {
      needsAuthor: true,
      parts: [part(`${OCT.xCircle} 2`, "error"), part(OCT.reply, "warning")],
    }),
    chip(4, { lead: part("merging", "merged"), parts: [part(OCT.gitMerge, "merged")] }),
    chip(5, {
      lead: part("review", "suggestion"),
      parts: [part(`${OCT.hourglass} 1`, "suggestion")],
    }),
  ];
  const shape = (budget: number) => {
    const fitted = fit(five, budget);
    if (fitted.kind === "count") return fitted;
    return { tiers: fitted.placed.map((p) => `${p.chip.iid}:${p.tier}`), rest: fitted.rest };
  };

  test("wide terminals draw every chip in full", () => {
    const all = ["3:full", "1:full", "2:full", "4:full", "5:full"];
    expect([200, 100, 60, 40].map(shape)).toEqual(Array(4).fill({ tiers: all, rest: undefined }));
  });

  test("a squeeze demotes the later chips first", () => {
    expect(shape(30)).toEqual({
      tiers: ["3:mark", "1:mark", "2:mark", "4:id", "5:id"],
      rest: undefined,
    });
  });

  test("every chip at id before any is hidden", () => {
    expect(shape(20)).toEqual({
      tiers: ["3:id", "1:id", "2:id", "4:id", "5:id"],
      rest: undefined,
    });
  });

  test("hidden chips report their count and most urgent tone", () => {
    expect(shape(12)).toEqual({ tiers: ["3:id", "1:id"], rest: { count: 3, tone: "warning" } });
    expect(shape(8)).toEqual({ tiers: ["3:id"], rest: { count: 4, tone: "warning" } });
  });

  test("a hidden urgent chip sets the rest tone", () => {
    const urgent = [...five.slice(0, 4), chip(9, { parts: [part("x", "error")] })];
    const fitted = fit(urgent, 12);
    expect(fitted.kind === "chips" ? fitted.rest : undefined).toEqual({
      count: 3,
      tone: "error",
    });
  });

  test("below the minimum budget collapses to a count with the most urgent tone", () => {
    expect(shape(4)).toEqual({ kind: "count", count: 5, tone: "error" });
  });
});

describe("ordering", () => {
  test("needsAuthor, then branch, then iid", () => {
    const chips = [
      chip(1),
      chip(9, { isBranch: true }),
      chip(7, { needsAuthor: true }),
      chip(3, { isBranch: true }),
      chip(2, { needsAuthor: true }),
    ];
    expect(placedOf(fit(chips, 400)).map((p) => p.chip.iid)).toEqual([2, 7, 3, 9, 1]);
  });
});

describe("demotion order", () => {
  const chips = [
    chip(1, { parts: [part("a".repeat(8), "error"), part("a".repeat(8), "success")] }),
    chip(2, { parts: [part("b".repeat(8), "error"), part("b".repeat(8), "success")] }),
    chip(3, { parts: [part("c".repeat(8), "error"), part("c".repeat(8), "success")] }),
  ];
  const sweep = () =>
    Array.from({ length: 193 }, (_, i) => 200 - i).map((budget) =>
      placedOf(fit(chips, budget)).map((p) => p.tier),
    );

  test("the last chip drops first and every chip reaches mark before any reaches id", () => {
    const seen = new Set(sweep().map((tiers) => tiers.join(",")));
    expect([...seen]).toEqual([
      "full,full,full",
      "full,full,mark",
      "full,mark,mark",
      "mark,mark,mark",
      "mark,mark,id",
      "mark,id,id",
      "id,id,id",
      "id",
    ]);
  });

  test("a later chip is never richer than an earlier one", () => {
    const order = ["lead", "full", "mark", "id"];
    const inverted = sweep().filter((tiers) => {
      const ranks = tiers.map((t) => order.indexOf(t));
      return ranks.some((rank, i) => i > 0 && rank < (ranks[i - 1] ?? 0));
    });
    expect(inverted).toEqual([]);
  });
});

describe("labels", () => {
  test("an MR the engine already labels shows its lead word in place of its IID, at every tier", () => {
    const branch = chip(5, { isLabelled: false, isBranch: true });
    expect(textOf(placedOf(fit([branch], 200))[0]!)).toBe(
      `author │ ${OCT.checkCircle} ${OCT.reply}`,
    );
    const placed = placedOf(fit([branch, chip(6), chip(7), chip(8)], 19));
    expect(placed.map((p) => [p.tier, textOf(p)])).toEqual([
      ["id", "author"],
      ["id", "!6"],
      ["id", "!7"],
      ["id", "!8"],
    ]);
  });

  test("the label takes the lead tone", () => {
    expect(placedOf(fit([chip(5)], 200))[0]!.label).toEqual({ text: "!5", tone: "warning" });
  });
});

describe("urgency", () => {
  test("lists error first and subtle last", () => {
    expect(URGENCY[0]).toBe("error");
    expect(URGENCY.at(-1)).toBe("subtle");
  });
});

describe("width", () => {
  const pool = [
    chip(1),
    chip(2, { needsAuthor: true, isLabelled: false }),
    chip(3, { lead: undefined, parts: [] }),
    chip(4, { isBranch: true }),
    chip(5, { parts: [part(`${OCT.xCircle} 12`, "error"), part(OCT.alert, "warning")] }),
  ];

  test("never exceeds the budget", () => {
    const over = [1, 3, 5].flatMap((n) =>
      Array.from({ length: 197 }, (_, i) => i + 4)
        .map((budget) => ({ n, budget, width: widthOf(fit(pool.slice(0, n), budget)) }))
        .filter(({ budget, width }) => width > budget),
    );
    expect(over).toEqual([]);
  });
});
