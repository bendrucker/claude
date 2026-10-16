import { describe, expect, test } from "bun:test";
import { measureStructure, overLimits } from "./structure";

const long = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const codeSpans = (n: number) => Array.from({ length: n }, (_, i) => `\`c${i}\``).join(" ");

describe("measureStructure", () => {
  test.each([
    [
      "blank line after summary",
      `Lead.\n\n<details>\n<summary>Data</summary>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n${long(50)}\n\n</details>\n`,
    ],
    ["glued to summary", `Lead.\n\n<details><summary>Data</summary>\n${long(50)}\n</details>\n`],
  ])("excludes <details> content from visible words (%s)", (_, body) => {
    const s = measureStructure(body);
    expect(s.visibleWords).toBe(1);
    expect(s.visibleTables).toBe(0);
    expect(s.collapsedBlocks).toBe(1);
    expect(s.collapsedWords).toBeGreaterThanOrEqual(50);
  });

  test("measures paragraphs and bullets as blocks, excluding nested items", () => {
    const s = measureStructure(`${long(12)}\n\n- ${long(30)}\n  - ${long(5)}\n- one two\n`);
    expect(s).toMatchObject({
      paragraphs: 1,
      bullets: 3,
      maxBlockWords: 30,
      maxWordsPerBullet: 30,
      blocksOver30: 0,
    });
  });

  test("ignores fenced code", () => {
    expect(measureStructure(`Fix.\n\n\`\`\`\n${long(200)}\n\`\`\`\n`)).toMatchObject({
      visibleWords: 1,
      visibleCodeLines: 1,
    });
  });
});

describe("proseCodeSpans", () => {
  test("counts spans in paragraphs and list items only", () => {
    const body = [
      "Use `a` and `b`.",
      "- item `c`\n  - nested `d`",
      "| h |\n|---|\n| `t` |",
      "```\n`fenced`\n```",
      "<details>\n\nhidden `e`\n\n</details>",
    ].join("\n\n");
    expect(measureStructure(body).proseCodeSpans).toBe(4);
  });
});

describe("overLimits", () => {
  const cases: [string, ReturnType<typeof overLimits>][] = [
    [long(20), []],
    [long(41), ["maxBlockWords"]],
    [Array.from({ length: 5 }, () => long(30)).join("\n\n"), ["visibleWords"]],
    [codeSpans(7), ["proseCodeSpans"]],
    [codeSpans(6), []],
    [`${long(41)} ${codeSpans(7)}`, ["maxBlockWords", "proseCodeSpans"]],
  ];
  test.each(cases)("%#", (body, expected) => {
    expect(overLimits(measureStructure(body))).toEqual(expected);
  });
});
