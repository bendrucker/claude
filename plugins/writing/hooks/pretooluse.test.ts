import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@bendrucker/claude-plugin-toolkit";
import { dispatch } from "./pretooluse";

// Session-state files land in $TMPDIR. Redirect it so test runs do not litter
// the shared OS temp dir with per-UUID state files.
const originalTmpdir = process.env.TMPDIR;
let stateDir: string;

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "dispatch-state-"));
  process.env.TMPDIR = stateDir;
});

afterAll(async () => {
  if (originalTmpdir === undefined) {
    delete process.env.TMPDIR;
  } else {
    process.env.TMPDIR = originalTmpdir;
  }
  await rm(stateDir, { recursive: true, force: true });
});

function mockInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  overrides: Partial<PreToolUseHookInput> = {},
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: crypto.randomUUID(),
    transcript_path: "/tmp/test",
    cwd: "/Users/test/project",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "test",
    ...overrides,
  } as PreToolUseHookInput;
}

// Trips all three checkers at context tier: a numbered lowercase heading
// (numbering + headings) and a spaced em dash (tropes).
const MULTI_VIOLATION = "# 1. introduction\n\nThis — is bad\n";

function contextOf(output: unknown): string {
  return (output as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext;
}

describe("single output per tool call", () => {
  it("emits exactly one injection when multiple checkers hit", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: MULTI_VIOLATION }),
    );
    expect(output).not.toBeNull();
    expect(contextOf(output)).toContain("numbered sequences");
    const { ts, session_id, duration_ms, ...stable } = log;
    expect(typeof duration_ms).toBe("number");
    expect(stable).toMatchInlineSnapshot(`
      {
        "category": "numbering",
        "ext": "md",
        "outcome": "context",
        "tool": "Write",
      }
    `);
  });

  it("falls through to later checkers when earlier ones are silent", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: "This — is bad\n" }),
    );
    expect(contextOf(output)).toContain("em dash");
    expect(log.category).toBe("spaced em dash");
  });
});

describe("code files", () => {
  it("stays silent on a trope inside a string literal", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", {
        file_path: "src/args.ts",
        content: 'const msg = "All 8 tests pass";\n',
      }),
    );
    expect(output).toBeNull();
    expect(log.outcome).toBe("silent");
  });

  it("flags the same trope in a comment, quoting the match", async () => {
    const { output } = await dispatch(
      mockInput("Write", {
        file_path: "src/args.ts",
        content: "// All 8 tests pass\nconst x = 1;\n",
      }),
    );
    expect(contextOf(output)).toContain('"All 8 tests pass"');
  });

  it("scans block comments, not just single-line ones", async () => {
    const { output } = await dispatch(
      mockInput("Write", {
        file_path: "src/cache.ts",
        content: "/**\n * The cache — cold at first — warms up.\n */\nconst x = 1;\n",
      }),
    );
    expect(contextOf(output)).toContain("em dash");
  });
});

