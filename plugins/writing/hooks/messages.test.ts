import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { collectText, isProse, lintMessages, MCP_PROSE_GUARD, pathCandidates } from "./messages";
import { report } from "./report";

async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  return report(await lintMessages(input), { event: "PreToolUse" })?.output ?? null;
}

function denialOf(output: SyncHookJSONOutput | null): {
  decision: string | undefined;
  reason: string | undefined;
} {
  const specific = output?.hookSpecificOutput;
  if (specific?.hookEventName !== "PreToolUse") return { decision: undefined, reason: undefined };
  return { decision: specific.permissionDecision, reason: specific.permissionDecisionReason };
}

function mockBash(command: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
  };
}

function mockMcp(tool_name: string, tool_input: Record<string, unknown>): PreToolUseHookInput {
  return { ...mockBash(""), tool_name, tool_input };
}

describe("pathCandidates", () => {
  test.each([
    ["tmp/body.md", ["tmp/body.md"]],
    ["$TMPDIR/body.md", ["/tmp/body.md", "/tmp/claude-501/body.md"]],
    ["${TMPDIR}/body.md", ["/tmp/body.md", "/tmp/claude-501/body.md"]],
    ["$HOME/body.md", ["/home/me/body.md"]],
  ])("expands %s", (path, expected) => {
    expect(pathCandidates(path, { TMPDIR: "/tmp", HOME: "/home/me" }, 501)).toEqual(expected);
  });
});

describe("collectText", () => {
  describe("Bash commands", () => {
    let dir: string;
    let tmpFile: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "trope-test-"));
      tmpFile = join(dir, "body.md");
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("reads --body-file content", async () => {
      await Bun.write(tmpFile, "Body content here");
      const texts = await collectText(mockBash(`gh pr create --body-file ${tmpFile}`));
      expect(texts).toContain("Body content here");
    });

    it("reads --body-file= content", async () => {
      await Bun.write(tmpFile, "Body content");
      const texts = await collectText(mockBash(`gh pr create --body-file=${tmpFile}`));
      expect(texts).toContain("Body content");
    });

    it("expands a shell variable in the --body-file path", async () => {
      await Bun.write(tmpFile, "Expanded body");
      process.env.TROPE_TEST_DIR = dir;
      try {
        const texts = await collectText(
          mockBash('gh pr create --body-file "$TROPE_TEST_DIR/body.md"'),
        );
        expect(texts).toContain("Expanded body");
      } finally {
        delete process.env.TROPE_TEST_DIR;
      }
    });

    it("extracts inline --body", async () => {
      const texts = await collectText(mockBash('gh issue create --body "Issue description"'));
      expect(texts).toContain("Issue description");
    });

    it("extracts inline --title", async () => {
      const texts = await collectText(mockBash('gh issue create --title "My title"'));
      expect(texts).toContain("My title");
    });

    it("reads gh api -F body=@file content", async () => {
      await Bun.write(tmpFile, "Reply body");
      const texts = await collectText(
        mockBash(`gh api repos/x/issues/1/comments -F body=@${tmpFile}`),
      );
      expect(texts).toContain("Reply body");
    });

    it("reads glab api --field description=@file content", async () => {
      await Bun.write(tmpFile, "MR description");
      const texts = await collectText(
        mockBash(`glab api projects/x/merge_requests --field description=@${tmpFile}`),
      );
      expect(texts).toContain("MR description");
    });

    it("reads shell-quoted field file paths", async () => {
      await Bun.write(tmpFile, "Quoted body");
      const texts = await collectText(mockBash(`gh api repos/x/y/issues -F 'body=@${tmpFile}'`));
      expect(texts).toContain("Quoted body");
    });

    it("reads git commit -F message files", async () => {
      await Bun.write(tmpFile, "Commit message body");
      const texts = await collectText(mockBash(`git commit -F ${tmpFile}`));
      expect(texts).toContain("Commit message body");
    });

    it("reads git tag --file message files", async () => {
      await Bun.write(tmpFile, "Tag annotation");
      const texts = await collectText(mockBash(`git tag -a v1.0.0 --file ${tmpFile}`));
      expect(texts).toContain("Tag annotation");
    });

    it("ignores bare -F outside git commands", async () => {
      const texts = await collectText(mockBash("curl -F upload=/tmp/data.bin https://x"));
      expect(texts).toHaveLength(0);
    });

    it("ignores field flags with inline values", async () => {
      const texts = await collectText(mockBash("gh api repos/x -F state=closed"));
      expect(texts).toHaveLength(0);
    });

    it("ignores stdin field files", async () => {
      const texts = await collectText(mockBash("gh api repos/x -F body=@-"));
      expect(texts).toHaveLength(0);
    });

    it("returns empty for commands without text args", async () => {
      const texts = await collectText(mockBash("git status"));
      expect(texts).toHaveLength(0);
    });
  });
});

