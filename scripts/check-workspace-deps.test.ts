import { expect, test } from "bun:test";
import { importedPackages, owningWorkspace, packageName } from "./check-workspace-deps";

test.each<{ name: string; source: string; expected: string[] }>([
  { name: "value import", source: `import { z } from "zod";`, expected: ["zod"] },
  {
    name: "type-only import, which the transpiler would otherwise elide",
    source: `import type { A } from "zod";`,
    expected: ["zod"],
  },
  {
    name: "type-only re-export",
    source: `export type { A } from "zod";`,
    expected: ["zod"],
  },
  {
    name: "local type alias is not an import and must still parse",
    source: `export type Source = "rss" | "blog";\nimport { z } from "zod";`,
    expected: ["zod"],
  },
  { name: "side-effect import", source: `import "zod";`, expected: ["zod"] },
  { name: "dynamic import", source: `const m = await import("zod");`, expected: ["zod"] },
  { name: "re-export", source: `export { z } from "zod";`, expected: ["zod"] },
  {
    name: "scoped package keeps both segments",
    source: `import x from "@anthropic-ai/claude-agent-sdk";`,
    expected: ["@anthropic-ai/claude-agent-sdk"],
  },
  {
    name: "subpath resolves to the package",
    source: `import x from "unist-util-visit/lib/index.js";`,
    expected: ["unist-util-visit"],
  },
  { name: "relative import", source: `import x from "./local";`, expected: [] },
  { name: "node builtin", source: `import { join } from "node:path";`, expected: [] },
  { name: "bun builtin", source: `import { $ } from "bun";`, expected: [] },
  { name: "bun test builtin", source: `import { test } from "bun:test";`, expected: [] },
  {
    name: "shebang does not break parsing",
    source: `#!/usr/bin/env bun\nimport { z } from "zod";`,
    expected: ["zod"],
  },
])("importedPackages: $name", ({ source, expected }) => {
  expect([...importedPackages(source)].toSorted()).toEqual(expected.toSorted());
});

test.each([
  { specifier: "zod", expected: "zod" },
  { specifier: "zod/v4", expected: "zod" },
  { specifier: "@types/bun", expected: "@types/bun" },
  { specifier: "@anthropic-ai/sdk/core", expected: "@anthropic-ai/sdk" },
])("packageName: $specifier", ({ specifier, expected }) => {
  expect(packageName(specifier)).toBe(expected);
});

const DIRS = [".", "plugins/pull-request", "plugins/pull-request/evals/pr-body", "plugins/issue"];

test.each([
  {
    name: "innermost workspace wins over its parent",
    file: "plugins/pull-request/evals/pr-body/scripts/mine.ts",
    expected: "plugins/pull-request/evals/pr-body",
  },
  {
    name: "parent workspace owns files outside the nested one",
    file: "plugins/pull-request/scripts/prose.ts",
    expected: "plugins/pull-request",
  },
  { name: "root owns repo scripts", file: "scripts/check.ts", expected: "." },
  {
    name: "prefix that is not a path segment does not match",
    file: "plugins/issue-tracker/scripts/x.ts",
    expected: ".",
  },
])("owningWorkspace: $name", ({ file, expected }) => {
  expect(owningWorkspace(file, DIRS)).toBe(expected);
});
