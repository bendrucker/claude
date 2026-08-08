import { expect, test } from "bun:test";
import {
  load,
  PROJECT_SETTINGS,
  paths,
  references,
  shipped,
  USER_SETTINGS,
  violations,
} from "./check-hook-paths";

test.each<{ name: string; command: string; expected: string[] }>([
  {
    name: "interpreter argument",
    command: "bun ~/.claude/hooks/worktree",
    expected: ["user/hooks/worktree"],
  },
  {
    name: "quoted $HOME with trailing arguments",
    command: 'bash "$HOME/.claude/hooks/herdr-agent-state.sh" session',
    expected: ["user/hooks/herdr-agent-state.sh"],
  },
  {
    name: "braced HOME",
    command: `\${HOME}/.claude/scripts/statusline.ts`,
    expected: ["user/scripts/statusline.ts"],
  },
  {
    name: "nested in sh -c",
    command: `/bin/sh -c '[ -x "$HOME/.claude/hooks/thing" ] && "$HOME/.claude/hooks/thing"; exit 0'`,
    expected: ["user/hooks/thing", "user/hooks/thing"],
  },
  {
    name: "plugin cache is installed elsewhere",
    command: "bun ~/.claude/plugins/cache/bendrucker/mac/scripts/sandbox.ts",
    expected: [],
  },
  {
    name: "machine-local binary",
    command: "'/opt/homebrew/bin/moshi-hook' claude-hook",
    expected: [],
  },
  {
    name: "guarded path outside the config dir",
    command: `/bin/sh -c '[ -x "$HOME/.vibe-island/bin/bridge" ] && "$HOME/.vibe-island/bin/bridge"; exit 0'`,
    expected: [],
  },
  { name: "no path at all", command: "bash -c 'jq -er .worktree_path'", expected: [] },
])("$name", ({ command, expected }) => {
  expect(paths(command, USER_SETTINGS.prefixes)).toEqual(expected);
});

test.each<{ name: string; command: string; expected: string[] }>([
  {
    name: "project dir resolves to the repo root",
    command: 'bun "$CLAUDE_PROJECT_DIR/.claude/hooks/biome"',
    expected: [".claude/hooks/biome"],
  },
  {
    name: "an assigned path is data, not the command",
    command: 'PREK_HOME="$CLAUDE_PROJECT_DIR/.prek" bun "$CLAUDE_PROJECT_DIR/.claude/hooks/stop"',
    expected: [".claude/hooks/stop"],
  },
])("$name", ({ command, expected }) => {
  expect(paths(command, PROJECT_SETTINGS.prefixes)).toEqual(expected);
});

test("project dir does not resolve in user settings", () => {
  expect(
    paths('bun "$CLAUDE_PROJECT_DIR/.claude/hooks/biome"', USER_SETTINGS.prefixes),
  ).toBeEmpty();
});

const settings = {
  hooks: {
    SessionStart: [{ hooks: [{ command: "bun ~/.claude/hooks/present" }] }],
    Stop: [
      { hooks: [{ command: "bun ~/.claude/hooks/gone" }, { type: "command" }] },
      { matcher: "*" },
    ],
  },
};

test("every event contributes its commands", () => {
  expect(references(settings, USER_SETTINGS)).toMatchInlineSnapshot(`
    [
      {
        "command": "bun ~/.claude/hooks/present",
        "event": "SessionStart",
        "file": "user/settings.json",
        "path": "user/hooks/present",
      },
      {
        "command": "bun ~/.claude/hooks/gone",
        "event": "Stop",
        "file": "user/settings.json",
        "path": "user/hooks/gone",
      },
    ]
  `);
});

test("an untracked path is a violation", () => {
  const tracked = new Set([
    "user/hooks/present/index.ts",
    "user/hooks/present",
    "user/hooks",
    "user",
  ]);
  expect(violations(references(settings, USER_SETTINGS), tracked)).toEqual([
    "user/settings.json Stop: user/hooks/gone",
  ]);
});

test("every hook command in this repo resolves", async () => {
  const [refs, files] = await Promise.all([load(), shipped()]);
  expect(refs).not.toBeEmpty();
  expect(violations(refs, files)).toBeEmpty();
});
