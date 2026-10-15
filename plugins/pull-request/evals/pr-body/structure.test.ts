import { describe, expect, test } from "bun:test";
import { measureStructure, overLimits } from "./structure";

const long = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

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

describe("overLimits", () => {
  test.each([
    [long(20), []],
    [long(41), ["maxBlockWords"]],
    [Array.from({ length: 5 }, () => long(30)).join("\n\n"), ["visibleWords"]],
  ])("%#", (body, expected) => {
    expect(overLimits(measureStructure(body))).toEqual(expected);
  });
});
