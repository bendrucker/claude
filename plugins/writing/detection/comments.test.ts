import { describe, expect, it, test } from "bun:test";
import { extractComments } from "./comments";
import { semicolonSpliceHits } from "./tropes";

describe("extractComments", () => {
  it("pulls single-line // and # comments and drops the markers", () => {
    const src = ["const x = 1; // warm the cache", "# read the config", "code()"].join("\n");
    const comments = extractComments(src);
    expect(comments).toContain("warm the cache");
    expect(comments).toContain("read the config");
    expect(comments).not.toContain("code()");
  });

  it("does not treat URLs as comments", () => {
    expect(extractComments('fetch("https://example.com/path")')).toBe("");
  });

  it("pulls block comments including JSDoc gutters", () => {
    const src =
      "/**\n * Returns the parsed config.\n * Callers own validation.\n */\nfunction parse() {}";
    const comments = extractComments(src);
    expect(comments).toContain("Returns the parsed config.");
    expect(comments).toContain("Callers own validation.");
    expect(comments).not.toContain("function parse");
    expect(comments).not.toContain("*");
  });

  it("pulls HTML comments", () => {
    const comments = extractComments("<div></div>\n<!-- rendered only on mobile -->");
    expect(comments).toBe("rendered only on mobile");
  });

  it("pulls triple-quoted Python docstrings", () => {
    const src = 'def parse():\n    """Parse the config file."""\n    return 1';
    expect(extractComments(src)).toContain("Parse the config file.");
  });
});

describe("comment splices", () => {
  test.each<{ name: string; src: string; count: number }>([
    {
      name: "splice in a // comment",
      src: "// keep sorted; callers rely on order\nconst x = 1;",
      count: 1,
    },
    {
      name: "splice in a # comment",
      src: "# retries twice; the queue drops the job after that\nvalue = 1",
      count: 1,
    },
    {
      name: "commented-out code does not splice",
      src: "// foo(); bar()\nconst x = 1;",
      count: 0,
    },
    {
      name: "splice outside a comment is invisible",
      src: 'const label = "cold start; warm later";',
      count: 0,
    },
    {
      name: "fragment comment without a splice",
      src: "// keep sorted\nconst x = 1;",
      count: 0,
    },
  ])("$name", ({ src, count }) => {
    expect(semicolonSpliceHits(extractComments(src), 1).count).toBe(count);
  });
});
