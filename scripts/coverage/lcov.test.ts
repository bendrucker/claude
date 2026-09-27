import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  coveredLines,
  type FileCoverage,
  formatLcov,
  formatRanges,
  lineCoverage,
  merge,
  parseLcov,
  uncoveredLines,
} from "./lcov";

// A trailing `\r` is indistinguishable from a CRLF line ending.
const fileCoverage: gs.Generator<FileCoverage> = gs.record({
  file: gs.text({ minSize: 1, excludeCharacters: "\n" }).filter((f) => !f.endsWith("\r")),
  lineHits: gs.maps(gs.integers({ minValue: 1 }), gs.integers({ minValue: 0 })),
  functionsFound: gs.integers({ minValue: 0 }),
  functionsHit: gs.integers({ minValue: 0 }),
});

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

const SINGLE = `TN:
SF:src/a.ts
FNF:2
FNH:1
DA:1,5
DA:2,0
DA:3,0
DA:4,2
LF:4
LH:2
end_of_record
`;

const MULTI = `${SINGLE}TN:
SF:src/b.ts
FNF:1
FNH:1
DA:10,1
DA:11,1
LF:2
LH:2
end_of_record
`;

describe("parseLcov", () => {
  test("extracts file, line hits, and function totals", () => {
    const a = defined(parseLcov(SINGLE)[0]);
    expect(a).toMatchInlineSnapshot(`
      {
        "file": "src/a.ts",
        "functionsFound": 2,
        "functionsHit": 1,
        "lineHits": 
      Map {
          1 => 5,
          2 => 0,
          3 => 0,
          4 => 2,
        }
      ,
      }
    `);
  });

  test("parses multiple records", () => {
    const records = parseLcov(MULTI);
    expect(records.map((r) => r.file)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("ignores text outside records and blank lines", () => {
    expect(parseLcov("\n\nnot a record\n")).toEqual([]);
  });

  test.each<{ name: string; text: string; files: string[] }>([
    {
      name: "CRLF line endings",
      text: "SF:src/a.ts\r\nDA:1,1\r\nend_of_record\r\n",
      files: ["src/a.ts"],
    },
    {
      name: "a doubled carriage return",
      text: "SF:src/a.ts\r\r\nend_of_record\n",
      files: ["src/a.ts"],
    },
    {
      name: "a byte order mark",
      text: "﻿SF:src/a.ts\nend_of_record\n",
      files: ["src/a.ts"],
    },
    {
      name: "edge whitespace in the path",
      text: "SF: src/a.ts \nend_of_record\n",
      files: [" src/a.ts "],
    },
    {
      name: "padded directive lines",
      text: "  SF:src/a.ts\n DA:1,1 \n end_of_record \nSF:src/b.ts\nend_of_record\n",
      files: ["src/a.ts", "src/b.ts"],
    },
  ])("reads paths with $name", ({ text, files }) => {
    expect(parseLcov(text).map((r) => r.file)).toEqual(files);
  });

  test.each([
    ["covered", coveredLines, [1, 4]],
    ["uncovered", uncoveredLines, [2, 3]],
  ])("%s returns sorted line numbers", (_label, fn, expected) => {
    const a = defined(parseLcov(SINGLE)[0]);
    expect(fn(a)).toEqual(expected);
  });

  test("lineCoverage computes percentage", () => {
    const a = defined(parseLcov(SINGLE)[0]);
    expect(lineCoverage(a)).toEqual({ total: 4, covered: 2, pct: 50 });
  });
});

describe("merge", () => {
  test("unions line hits across scopes so either-covered counts as covered", () => {
    const scopeA = parseLcov(`TN:
SF:src/a.ts
DA:1,0
DA:2,1
end_of_record
`);
    const scopeB = parseLcov(`TN:
SF:src/a.ts
DA:1,3
DA:2,0
end_of_record
`);
    const merged = defined(merge(scopeA, scopeB)[0]);
    expect(uncoveredLines(merged)).toEqual([]);
    expect(coveredLines(merged)).toEqual([1, 2]);
  });

  test("keeps distinct files separate and takes max function totals", () => {
    const merged = merge(
      parseLcov(MULTI),
      parseLcov(`TN:
SF:src/a.ts
FNF:2
FNH:2
DA:2,1
DA:3,1
end_of_record
`),
    );
    expect(merged.map((r) => r.file).toSorted()).toEqual(["src/a.ts", "src/b.ts"]);
    const a = defined(merged.find((r) => r.file === "src/a.ts"));
    expect(a.functionsHit).toBe(2);
    expect(uncoveredLines(a)).toEqual([]);
  });
});

describe("formatLcov", () => {
  test.each<{ name: string; text: string }>([
    { name: "single record", text: SINGLE },
    { name: "multiple records", text: MULTI },
  ])("round-trips $name through the parser", ({ text }) => {
    const records = parseLcov(text);
    expect(parseLcov(formatLcov(records))).toEqual(records);
  });

  test("round-trips any records through the parser", () => {
    hegel.test((tc) => {
      const records = tc.draw(gs.arrays(fileCoverage));
      expect(parseLcov(formatLcov(records))).toEqual(records);
    });
  });

  test("emits empty string for no records", () => {
    expect(formatLcov([])).toBe("");
  });
});

describe("formatRanges", () => {
  test.each([
    [[], ""],
    [[5], "5"],
    [[1, 2, 3], "1-3"],
    [[1, 2, 3, 5, 8, 9], "1-3, 5, 8-9"],
    [[9, 1, 2], "1-2, 9"],
  ])("%j -> %p", (input, expected) => {
    expect(formatRanges(input)).toBe(expected);
  });
});
