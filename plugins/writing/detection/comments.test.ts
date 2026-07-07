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
