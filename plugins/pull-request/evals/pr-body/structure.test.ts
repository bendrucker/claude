import { describe, expect, test } from "bun:test";
import { measureStructure, overLimits, WALL_MIN_ITEMS } from "./structure";

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
    [Array.from({ length: 5 }, () => long(31)).join("\n\n"), ["visibleWords"]],
    [Array.from({ length: 5 }, () => `- ${long(31)}`).join("\n"), ["visibleWords"]],
    [codeSpans(7), ["proseCodeSpans"]],
    [codeSpans(6), []],
    [`${long(41)} ${codeSpans(7)}`, ["maxBlockWords", "proseCodeSpans"]],
  ];
  test.each(cases)("%#", (body, expected) => {
    expect(overLimits(measureStructure(body))).toEqual(expected);
  });
});

describe("wallLists", () => {
  const dense = (n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `Item ${i} changes the parser, so callers get stable output across every supported input format. It also keeps the old path working.`,
    );
  const flat = (n: number) => dense(n).map((t) => `- ${t}`);

  test.each<{ name: string; body: string; wallLists: number; nestedLists: number }>([
    { name: "7 dense flat items", body: flat(7).join("\n"), wallLists: 1, nestedLists: 0 },
    {
      name: "same items nested under 3 short parents",
      body: [
        "- Parser",
        ...dense(3).map((t) => `  - ${t}`),
        "- Output",
        ...dense(2).map((t) => `  - ${t}`),
        "- Docs",
        ...dense(2).map((t) => `  - ${t}`),
      ].join("\n"),
      wallLists: 0,
      nestedLists: 3,
    },
    {
      name: "6 short bullets",
      body: Array.from({ length: 6 }, () => "- one two three four").join("\n"),
      wallLists: 0,
      nestedLists: 0,
    },
    { name: "5 dense items", body: flat(5).join("\n"), wallLists: 1, nestedLists: 0 },
    { name: "4 dense items", body: flat(4).join("\n"), wallLists: 0, nestedLists: 0 },
    {
      name: "dense list in details",
      body: `Lead.\n\n<details>\n<summary>More</summary>\n\n${flat(7).join("\n")}\n\n</details>\n`,
      wallLists: 0,
      nestedLists: 0,
    },
  ])("$name", ({ body, wallLists, nestedLists }) => {
    expect(WALL_MIN_ITEMS).toBe(5);
    expect(measureStructure(body)).toMatchObject({ wallLists, nestedLists });
  });
});

describe("figures and tables", () => {
  const flowchart = `flowchart TD\n${Array.from({ length: 12 }, (_, i) => `  n${i} --> n${i + 1}`).join("\n")}`;

  test("counts mermaid fences and tables", () => {
    const body = `Lead.\n\n\`\`\`mermaid\n${flowchart}\n\`\`\`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`;
    expect(measureStructure(body)).toMatchObject({ mermaidFigures: 1, visibleTables: 1 });
  });

  test("a mermaid fence adds no hidden words", () => {
    const body = `Lead.\n\n\`\`\`mermaid\n${flowchart}\n\`\`\`\n`;
    expect(measureStructure(body)).toMatchObject({ hiddenWords: 0, mermaidFigures: 1 });
  });

  test("mermaid inside details is not a visible figure or hidden word", () => {
    const body = `Lead.\n\n<details>\n<summary>Flow</summary>\n\n\`\`\`mermaid\n${flowchart}\n\`\`\`\n\n</details>\n`;
    expect(measureStructure(body)).toMatchObject({ hiddenWords: 0, mermaidFigures: 0 });
  });
});