describe("Bash processInput", () => {
  it("denies Bash inline arg with spaced em dash", async () => {
    const result = await processInput(
      mockBash(
        'gh pr create --body "This feature \u2014 which was added last week \u2014 is broken"',
      ),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("permissionDecision", "deny");
  });

  it("flags Bash body-file with AI vocabulary as context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-test-"));
    const file = join(dir, "body.md");
    await Bun.write(file, "This is a tool, not a framework.");
    const result = await processInput(mockBash(`gh pr create --body-file ${file}`));
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    expect(result?.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it("does not deny Bash commands containing flagged tokens as literals", async () => {
    const result = await processInput(mockBash('gh pr create --title "Rename underscore field"'));
    if (result) {
      expect(result.hookSpecificOutput).not.toHaveProperty("permissionDecision");
    }
  });

  it("flags a review comment that opens with a greeting", async () => {
    const result = await processInput(
      mockBash(
        `glab mr note 871 --message "Hey Dana, this fires for the entire run rather than the changed files."`,
      ),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("flags a body-file comment that opens with a greeting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-test-"));
    const file = join(dir, "body.md");
    await Bun.write(file, "Hi Dana,\n\nThe retry loop swallows the error.\n");
    const result = await processInput(mockBash(`gh pr review --body-file ${file}`));
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("denies an MR body that negates the noun", async () => {
    const result = await processInput(
      mockBash(
        `glab mr create --description "The handler reads the cache, so the event costs no extra query."`,
      ),
    );
    const denial = denialOf(result);
    expect(denial.decision).toBe("deny");
    expect(denial.reason).toContain("Writing.NoNegation");
  });

  it("returns null for non-text Bash commands", async () => {
    expect(await processInput(mockBash("git push origin main"))).toBeNull();
  });
});

describe("MCP calls", () => {
  it("denies a GitHub PR body that negates the noun", async () => {
    const result = await processInput(
      mockMcp("mcp__github__create_pull_request", {
        owner: "o",
        repo: "r",
        title: "Cache the lookup",
        body: "The handler reads the cache, so the event costs no extra query.",
      }),
    );
    const denial = denialOf(result);
    expect(denial.decision).toBe("deny");
    expect(denial.reason).toContain("Writing.NoNegation");
  });

  it("denies a thread reply that negates the noun", async () => {
    const result = await processInput(
      mockMcp("mcp__hearthbot__post_message", { text: "The sweep ran, and I filed nothing." }),
    );
    expect(denialOf(result).decision).toBe("deny");
  });

  it("reads prose at any depth and under any field name", async () => {
    const texts = await collectText(
      mockMcp("mcp__any__tool", {
        question: "Ship the fix?",
        options: [{ label: "Ship", consequence: "The PR merges and adds no tests." }],
        recommended: 0,
      }),
    );
    expect(texts).toEqual(["The PR merges and adds no tests."]);
  });

  it("leaves a query that negates the noun alone", async () => {
    expect(
      await processInput(mockMcp("mcp__github__search_code", { query: "costs no extra" })),
    ).toBeNull();
  });
});

describe("isProse", () => {
  it.each([
    "The sweep ran overnight and found two stale entries.",
    "Done. The handler now reads the cache before it calls the API.",
    "| a | b |\n\nThe table above lists every run that timed out.",
    "The plugin comes out of the list under `enabledPlugins`.",
  ])("reads %p as prose", (text) => {
    expect(isProse(text)).toBe(true);
  });

  it.each([
    "SELECT id FROM runs WHERE state = 'done';",
    "negation hook latency",
    '{"type": "none", "value": "x"}',
    "/Users/ben/tmp/negation-escapes/cand.jsonl",
    "Run `bun test plugins/writing/hooks/messages.test.ts --timeout 15000`.",
  ])("reads %p as not prose", (text) => {
    expect(isProse(text)).toBe(false);
  });
});

describe("isProse properties", () => {
  const word = gs.text({ alphabet: "abcdefghijklmnopqrstuvwxyz", minSize: 1, maxSize: 12 });
  const capitalized = word.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const number = gs.integers({ minValue: 0, maxValue: 100_000 }).map(String);
  const terminator = gs.sampledFrom([".", "!", "?", ":"]);
  const separator = gs.sampledFrom([" ", "  ", "\t", " \t "]);
  const sentence = gs.composite((tc) => {
    const words = tc.draw(
      gs.arrays(gs.oneOf(word, word, word, number), { minSize: 3, maxSize: 30 }),
    );
    let text = tc.draw(capitalized);
    for (const w of words) text += tc.draw(separator) + w;
    return text + tc.draw(terminator);
  });
  const noise = gs.text({
    alphabet: "aZ09 _-./:;,'\"`*#>|()[]{}=<>!?$@~\t\n\\é’—",
    maxSize: 200,
  });

  test("a capitalized run of words ending in a terminator is prose", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      if (!isProse(text)) throw new Error(`not prose: ${JSON.stringify(text)}`);
    });
  });

  test("markdown list, quote, heading, and emphasis wrappers keep prose", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      const [open, close] = tc.draw(
        gs.sampledFrom([
          ["- ", ""],
          ["* ", ""],
          ["1. ", ""],
          ["> ", ""],
          ["## ", ""],
          ["**", "**"],
          ["_", "_"],
          ["(", ")"],
          ['"', '"'],
        ]),
      );
      const wrapped = open + text + close;
      if (!isProse(wrapped)) throw new Error(`not prose: ${JSON.stringify(wrapped)}`);
    });
  });

  test("a trailing code span before the terminator keeps prose", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      const code = tc.draw(gs.text({ alphabet: "abc-_./ ={}$", minSize: 1, maxSize: 40 }));
      const spanned = `${text.slice(0, -1)} \`${code}\`${text.slice(-1)}`;
      if (!isProse(spanned)) throw new Error(`not prose: ${JSON.stringify(spanned)}`);
    });
  });

  test("a line of anything else never hides a prose line", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      const other = tc.draw(noise);
      for (const joined of [`${text}\n${other}`, `${other}\n${text}`]) {
        if (!isProse(joined)) throw new Error(`not prose: ${JSON.stringify(joined)}`);
      }
    });
  });

  test("text without three separated tokens is never prose", () => {
    hegel.test((tc) => {
      const parts = tc.draw(
        gs.arrays(gs.text({ alphabet: "aZ09_-./:'\"*#()!?é’", maxSize: 40 }), { maxSize: 3 }),
      );
      const text = parts.join(tc.draw(separator));
      if (isProse(text)) throw new Error(`prose: ${JSON.stringify(text)}`);
    });
  });

  test("JSON, SQL, and shell commands are never prose", () => {
    hegel.test((tc) => {
      const ident = gs.fromRegex("[a-z_][a-z0-9_]{0,15}");
      const value = gs.oneOf(ident, number, gs.booleans().map(String));
      const text = tc.draw(
        gs.oneOf(
          gs
            .arrays(gs.tuples(ident, value), { maxSize: 8 })
            .map((kv) => JSON.stringify(Object.fromEntries(kv), null, 2)),
          gs
            .tuples(gs.arrays(ident, { minSize: 1, maxSize: 6 }), ident, ident, value)
            .map(
              ([cols, table, col, v]) =>
                `SELECT ${cols.join(", ")} FROM ${table} WHERE ${col} = '${v}' ORDER BY ${col} LIMIT 10;`,
            ),
          gs
            .tuples(ident, gs.arrays(gs.tuples(ident, value), { maxSize: 6 }))
            .map(
              ([cmd, flags]) =>
                `${cmd} ${flags.map(([f, v]) => `--${f}=${v}`).join(" ")} ./src/${cmd}.ts`,
            ),
        ),
      );
      if (isProse(text)) throw new Error(`prose: ${JSON.stringify(text)}`);
    });
  });

  test("the hooks.json grep matches every call that holds prose", () => {
    const guard = new RegExp(MCP_PROSE_GUARD);
    hegel.test(
      (tc) => {
        const parts = tc.draw(gs.arrays(gs.oneOf(sentence, noise), { minSize: 1, maxSize: 4 }));
        const text = parts.join(tc.draw(gs.sampledFrom(["", " ", "\n", "`"])));
        const stdin = JSON.stringify({ tool_name: "mcp__x__y", tool_input: { body: text } });
        if (isProse(text) && !guard.test(stdin)) throw new Error(`guard skips prose: ${stdin}`);
      },
      { testCases: 1000 },
    );
  });
});
