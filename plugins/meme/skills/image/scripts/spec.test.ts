import { describe, expect, test } from "bun:test";
import { specFromFlags, validateSpec } from "./spec";

describe("validateSpec", () => {
  test.each([
    ["not an object", "nope"],
    ["empty object", {}],
    ["empty arrays", { boxes: [], captions: [] }],
    ["box missing text", { boxes: [{ preset: "classic" }] }],
    ["bad preset", { boxes: [{ text: "hi", preset: "comic-sans" }] }],
    [
      "anchor and region together",
      { boxes: [{ text: "hi", anchor: "top", region: { x: 0, y: 0, w: 1, h: 1 } }] },
    ],
    ["region out of range", { boxes: [{ text: "hi", region: { x: 0, y: 0, w: 2, h: 1 } }] }],
    ["bad fontSize override", { boxes: [{ text: "hi", style: { fontSize: 40 } }] }],
    ["bad caption position", { captions: [{ text: "hi", position: "left" }] }],
  ])("rejects %s", (_name, spec) => {
    expect(() => validateSpec(spec)).toThrowErrorMatchingSnapshot();
  });

  test("accepts a full spec unchanged", () => {
    const spec = {
      boxes: [
        { text: "top text", preset: "classic", anchor: "top" },
        {
          text: "a label",
          preset: "label",
          region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
          align: "left",
          valign: "top",
          style: { fill: "#ff0000", fontSize: 0.05 },
        },
      ],
      captions: [{ text: "a caption", position: "bottom" }],
    };
    expect(validateSpec(spec)).toEqual(spec as ReturnType<typeof validateSpec>);
  });
});

describe("specFromFlags", () => {
  test("classic top and bottom", () => {
    expect(
      specFromFlags({ top: "one does not simply", bottom: "ship on friday" }),
    ).toMatchInlineSnapshot(`
        {
          "boxes": [
            {
              "anchor": "top",
              "preset": "classic",
              "text": "one does not simply",
            },
            {
              "anchor": "bottom",
              "preset": "classic",
              "text": "ship on friday",
            },
          ],
        }
      `);
  });

  test("subtitle", () => {
    expect(specFromFlags({ subtitle: "♪ Fable Five, Fable Five ♪" })).toMatchInlineSnapshot(`
      {
        "boxes": [
          {
            "preset": "subtitle",
            "text": "♪ Fable Five, Fable Five ♪",
          },
        ],
      }
    `);
  });

  test("caption defaults to top", () => {
    expect(specFromFlags({ caption: "me explaining memes" })).toMatchInlineSnapshot(`
      {
        "captions": [
          {
            "position": "top",
            "text": "me explaining memes",
          },
        ],
      }
    `);
  });

  test("caption position bottom", () => {
    expect(specFromFlags({ caption: "hmm", captionPosition: "bottom" })).toMatchInlineSnapshot(`
      {
        "captions": [
          {
            "position": "bottom",
            "text": "hmm",
          },
        ],
      }
    `);
  });

  test.each([
    ["no flags", {}],
    ["bad caption position", { caption: "x", captionPosition: "middle" }],
  ])("rejects %s", (_name, flags) => {
    expect(() => specFromFlags(flags)).toThrowErrorMatchingSnapshot();
  });
});
