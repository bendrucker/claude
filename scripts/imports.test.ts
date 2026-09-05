import { expect, test } from "bun:test";
import { isBuiltin, packageName, scanImports } from "./imports";

test.each<{ name: string; source: string; expected: string[] }>([
  { name: "value import", source: `import { z } from "zod";`, expected: ["zod"] },
  {
    name: "type-only import, which the transpiler would otherwise elide",
    source: `import type { A } from "zod";`,
    expected: ["zod"],
  },
  { name: "type-only re-export", source: `export type { A } from "zod";`, expected: ["zod"] },
  { name: "type-only star re-export", source: `export type * from "zod";`, expected: ["zod"] },
  {
    name: "local type alias is not an import and must still parse",
    source: `export type Source = "rss" | "blog";\nimport { z } from "zod";`,
    expected: ["zod"],
  },
  { name: "side-effect import", source: `import "zod";`, expected: ["zod"] },
  { name: "dynamic import", source: `const m = await import("zod");`, expected: ["zod"] },
  { name: "re-export", source: `export { z } from "zod";`, expected: ["zod"] },
  {
    name: "relative specifier is returned too",
    source: `import x from "./local";`,
    expected: ["./local"],
  },
  {
    name: "shebang does not break parsing",
    source: `#!/usr/bin/env bun\nimport { z } from "zod";`,
    expected: ["zod"],
  },
])("scanImports: $name", ({ source, expected }) => {
  expect(scanImports(source).toSorted()).toEqual(expected.toSorted());
});

test.each([
  { specifier: "node:path", expected: true },
  { specifier: "bun", expected: true },
  { specifier: "bun:test", expected: true },
  { specifier: "zod", expected: false },
  { specifier: "bunyan", expected: false },
])("isBuiltin: $specifier", ({ specifier, expected }) => {
  expect(isBuiltin(specifier)).toBe(expected);
});

test.each([
  { specifier: "zod", expected: "zod" },
  { specifier: "zod/v4", expected: "zod" },
  { specifier: "@types/bun", expected: "@types/bun" },
  { specifier: "@anthropic-ai/sdk/core", expected: "@anthropic-ai/sdk" },
  { specifier: "@scope", expected: "@scope" },
])("packageName: $specifier", ({ specifier, expected }) => {
  expect(packageName(specifier)).toBe(expected);
});
