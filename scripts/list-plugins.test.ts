import { expect, test } from "bun:test";
import { type Plugin, select } from "./list-plugins";

const plugins: Plugin[] = [
  { name: "writing", paths: [] },
  { name: "pull-request", paths: ["plugins/writing/linguistics/"] },
  { name: "review", paths: [] },
];

test.each<{ name: string; files: string[]; expected: string[] }>([
  {
    name: "no changed files runs every plugin",
    files: [],
    expected: ["writing", "pull-request", "review"],
  },
  {
    name: "a plugin's own files",
    files: ["plugins/review/skills/code/SKILL.md"],
    expected: ["review"],
  },
  {
    name: "a declared path selects the plugin that claims it",
    files: ["plugins/writing/linguistics/tags.ts"],
    expected: ["writing", "pull-request"],
  },
  {
    name: "a sibling path nobody claims",
    files: ["plugins/writing/skills/scan/SKILL.md"],
    expected: ["writing"],
  },
  { name: "a repo-root file", files: ["README.md"], expected: [] },
])("$name", ({ files, expected }) => {
  expect(select(plugins, files, [])).toEqual(expected);
});

test("an always path runs every plugin", () => {
  expect(select(plugins, ["scripts/list-plugins.ts"], ["scripts/list-plugins.ts"])).toEqual([
    "writing",
    "pull-request",
    "review",
  ]);
});
