import { expect, test } from "bun:test";
import {
  importedPackages,
  owningWorkspace,
  protectedWorkspaces,
  unlistedWorkspaces,
  workspaceDirs,
} from "./check-workspace-deps";

test.each<{ name: string; source: string; expected: string[] }>([
  { name: "bare package", source: `import { z } from "zod";`, expected: ["zod"] },
  {
    name: "type-only import counts, since it still has to resolve",
    source: `import type { A } from "zod";`,
    expected: ["zod"],
  },
  {
    name: "subpath resolves to the package",
    source: `import x from "unist-util-visit/lib/index.js";`,
    expected: ["unist-util-visit"],
  },
  {
    name: "scoped package keeps both segments",
    source: `import x from "@anthropic-ai/claude-agent-sdk";`,
    expected: ["@anthropic-ai/claude-agent-sdk"],
  },
  { name: "relative import", source: `import x from "./local";`, expected: [] },
  { name: "absolute path", source: `import x from "/etc/thing";`, expected: [] },
  { name: "node builtin", source: `import { join } from "node:path";`, expected: [] },
  { name: "bun test builtin", source: `import { test } from "bun:test";`, expected: [] },
])("importedPackages: $name", ({ source, expected }) => {
  expect([...importedPackages(source)].toSorted()).toEqual(expected.toSorted());
});

test.each<{ name: string; manifests: string[]; expected: string[] }>([
  {
    name: "a plugin and its eval harness each match their own pattern",
    manifests: ["plugins/issue/package.json", "plugins/issue/evals/refine/package.json"],
    expected: ["plugins/issue", "plugins/issue/evals/refine"],
  },
  {
    name: "a manifest below a skill matches no pattern",
    manifests: ["plugins/issue/skills/refine/package.json"],
    expected: [],
  },
  { name: "the root is not a member", manifests: ["package.json"], expected: [] },
  {
    name: "a file only ending in package.json is not a manifest",
    manifests: ["plugins/issue/dev-package.json"],
    expected: [],
  },
])("workspaceDirs: $name", ({ manifests, expected }) => {
  expect(workspaceDirs(["plugins/*", "plugins/*/evals/*"], manifests)).toEqual(expected);
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

test.each<{ name: string; manifests: string[]; expected: string[] }>([
  {
    name: "manifest in a declared workspace",
    manifests: ["plugins/issue/package.json"],
    expected: [],
  },
  { name: "root manifest", manifests: ["package.json"], expected: [] },
  {
    name: "manifest in a directory the root never lists",
    manifests: ["plugins/raycast/package.json"],
    expected: ["plugins/raycast"],
  },
])("unlistedWorkspaces: $name", ({ manifests, expected }) => {
  expect(unlistedWorkspaces(manifests, DIRS)).toEqual(expected);
});

test.each<{ name: string; dirs: string[]; expected: string[] }>([
  { name: "packages and plugins are writable", dirs: [".", "packages/agent-ideas"], expected: [] },
  {
    name: "a skill workspace is where bun install breaks",
    dirs: [".", ".claude/skills/agent-ideas"],
    expected: [".claude/skills/agent-ideas"],
  },
  { name: "the config root itself", dirs: [".", ".claude"], expected: [".claude"] },
  { name: "a sibling prefix is not the config dir", dirs: [".", ".claudex"], expected: [] },
])("protectedWorkspaces: $name", ({ dirs, expected }) => {
  expect(protectedWorkspaces(dirs)).toEqual(expected);
});