describe("session-scoped repeat suppression", () => {
  // Numbered heading only: title-cased so headings stays silent, no tropes.
  const NUMBERED_ONLY = "# 1. Introduction\n\nPlain prose here.\n";

  it("suppresses a repeat of the same category within the window", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: NUMBERED_ONLY },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    const first = await dispatch(input, now);
    expect(first.output).not.toBeNull();
    expect(first.log.outcome).toBe("context");

    const second = await dispatch(input, now + 60_000);
    expect(second.output).toBeNull();
    expect(second.log.outcome).toBe("silent");
    expect(second.log.suppressed).toBe(true);
    expect(second.log.category).toBe("numbering");
  });

  it("falls through to the next finding when the winner is suppressed", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: MULTI_VIOLATION },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    const first = await dispatch(input, now);
    expect(first.log.category).toBe("numbering");

    const second = await dispatch(input, now + 60_000);
    expect(second.output).not.toBeNull();
    expect(second.log.outcome).toBe("context");
    expect(second.log.category).toBe("title case heading");
  });

  it("fires again once the window has passed", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: NUMBERED_ONLY },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    await dispatch(input, now);
    const later = await dispatch(input, now + 6 * 60_000);
    expect(later.output).not.toBeNull();
    expect(later.log.category).toBe("numbering");
  });

  it("does not suppress across sessions", async () => {
    const content = { file_path: "docs/draft.md", content: NUMBERED_ONLY };
    const now = 1_000_000;

    await dispatch(mockInput("Write", content), now);
    const other = await dispatch(mockInput("Write", content), now + 60_000);
    expect(other.output).not.toBeNull();
  });

  it("never suppresses deny-tier decisions", async () => {
    const sessionId = crypto.randomUUID();
    const command = 'gh pr create --body "This feature — which broke — is fixed"';
    const input = mockInput("Bash", { command }, { session_id: sessionId });
    const now = 1_000_000;

    const first = await dispatch(input, now);
    const second = await dispatch(input, now + 1_000);
    expect(first.log.outcome).toBe("deny");
    expect(second.log.outcome).toBe("deny");
    expect(second.output).not.toBeNull();
  });

  it("never suppresses deny-origin fix-it reminders on file ops", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: "This — is bad\n" },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    const first = await dispatch(input, now);
    const second = await dispatch(input, now + 60_000);
    expect(contextOf(first.output)).toContain("follow-up Edit");
    expect(contextOf(second.output)).toContain("follow-up Edit");
    expect(second.log.outcome).toBe("context");
  });
});

describe("scratch paths", () => {
  test.each<{ name: string; filePath: string }>([
    { name: "repo tmp/", filePath: "tmp/notes.md" },
    { name: "system /tmp", filePath: "/tmp/pr-body.md" },
    { name: "job dir", filePath: `${process.env.HOME}/.claude/jobs/abc123/tmp/handoff.md` },
  ])("skips all checkers for $name", async ({ filePath }) => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: filePath, content: MULTI_VIOLATION }),
    );
    expect(output).toBeNull();
    expect(log.outcome).toBe("skipped-scratch");
  });

  it("still scans scratch content at the Bash egress surface", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-egress-"));
    const bodyFile = join(dir, "pr-body.md");
    await Bun.write(bodyFile, "We must delve into the issue");
    const { output, log } = await dispatch(
      mockInput("Bash", { command: `gh pr create --body-file ${bodyFile}` }),
    );
    await rm(dir, { recursive: true, force: true });
    expect(contextOf(output)).toContain("delve");
    expect(log.outcome).toBe("context");
  });

  it("scans gh api field-file egress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-egress-"));
    const replyFile = join(dir, "reply.md");
    await Bun.write(replyFile, "We must delve into the issue");
    const { output } = await dispatch(
      mockInput("Bash", { command: `gh api repos/x/issues/1/comments -F body=@${replyFile}` }),
    );
    await rm(dir, { recursive: true, force: true });
    expect(contextOf(output)).toContain("delve");
  });
});

describe("shared skips", () => {
  const violating = { file_path: "docs/draft.md", content: MULTI_VIOLATION };

  it("skips plan mode entirely", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", violating, { permission_mode: "plan" }),
    );
    expect(output).toBeNull();
    expect(log.outcome).toBe("silent");
  });

  it("skips plan files", async () => {
    const { output } = await dispatch(
      mockInput("Write", { ...violating, file_path: `${process.env.HOME}/.claude/plans/p.md` }),
    );
    expect(output).toBeNull();
  });

  it("skips memory files", async () => {
    const { output } = await dispatch(
      mockInput("Write", {
        ...violating,
        file_path: `${process.env.HOME}/.claude/projects/-Users-ben-test/memory/MEMORY.md`,
      }),
    );
    expect(output).toBeNull();
  });

  it("stays silent on clean prose", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: "# Cache Layer\n\nPlain.\n" }),
    );
    expect(output).toBeNull();
    expect(log.outcome).toBe("silent");
  });
});
