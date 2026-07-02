import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  extractBacktickedHexCandidates,
  extractBodyFilePath,
  findBacktickedCommits,
  hasBacktickedRef,
  hasFileTourBullets,
  hasReflexiveScaffold,
  processInput,
  validateBody,
} from "./validate-body";

function getPermissionDecision(result: Awaited<ReturnType<typeof validateBody>>) {
  const output = result?.hookSpecificOutput;
  if (output && "permissionDecision" in output) {
    return output.permissionDecision;
  }
  return undefined;
}

function getAdditionalContext(result: Awaited<ReturnType<typeof validateBody>>) {
  const output = result?.hookSpecificOutput;
  if (output && "additionalContext" in output) {
    return output.additionalContext;
  }
  return undefined;
}

const LONG_PROSE = Array(40)
  .fill(
    "The cache reduces round-trips to the database by storing frequently accessed records in memory with a configurable TTL.",
  )
  .join(" ");

describe("extractBodyFilePath", () => {
  it("returns null when command has no --body-file", () => {
    expect(extractBodyFilePath("gh pr create --title 'Test'")).toBeNull();
  });

  it("extracts path with space separator", () => {
    expect(extractBodyFilePath("gh pr create --body-file /tmp/body.md")).toBe("/tmp/body.md");
  });

  it("extracts path with equals separator", () => {
    expect(extractBodyFilePath("gh pr create --body-file=/tmp/body.md")).toBe("/tmp/body.md");
  });

  it("handles path with spaces in quotes", () => {
    expect(extractBodyFilePath('gh pr create --body-file "/tmp/my file.md"')).toBe('"/tmp/my');
  });

  it("extracts path when --body-file is not at end", () => {
    expect(extractBodyFilePath("gh pr create --body-file /tmp/body.md --draft")).toBe(
      "/tmp/body.md",
    );
  });
});

