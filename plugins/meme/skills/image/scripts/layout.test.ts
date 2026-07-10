import { describe, expect, test } from "bun:test";
import {
  captionBarHeight,
  defaultValign,
  fitText,
  type Measure,
  padRegion,
  resolveRegion,
  wrapText,
} from "./layout";

const measure: Measure = (text, fontPx) => text.length * fontPx * 0.6;

describe("wrapText", () => {
  test.each([
    ["empty string", "", 100, []],
    ["single word that fits", "hello", 100, ["hello"]],
    ["exact fit stays on one line", "abcdefgh", 48, ["abcdefgh"]],
    ["forced break", "one two three four five", 60, ["one two", "three four", "five"]],
    [
      "overlong word on its own line",
      "hi supercalifragilistic yo",
      60,
      ["hi", "supercalifragilistic", "yo"],
    ],
    ["collapses whitespace", "a  b \n c", 100, ["a b c"]],
  ])("%s", (_name, text, maxWidth, expected) => {
    expect(wrapText(text, maxWidth, 10, measure)).toEqual(expected);
  });
});

describe("fitText", () => {
  test("fits at max size", () => {
    expect(
      fitText("short", { maxWidth: 300, maxHeight: 100, maxFontPx: 60, minFontPx: 12, measure }),
    ).toMatchInlineSnapshot(`
        {
          "fontPx": 60,
          "lines": [
            "short",
          ],
          "overflow": false,
        }
      `);
  });

  test("shrinks to fit width", () => {
    expect(
      fitText("a somewhat longer line of text", {
        maxWidth: 300,
        maxHeight: 200,
        maxFontPx: 60,
        minFontPx: 12,
        measure,
      }),
    ).toMatchInlineSnapshot(`
      {
        "fontPx": 44,
        "lines": [
          "a somewhat",
          "longer line",
          "of text",
        ],
        "overflow": false,
      }
    `);
  });

  test("floors with overflow", () => {
    expect(
      fitText("way too much text to ever fit inside such a tiny little region honestly", {
        maxWidth: 60,
        maxHeight: 30,
        maxFontPx: 60,
        minFontPx: 12,
        measure,
      }),
    ).toMatchInlineSnapshot(`
      {
        "fontPx": 12,
        "lines": [
          "way too",
          "much",
          "text to",
          "ever fit",
          "inside",
          "such a",
          "tiny",
          "little",
          "region",
          "honestly",
        ],
        "overflow": true,
      }
    `);
  });
});

describe("resolveRegion", () => {
  test.each([
    ["top anchor", { anchor: "top" as const }, { x: 50, y: 10, w: 900, h: 150 }],
    ["bottom anchor", { anchor: "bottom" as const }, { x: 50, y: 340, w: 900, h: 150 }],
    ["center anchor", { anchor: "center" as const }, { x: 50, y: 175, w: 900, h: 150 }],
    ["defaults to top", {}, { x: 50, y: 10, w: 900, h: 150 }],
    [
      "explicit region",
      { region: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 } },
      { x: 250, y: 250, w: 500, h: 125 },
    ],
  ])("%s", (_name, placement, expected) => {
    expect(resolveRegion(placement, 1000, 500)).toEqual(expected);
  });
});

describe("defaultValign", () => {
  test.each([
    [
      "explicit valign wins",
      { text: "x", valign: "middle" as const },
      "top" as const,
      "middle" as const,
    ],
    ["top anchor", { text: "x" }, "top" as const, "top" as const],
    ["bottom anchor", { text: "x" }, "bottom" as const, "bottom" as const],
    ["center anchor", { text: "x" }, "center" as const, "middle" as const],
    [
      "region defaults to middle",
      { text: "x", region: { x: 0, y: 0, w: 1, h: 1 } },
      "top" as const,
      "middle" as const,
    ],
  ])("%s", (_name, box, anchor, expected) => {
    expect(defaultValign(box, anchor)).toBe(expected);
  });
});

test("padRegion insets 4% per side", () => {
  expect(padRegion({ x: 100, y: 200, w: 500, h: 250 })).toEqual({
    x: 120,
    y: 210,
    w: 460,
    h: 230,
  });
});

test("captionBarHeight", () => {
  expect(captionBarHeight(2, 40, 20)).toBe(Math.ceil(2 * 40 * 1.15 + 40));
});
