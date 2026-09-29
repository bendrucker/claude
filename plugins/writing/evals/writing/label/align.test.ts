import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { sharedRuns, sourceOffsets, toRendered, toSource } from "./align";

describe("sourceOffsets", () => {
  test.each<{ name: string; source: string; rendered: string }>([
    {
      name: "emphasis and inline code",
      source: "Adds **bold** and `code` here.",
      rendered: "Adds bold and code here.",
    },
    {
      name: "link destination sharing letters with the next word",
      source: "See [the docs](https://docs.example.com/a/b) about this.",
      rendered: "See the docs about this.",
    },
    {
      name: "heading, list, and fence info",
      source: "## Summary\n\n- first item\n- second item\n\n```ts\nconst x = 1;\n```\n",
      rendered: "Summary\nfirst item\nsecond item\nconst x = 1;\n",
    },
    {
      name: "reference definition",
      source: "Read [the guide][g] first.\n\n[g]: https://guide.example.com\n",
      rendered: "Read the guide first.\n",
    },
  ])("every rendered word maps back to itself: $name", ({ source, rendered }) => {
    const map = sourceOffsets(rendered, source);
    for (const m of rendered.matchAll(/\S+/g)) {
      const [start, end] = toSource(map, m.index, m.index + m[0].length);
      expect(source.slice(start, end)).toBe(m[0]);
    }
  });

  test("a source span round-trips through its rendered range", () => {
    const source = "Uses **go install** to fetch [the tool](https://x.io/tool).";
    const rendered = "Uses go install to fetch the tool.";
    const map = sourceOffsets(rendered, source);
    const start = source.indexOf("install");
    const range = toRendered(map, start, start + "install to fetch".length + 2);
    expect(range && rendered.slice(...range)).toBe("install to fetch");
  });
});

describe("sharedRuns", () => {
  test("keeps phrases of three or more words and drops scattered common words", () => {
    const a = "This change pins the tool version. It also adds a test.";
    const b = "Pins the tool version, and the test covers it.";
    const runs = sharedRuns(a, b);
    expect(runs.a.map(([s, e]) => a.slice(s, e))).toEqual(["pins the tool version."]);
    expect(runs.b.map(([s, e]) => b.slice(s, e))).toEqual(["Pins the tool version,"]);
  });

  test("shared ranges hold the same words on both sides", () => {
    hegel.test((tc) => {
      const word = gs.sampledFrom(["alpha", "beta", "gamma", "delta", "the", "a"]);
      const a = tc.draw(gs.arrays(word, { maxSize: 30 })).join(" ");
      const b = tc.draw(gs.arrays(word, { maxSize: 30 })).join(" ");
      const runs = sharedRuns(a, b);
      expect(runs.a.length).toBe(runs.b.length);
      for (const [i, [s, e]] of runs.a.entries()) {
        const [bs, be] = runs.b[i] ?? [0, 0];
        expect(a.slice(s, e).toLowerCase()).toBe(b.slice(bs, be).toLowerCase());
      }
    });
  });
});
