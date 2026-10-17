import { describe, expect, it, test } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { HookInput } from "../../scripts/hook-input";
import {
  formatAskOutput,
  formatDenyOutput,
  isThrowawayAdd,
  isThrowawayRemove,
  processInput,
} from "./index";

function bashInput(command: string): HookInput {
  return {
    session_id: "test",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
}

describe("processInput", () => {
  it("denies git worktree add", () => {
    expect(processInput(bashInput("git worktree add ../path -b branch"))).toEqual(
      formatDenyOutput("add"),
    );
  });

  it("allows git worktree list", () => {
    expect(processInput(bashInput("git worktree list"))).toBeNull();
  });

  it("allows git worktree add under tmp/", () => {
    expect(processInput(bashInput("git worktree add tmp/verify"))).toBeNull();
  });

  it("allows git worktree add under ./tmp/ with a commit-ish", () => {
    expect(processInput(bashInput("git worktree add ./tmp/verify HEAD"))).toBeNull();
  });

  it("allows git worktree add --detach under tmp/", () => {
    expect(processInput(bashInput("git worktree add --detach tmp/verify"))).toBeNull();
  });

  it("allows git worktree add with a flag value before the tmp path", () => {
    expect(processInput(bashInput("git worktree add -b throwaway tmp/verify"))).toBeNull();
  });

  it("denies git worktree add outside tmp/", () => {
    expect(processInput(bashInput("git worktree add ../path -b branch"))).toEqual(
      formatDenyOutput("add"),
    );
  });

  it("denies git worktree add to a path with a tmp-lookalike segment", () => {
    expect(processInput(bashInput("git worktree add notmp/foo"))).toEqual(formatDenyOutput("add"));
    expect(processInput(bashInput("git worktree add tmpfoo/x"))).toEqual(formatDenyOutput("add"));
  });

  it("allows git worktree add under a nested tmp/ segment", () => {
    expect(processInput(bashInput("git worktree add a/tmp/foo"))).toBeNull();
  });

  it("allows git worktree add under an absolute /tmp/ path", () => {
    expect(processInput(bashInput("git worktree add /tmp/claude-baseline-check"))).toBeNull();
  });

  it("allows git worktree add under an absolute /private/tmp/ path", () => {
    expect(
      processInput(bashInput("git worktree add /private/tmp/claude-baseline-check")),
    ).toBeNull();
  });

  it("allows git worktree add under a repo-absolute tmp/ path", () => {
    expect(processInput(bashInput("git worktree add /Users/me/repo/tmp/verify"))).toBeNull();
  });

  it("allows git worktree add under an unexpanded $TMPDIR", () => {
    expect(processInput(bashInput("git worktree add $TMPDIR/verify"))).toBeNull();
    // oxlint-disable-next-line no-template-curly-in-string -- the unexpanded form is what this case asserts the hook accepts.
    expect(processInput(bashInput("git worktree add ${TMPDIR}/verify"))).toBeNull();
  });

  it("denies git worktree add under .worktrees/", () => {
    expect(processInput(bashInput("git worktree add .worktrees/foo"))).toEqual(
      formatDenyOutput("add"),
    );
  });

  it("allows git worktree remove under tmp/", () => {
    expect(processInput(bashInput("git worktree remove tmp/verify"))).toBeNull();
  });

  it("allows git worktree remove --force under tmp/", () => {
    expect(processInput(bashInput("git worktree remove --force tmp/verify"))).toBeNull();
  });

  it("allows git worktree remove of agent worktrees", () => {
    expect(processInput(bashInput("git worktree remove .worktrees/agent-x"))).toBeNull();
    expect(
      processInput(bashInput("git worktree remove /Users/me/repo/.worktrees/agent-x")),
    ).toBeNull();
  });

  it("denies git worktree remove", () => {
    expect(processInput(bashInput("git worktree remove ../path"))).toEqual(
      formatDenyOutput("remove"),
    );
  });

  it("allows git worktree prune and unlock", () => {
    expect(processInput(bashInput("git worktree prune"))).toBeNull();
    expect(processInput(bashInput("git worktree prune --verbose"))).toBeNull();
    expect(processInput(bashInput("git worktree unlock tmp/verify"))).toBeNull();
    expect(processInput(bashInput("git worktree unlock ../path"))).toBeNull();
  });

  it("asks for unknown git worktree subcommands", () => {
    expect(processInput(bashInput("git worktree lock ../path"))).toEqual(formatAskOutput());
    expect(processInput(bashInput("git worktree repair"))).toEqual(formatAskOutput());
  });

  it("ignores git worktree without a subcommand", () => {
    expect(processInput(bashInput("git worktree"))).toBeNull();
  });

  it("allows unrelated git commands", () => {
    expect(processInput(bashInput("git status"))).toBeNull();
    expect(processInput(bashInput("git commit -m 'fix'"))).toBeNull();
  });

  it("allows unrelated bash commands", () => {
    expect(processInput(bashInput("ls -la"))).toBeNull();
  });

  it("returns null when command is missing", () => {
    expect(processInput({ ...bashInput(""), tool_input: {} })).toBeNull();
  });
});

describe("quoted and heredoc content", () => {
  const brief = [
    `cat > "$TMPDIR/briefs/task.md" <<'BRIEF'`,
    "You are working in a git worktree of a fork of the upstream repo.",
    "BRIEF",
  ].join("\n");

  test.each<{ name: string; command: string; expected: SyncHookJSONOutput | null }>([
    {
      name: "exempts a quoted tmp/ target containing spaces",
      command: 'git worktree add -q "tmp/wt with space" keepme 2>&1',
      expected: null,
    },
    {
      name: "exempts a quoted $TMPDIR target containing spaces",
      command: 'git worktree remove "$TMPDIR/wt with space"',
      expected: null,
    },
    {
      name: "ignores git worktree prose in a heredoc body",
      command: brief,
      expected: null,
    },
    {
      name: "ignores git worktree prose in a single-quoted string",
      command: "echo 'we run git worktree add ../path through worktrunk'",
      expected: null,
    },
    {
      name: "ignores git worktree prose in a double-quoted string",
      command: 'echo "we run git worktree remove ../path through worktrunk"',
      expected: null,
    },
    {
      name: "denies a genuine add outside the exemptions",
      command: 'git worktree add ../path -b "my branch"',
      expected: formatDenyOutput("add"),
    },
    {
      name: "denies a genuine add that follows a heredoc",
      command: `${brief}\ngit worktree add ../path`,
      expected: formatDenyOutput("add"),
    },
    {
      name: "denies an add whose only exempt-looking target is in a heredoc body",
      command: `git worktree add ../path <<'NOTE'\ntmp/decoy\nNOTE`,
      expected: formatDenyOutput("add"),
    },
    {
      name: "asks for an unknown subcommand with quoted arguments",
      command: 'git worktree lock "../path with space" --reason "in use"',
      expected: formatAskOutput(),
    },
  ])("$name", ({ command, expected }) => {
    expect(processInput(bashInput(command))).toEqual(expected);
  });
});

describe("isThrowawayAdd", () => {
  it("matches a quoted tmp/ target containing spaces", () => {
    expect(isThrowawayAdd('git worktree add -q "tmp/wt with space" keepme 2>&1')).toBe(true);
  });

  it("matches a tmp/ target", () => {
    expect(isThrowawayAdd("git worktree add tmp/x")).toBe(true);
  });

  it("matches a ./tmp/ target", () => {
    expect(isThrowawayAdd("git worktree add ./tmp/x")).toBe(true);
  });

  it("matches an absolute /tmp/ target", () => {
    expect(isThrowawayAdd("git worktree add /tmp/claude-baseline-check")).toBe(true);
  });

  it("matches an absolute /private/tmp/ target", () => {
    expect(isThrowawayAdd("git worktree add /private/tmp/claude-baseline-check")).toBe(true);
  });

  it("matches a repo-absolute tmp/ target", () => {
    expect(isThrowawayAdd("git worktree add /Users/me/repo/tmp/verify")).toBe(true);
  });

  it("matches a tmp/ target nested below another directory", () => {
    expect(isThrowawayAdd("git worktree add a/tmp/x")).toBe(true);
  });

  it("matches an unexpanded $TMPDIR target", () => {
    expect(isThrowawayAdd("git worktree add $TMPDIR/x")).toBe(true);
    // oxlint-disable-next-line no-template-curly-in-string -- the unexpanded form is what this case asserts the matcher accepts.
    expect(isThrowawayAdd("git worktree add ${TMPDIR}/x")).toBe(true);
  });

  it("does not match a tmp-prefixed sibling directory", () => {
    expect(isThrowawayAdd("git worktree add tmpfoo/x")).toBe(false);
  });

  it("does not match a path that merely contains the substring tmp", () => {
    expect(isThrowawayAdd("git worktree add notmp/x")).toBe(false);
  });
});

describe("isThrowawayRemove", () => {
  it("matches a tmp/ target", () => {
    expect(isThrowawayRemove("git worktree remove tmp/x")).toBe(true);
  });

  it("matches a ./tmp/ target", () => {
    expect(isThrowawayRemove("git worktree remove ./tmp/x")).toBe(true);
  });

  it("matches an absolute /tmp/ target", () => {
    expect(isThrowawayRemove("git worktree remove /tmp/claude-baseline-check")).toBe(true);
  });

  it("matches an unexpanded $TMPDIR target", () => {
    expect(isThrowawayRemove("git worktree remove $TMPDIR/x")).toBe(true);
  });

  it("matches a relative .worktrees/ target", () => {
    expect(isThrowawayRemove("git worktree remove .worktrees/agent-x")).toBe(true);
  });

  it("matches an absolute .worktrees/ target", () => {
    expect(isThrowawayRemove("git worktree remove /Users/me/repo/.worktrees/agent-x")).toBe(true);
  });

  it("skips flags and matches a later tmp/ target", () => {
    expect(isThrowawayRemove("git worktree remove --force tmp/x")).toBe(true);
  });

  it("does not match a tmp-prefixed sibling directory", () => {
    expect(isThrowawayRemove("git worktree remove tmpfoo/x")).toBe(false);
  });

  it("does not match a worktrees dir outside the .worktrees/ segment", () => {
    expect(isThrowawayRemove("git worktree remove worktrees/x")).toBe(false);
  });

  it("does not match other subcommands", () => {
    expect(isThrowawayRemove("git worktree add tmp/x")).toBe(false);
  });
});
