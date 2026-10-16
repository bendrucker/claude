import { describe, expect, test } from "bun:test";
import { extractComments } from "./comments";
import { semicolonSpliceHits } from "./tropes";

describe("extractComments", () => {
  test.each<{ name: string; path: string; src: string; expected: string }>([
    {
      name: "TypeScript line comment",
      path: "a.ts",
      src: "const x = 1; // warm the cache\ncode();",
      expected: "warm the cache",
    },
    {
      name: "TypeScript JSDoc without its gutter",
      path: "a.ts",
      src: "/**\n * Returns the parsed config.\n * Callers own validation.\n */\nfunction parse() {}",
      expected: "Returns the parsed config.\nCallers own validation.",
    },
    {
      name: "URL in a string",
      path: "a.ts",
      src: 'fetch("https://example.com/path");',
      expected: "",
    },
    {
      name: "Python hash comment and docstring",
      path: "a.py",
      src: '# read the config\ndef parse():\n    """Parse the config file."""\n    return 1',
      expected: "read the config\nParse the config file.",
    },
    {
      name: "shell hash comment",
      path: "run.sh",
      src: "# retry twice\nls",
      expected: "retry twice",
    },
    {
      name: "extensionless Dockerfile",
      path: "Dockerfile",
      src: "# pin the base\nFROM alpine",
      expected: "pin the base",
    },
    {
      name: "HTML comment",
      path: "page.html",
      src: "<div></div>\n<!-- rendered only on mobile -->",
      expected: "rendered only on mobile",
    },
    {
      name: "CSS comment, not hex colors or id selectors",
      path: "site.css",
      src: "/* dark palette */\n#nav { color: #12151b; }",
      expected: "dark palette",
    },
    {
      name: "HTML style block keeps CSS comments only",
      path: "page.html",
      src: "<style>\n/* dark palette */\n:root { --bg: #12151b; --fg: #e4e8ef; }\n</style>",
      expected: "dark palette",
    },
    {
      name: "HTML script block keeps JS comments",
      path: "page.html",
      src: '<script>\n// wait for fonts\nconst c = "#fff";\n</script>',
      expected: "wait for fonts",
    },
    {
      name: "line past the tokenizer limit",
      path: "a.js",
      src: `const a = "${"x".repeat(25_000)}";\n// keep going`,
      expected: "keep going",
    },
    { name: "unknown language", path: "data.unknownext", src: "# note", expected: "" },
    { name: "inherited object key", path: "notes.__proto__", src: "# note", expected: "" },
  ])("$name", async ({ path, src, expected }) => {
    expect(await extractComments(src, path)).toBe(expected);
  });
});

describe("comment splices", () => {
  test.each<{ name: string; path: string; src: string; count: number }>([
    {
      name: "splice in a // comment",
      path: "a.ts",
      src: "// keep sorted; callers rely on order\nconst x = 1;",
      count: 1,
    },
    {
      name: "splice in a # comment",
      path: "a.py",
      src: "# retries twice; the queue drops the job after that\nvalue = 1",
      count: 1,
    },
    {
      name: "commented-out code does not splice",
      path: "a.ts",
      src: "// foo(); bar()\nconst x = 1;",
      count: 0,
    },
    {
      name: "splice outside a comment is invisible",
      path: "a.ts",
      src: 'const label = "cold start; warm later";',
      count: 0,
    },
    {
      name: "fragment comment without a splice",
      path: "a.ts",
      src: "// keep sorted\nconst x = 1;",
      count: 0,
    },
  ])("$name", async ({ path, src, count }) => {
    expect(semicolonSpliceHits(await extractComments(src, path), 1).count).toBe(count);
  });
});