describe("validateBody", () => {
  it("returns null for valid body without test counts", () => {
    expect(
      validateBody("## Summary\nFixes a bug\n\n## Test plan\nUnit tests cover the fix"),
    ).toBeNull();
  });

  it("denies body with 'Added N tests' pattern", () => {
    const result = validateBody("## Test plan\nAdded 5 tests for the new feature");
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("denies body with 'Added N unit tests' pattern", () => {
    const result = validateBody("## Test plan\nAdded 3 unit tests");
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("denies body with 'Added N integration tests' pattern", () => {
    const result = validateBody("## Test plan\nAdded 2 integration tests");
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("denies body with 'N tests' pattern", () => {
    const result = validateBody("## Test plan\n5 tests verify the behavior");
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("denies body with lowercase 'added' pattern", () => {
    const result = validateBody("## Test plan\nadded 10 tests");
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("warns (does not deny) on a reflexive scaffold in a small body", () => {
    const result = validateBody(
      "## Changes\n\n- Adds a flag\n\n## Testing\n\nRan the suite.\n\nFixes #1",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("scaffold");
  });

  it("warns on file-tour bullets", () => {
    const result = validateBody(
      "## Changes\n\n- **src/cache.ts**: adds an LRU cache\n- **src/index.ts**: wires it up",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("file tour");
  });

  it("combines both structural warnings into one message", () => {
    const result = validateBody(
      "## Changes\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nManual.",
    );
    expect(getPermissionDecision(result)).toBeUndefined();
    const context = getAdditionalContext(result);
    expect(context).toContain("scaffold");
    expect(context).toContain("file tour");
  });

  it("lets a test-count deny take precedence over structural warnings", () => {
    const result = validateBody(
      "## Changes\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nAdded 5 tests",
    );
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("does not warn on a large PR with earned sections", () => {
    const body = `${LONG_PROSE}\n\n## Changes\n\n- Adds the LRU cache\n\n## Testing\n\nManual exercise of expiry and eviction.`;
    expect(validateBody(body)).toBeNull();
  });

  it("does not warn on concept-labeled bold bullets", () => {
    const result = validateBody(
      "## Changes\n\n- **Caching**: stores records in memory\n- **Eviction**: drops the oldest entry",
    );
    expect(result).toBeNull();
  });
});

describe("hasReflexiveScaffold", () => {
  it("flags a small body with both Changes and Testing headings", () => {
    expect(hasReflexiveScaffold("## Changes\n\n- x\n\n## Testing\n\ny")).toBe(true);
  });

  it("does not flag when only one heading is present", () => {
    expect(hasReflexiveScaffold("## Changes\n\n- x")).toBe(false);
  });

  it("does not flag a body at or over the word limit", () => {
    const body = `${LONG_PROSE}\n\n## Changes\n\n- x\n\n## Testing\n\ny`;
    expect(hasReflexiveScaffold(body)).toBe(false);
  });
});

describe("hasFileTourBullets", () => {
  it("flags a bold label with a path separator", () => {
    expect(hasFileTourBullets("- **src/cache.ts**: adds a cache")).toBe(true);
  });

  it("flags a bold label that ends in a file extension", () => {
    expect(hasFileTourBullets("* **cache.ts**: adds a cache")).toBe(true);
  });

  it("flags a bold label wrapped in backticks denoting a path", () => {
    expect(hasFileTourBullets("- **`lib/foo.ts`**: refactors it")).toBe(true);
  });

  it("does not flag a plain concept label", () => {
    expect(hasFileTourBullets("- **Caching**: stores records in memory")).toBe(false);
  });

  it("does not flag a multi-word concept label", () => {
    expect(hasFileTourBullets("- **Retry logic**: backs off exponentially")).toBe(false);
  });
});

describe("extractBacktickedHexCandidates", () => {
  it("pulls a backticked short SHA", () => {
    expect(extractBacktickedHexCandidates("a `2554da15` b")).toEqual(["2554da15"]);
  });

  it("returns a backticked 40-char SHA", () => {
    const sha = "2554da150000000000000000000000000000abcd";
    expect(extractBacktickedHexCandidates(`Builds on \`${sha}\`.`)).toEqual([sha]);
  });

  it("ignores a bare (unbackticked) hex run", () => {
    expect(extractBacktickedHexCandidates("commit 2554da15 landed")).toEqual([]);
  });

  it("ignores a backticked non-hex identifier", () => {
    expect(extractBacktickedHexCandidates("calls `getUser` then")).toEqual([]);
  });

  it("ignores a backticked file path", () => {
    expect(extractBacktickedHexCandidates("see `src/cache.ts`")).toEqual([]);
  });
});

describe("findBacktickedCommits", () => {
  const known = new Set(["2554da15", "dc8acf12"]);
  const fakeVerifier = (sha: string) => Promise.resolve(known.has(sha));

  it("returns candidates the verifier confirms", async () => {
    const candidates = extractBacktickedHexCandidates("Builds on `2554da15`.");
    expect(await findBacktickedCommits(candidates, fakeVerifier)).toEqual(["2554da15"]);
  });

  it("drops a hex candidate the verifier rejects", async () => {
    const candidates = extractBacktickedHexCandidates("random `deadbeef` hash");
    expect(await findBacktickedCommits(candidates, fakeVerifier)).toEqual([]);
  });
});

describe("hasBacktickedRef", () => {
  it("flags a backticked issue/PR ref", () => {
    expect(hasBacktickedRef("Closes `#123`")).toBe(true);
  });

  it("flags a backticked GitLab MR ref", () => {
    expect(hasBacktickedRef("See `!45`")).toBe(true);
  });

  it("flags a backticked cross-repo ref", () => {
    expect(hasBacktickedRef("Relates to `owner/repo#12`")).toBe(true);
  });

  it("does not flag a bare ref", () => {
    expect(hasBacktickedRef("Closes #123")).toBe(false);
  });

  it("does not flag a backticked mention", () => {
    expect(hasBacktickedRef("thanks `@user`")).toBe(false);
  });

  it("does not flag a backticked CSS id", () => {
    expect(hasBacktickedRef("the `#main` selector")).toBe(false);
  });
});

describe("processInput", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const repoRoot = path.join(import.meta.dir, "..", "..", "..");
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" })
    .stdout.trim()
    .slice(0, 12);

  function createInput(command: string, cwd?: string): PreToolUseHookInput {
    return {
      tool_name: "Bash",
      tool_input: { command },
      ...(cwd ? { cwd } : {}),
    } as PreToolUseHookInput;
  }

  it("returns null when command has no --body-file", async () => {
    const result = await processInput(createInput("gh pr create --title 'Test'"));
    expect(result).toBeNull();
  });

  it("returns null when tool_input has no command", async () => {
    const result = await processInput({
      tool_name: "Bash",
      tool_input: {},
    } as PreToolUseHookInput);
    expect(result).toBeNull();
  });

  it("returns null when body file does not exist", async () => {
    const result = await processInput(createInput("gh pr create --body-file /nonexistent.md"));
    expect(result).toBeNull();
  });

  it("returns null for valid body", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Summary\nFixes a bug");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).toBeNull();
  });

  it("denies body with test count", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Test plan\nAdded 5 tests");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("warns on a backticked real commit SHA", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("auto-link");
  });

  it("does not warn on a bare commit SHA", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on ${headSha}.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(result).toBeNull();
  });

  it("lets a test-count deny precede a backticked SHA warning", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`.\n\nAdded 5 tests`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
  });
});
