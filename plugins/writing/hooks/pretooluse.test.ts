import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { check as headingCheck } from "./headings";
import type { SyncHookJSONOutput } from "./io";
import { dispatch, targetOf } from "./pretooluse";

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
  };
}

// Trips all three checkers at context tier: a lowercase step heading
// (numbering + headings) and a spaced em dash (tropes).
const MULTI_VIOLATION = "# step 1: introduction\n\nThis — is bad\n";

function contextOf(output: SyncHookJSONOutput | null): string | undefined {
  const specific = output?.hookSpecificOutput;
  return specific?.hookEventName === "PreToolUse" ? specific.additionalContext : undefined;
}

describe("every finding in one output", () => {
  it("lists advisory findings inside a structural deny", async () => {
    const command = 'gh pr create --body "Hi team, this matches nothing. We must reach for it."';
    const { output, log } = await dispatch(mockInput("Bash", { command }));
    expect(log.outcome).toBe("deny");
    expect(log.emitted).toContain("Writing.NoNegation");
    expect(log.emitted).toContain("Writing.Salutation");
    const specific = output?.hookSpecificOutput;
    const reason =
      specific?.hookEventName === "PreToolUse" ? specific.permissionDecisionReason : undefined;
    expect(reason).toContain("reach");
  });

  it("reports each checker's findings in a single injection", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: MULTI_VIOLATION }),
    );
    expect(contextOf(output)).toContain("step or phase numbering");
    expect(contextOf(output)).toContain("title case");
    expect(contextOf(output)).toContain("em dash");
    const { ts, session_id, duration_ms, ...stable } = log;
    expect(typeof duration_ms).toBe("number");
    expect(stable).toMatchInlineSnapshot(`
      {
        "categories": [
          "numbering",
          "title case heading",
          "Writing.SpacedEmDash",
          "ai-tells.EmDashUsage",
        ],
        "category": "numbering",
        "emitted": [
          "numbering",
          "title case heading",
          "Writing.SpacedEmDash",
          "ai-tells.EmDashUsage",
        ],
        "ext": "md",
        "outcome": "context",
        "target": "4ece0350c8d2e88b",
        "tool": "Write",
      }
    `);
  });

  it.each<{ name: string; file_path: string; content: string; flagged: boolean }>([
    {
      name: "a shell string",
      file_path: "scripts/run.sh",
      content: 'echo "a — b"\n',
      flagged: false,
    },
    {
      name: "a shell comment",
      file_path: "scripts/run.sh",
      content: "# a — b\necho ok\n",
      flagged: true,
    },
    { name: "a YAML value", file_path: "conf/app.yaml", content: "title: a — b\n", flagged: false },
  ])("lints only the comments of $name", async ({ file_path, content, flagged }) => {
    const { log } = await dispatch(mockInput("Write", { file_path, content }));
    expect((log.categories ?? []).includes("Writing.SpacedEmDash")).toBe(flagged);
  });

  it("falls through to later checkers when earlier ones are silent", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: "This — is bad\n" }),
    );
    expect(contextOf(output)).toContain("em dash");
    expect(log.category).toBe("Writing.SpacedEmDash");
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
    expect(contextOf(output)).toContain("'All 8 tests pass'");
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
  // Step heading only: title-cased so headings stays silent, no tropes.
  const NUMBERED_ONLY = "# Step 1: Introduction\n\nPlain prose here.\n";

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

  it("mutes only the categories that fired recently", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: MULTI_VIOLATION },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    await dispatch(input, now);
    const second = await dispatch(input, now + 60_000);
    expect(second.log.outcome).toBe("context");
    expect(second.log.emitted).toEqual(["Writing.SpacedEmDash"]);
    expect(second.log.suppressed_categories).toEqual([
      "numbering",
      "title case heading",
      "ai-tells.EmDashUsage",
    ]);
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
    await Bun.write(bodyFile, "This is a tool, not a framework.");
    const { output, log } = await dispatch(
      mockInput("Bash", { command: `gh pr create --body-file ${bodyFile}` }),
    );
    await rm(dir, { recursive: true, force: true });
    expect(contextOf(output)).toContain("not a framework");
    expect(log.outcome).toBe("context");
  });

  it("scans gh api field-file egress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-egress-"));
    const replyFile = join(dir, "reply.md");
    await Bun.write(replyFile, "This is a tool, not a framework.");
    const { output } = await dispatch(
      mockInput("Bash", { command: `gh api repos/x/issues/1/comments -F body=@${replyFile}` }),
    );
    await rm(dir, { recursive: true, force: true });
    expect(contextOf(output)).toContain("not a framework");
  });
});

// The dispatcher loads the heading checker only for markdown, so its own
// extension test has to agree with the checker's for every extension the hook
// sees. Where they disagree the hook quietly stops reporting findings it used
// to report, and nothing else fails.
describe("heading checker gate", () => {
  // A lowercase heading over clean prose. Only the heading checker has a rule
  // for it, so the dispatcher's winning category names that checker exactly
  // when it ran.
  const HEADING_VIOLATION = "# the cache layer\n\nStores records in memory.\n";

  test.each(["md", "markdown", "mdx", "txt", "rst", "adoc", "ts", "go", "yml", "json", "vue"])(
    "agrees with headings.check on .%s",
    async (ext) => {
      const toolInput = { file_path: `docs/note.${ext}`, content: HEADING_VIOLATION };
      const direct = headingCheck(mockInput("Write", toolInput));
      const { log } = await dispatch(mockInput("Write", toolInput));
      expect(log.category ?? null).toBe(direct[0]?.category ?? null);
    },
  );
});

describe("accept-and-flag logging", () => {
  const clean = { file_path: "docs/draft.md", content: "# Cache Layer\n\nPlain.\n" };

  it("records every category the checkers found, not only the tier winner", async () => {
    const { log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: MULTI_VIOLATION }),
    );
    expect(log.categories?.length).toBeGreaterThan(1);
    expect(log.categories).toContain(log.category);
  });

  it("records an empty category list when the checkers found nothing", async () => {
    const { log } = await dispatch(mockInput("Write", clean));
    expect(log.categories).toEqual([]);
  });

  it("omits the category list on a run that returned before the checkers", async () => {
    const { log } = await dispatch(mockInput("Write", clean, { permission_mode: "plan" }));
    expect(log.categories).toBeUndefined();
  });

  it("hashes the file path so repeat writes correlate without the path", async () => {
    const { log } = await dispatch(mockInput("Write", clean));
    expect(log.target).toBe(targetOf("docs/draft.md"));
    expect(log.target).not.toContain("draft");
  });

  it("records no target for a tool that names no file", async () => {
    const { log } = await dispatch(mockInput("Bash", { command: "echo hi" }));
    expect(log.target).toBeUndefined();
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

describe("deferred dependencies", () => {
  // A fresh process, since this file's other imports already hold both packages.
  function loadedAfter(input: PreToolUseHookInput): string[] {
    const script = `
      const { dispatch } = await import(${JSON.stringify(join(import.meta.dir, "pretooluse.ts"))});
      await dispatch(${JSON.stringify(input)});
      console.log(JSON.stringify(Object.keys(require.cache)));
    `;
    const run = Bun.spawnSync([process.execPath, "-e", script], {
      env: { ...process.env, TMPDIR: stateDir },
    });
    if (run.exitCode !== 0) throw new Error(run.stderr.toString());
    const keys: unknown = JSON.parse(run.stdout.toString());
    if (!Array.isArray(keys)) throw new Error(run.stdout.toString());
    const loaded = keys.flatMap((key) =>
      typeof key === "string" && /node_modules\/(compromise\/|shiki\/dist\/index)/.test(key)
        ? [key.includes("compromise") ? "compromise" : "shiki"]
        : [],
    );
    return [...new Set(loaded)];
  }

  test.each([
    ["prose without an indefinite", "Write", { file_path: "docs/a.md", content: "Plain.\n" }, []],
    [
      "prose with an indefinite",
      "Write",
      { file_path: "docs/a.md", content: "It adds nothing.\n" },
      [],
    ],
    ["a code edit", "Edit", { file_path: "src/a.ts", old_string: "1", new_string: "2" }, ["shiki"]],
  ])("%s", (_name, tool, toolInput, expected) => {
    expect(loadedAfter(mockInput(tool, toolInput))).toEqual(expected);
  });
});
