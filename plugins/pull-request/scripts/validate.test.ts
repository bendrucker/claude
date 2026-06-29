import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { PreToolUseHookInput } from "@bendrucker/claude-plugin-toolkit";
import {
  extractBacktickedHexCandidates,
  extractBodyFilePath,
  findBacktickedCommits,
  hasBacktickedRef,
  hasCiStatusRollCall,
  hasFileTourBullets,
  hasReflexiveScaffold,
  hasRunOnProse,
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

// Long enough to clear SMALL_BODY_WORD_LIMIT, but shaped as short paragraphs so
// it doesn't itself trip the run-on detector when a test needs a large body.
const LONG_PROSE = Array(6)
  .fill(
    "The cache stores frequently accessed records in memory. It evicts the oldest entry when full. A configurable TTL bounds staleness. Reads fall back to the database on a miss.",
  )
  .join("\n\n");

describe("extractBodyFilePath", () => {
  test.each<[string, string | null]>([
    ["gh pr create --title 'Test'", null],
    ["gh pr create --body-file /tmp/body.md", "/tmp/body.md"],
    ["gh pr create --body-file=/tmp/body.md", "/tmp/body.md"],
    ['gh pr create --body-file "/tmp/my file.md"', '"/tmp/my'],
    ["gh pr create --body-file /tmp/body.md --draft", "/tmp/body.md"],
  ])("extractBodyFilePath(%p) -> %p", (command, expected) => {
    expect(extractBodyFilePath(command)).toBe(expected);
  });
});

describe("validateBody", () => {
  it("returns null for valid body without test counts", () => {
    expect(
      validateBody("## Summary\nFixes a bug\n\n## Test plan\nUnit tests cover the fix"),
    ).toBeNull();
  });

  test.each<[string, string]>([
    ["'Added N tests' pattern", "## Test plan\nAdded 5 tests for the new feature"],
    ["'Added N unit tests' pattern", "## Test plan\nAdded 3 unit tests"],
    ["'Added N integration tests' pattern", "## Test plan\nAdded 2 integration tests"],
    ["'N tests' pattern", "## Test plan\n5 tests verify the behavior"],
    ["lowercase 'added' pattern", "## Test plan\nadded 10 tests"],
    ["assertion count", "## Testing\nThe suite runs 1165 assertions."],
    ["pass/fail count", "## Testing\n`bun test`: 193 pass, 0 fail."],
  ])("denies body with %s", (_name, body) => {
    const result = validateBody(body);
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("warns on a CI-status roll-call", () => {
    const result = validateBody(
      "Adds an LRU cache to the resolver.\n\nLint passes and the build is green.\n\nFixes #1",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("status checks");
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

  it("warns on a run-on prose paragraph", () => {
    const result = validateBody(
      "Reshapes the resolver. It reads the cache first. It falls back to the database. It then tries the network. It retries once before giving up.\n\nFixes #1",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("runs long");
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

describe("hasCiStatusRollCall", () => {
  test.each<[string, string]>([
    ["all green", "Everything is all green."],
    ["zero errors/warnings", "skill-lint: 0 errors, 0 warnings"],
    ["lint passes", "Lint passes on all six skills."],
    ["build green", "The build is green."],
    ["tests pass", "The unit tests pass."],
    ["types clean", "Types clean after the change."],
  ])("flags %s", (_name, body) => {
    expect(hasCiStatusRollCall(body)).toBe(true);
  });

  test.each<[string, string]>([
    ["pass as a verb", "The existing section tests already pass VARCHAR literals."],
    ["callers passing an argument", "All four sites now pass `env.KV`."],
    ["falsification with fail", "Reverting the fix makes `TestX` fail with exit 2."],
    ["green as a color noun", "The status badge renders green for the healthy state."],
    ["clean describing code", "The teardown leaves a clean working tree."],
  ])("does not flag %s", (_name, body) => {
    expect(hasCiStatusRollCall(body)).toBe(false);
  });
});

describe("hasRunOnProse", () => {
  const commaSplice = `Reshapes the resolver so it reads ${"the cache, then the database, then the network, then the stale fallback, ".repeat(3)}before it finally gives up on the request.`;

  test.each<[string, string]>([
    [
      "a paragraph over four sentences",
      "It reads. It falls back. It retries. It logs. It gives up.",
    ],
    [
      "a sentence past the run-on length",
      `Reshapes the resolver ${"and threads the request through another layer ".repeat(7)}now.`,
    ],
    ["a comma-stacked enumeration", commaSplice],
  ])("flags %s", (_name, body) => {
    expect(hasRunOnProse(body)).toBe(true);
  });

  test.each<[string, string]>([
    ["a tight paragraph", "Reshapes the resolver. It reads the cache before the database."],
    ["four short sentences", "One. Two. Three. Four."],
    ["sentences buried in fenced code", "```\nlong. run. on. wall. of. code.\n```"],
    ["a list of many items", "- one\n- two\n- three\n- four\n- five\n- six"],
  ])("does not flag %s", (_name, body) => {
    expect(hasRunOnProse(body)).toBe(false);
  });
});

describe("hasReflexiveScaffold", () => {
  test.each<[string, string, boolean]>([
    [
      "flags a small body with both Changes and Testing headings",
      "## Changes\n\n- x\n\n## Testing\n\ny",
      true,
    ],
    ["does not flag when only one heading is present", "## Changes\n\n- x", false],
    [
      "does not flag a body at or over the word limit",
      `${LONG_PROSE}\n\n## Changes\n\n- x\n\n## Testing\n\ny`,
      false,
    ],
  ])("%s", (_name, input, expected) => {
    expect(hasReflexiveScaffold(input)).toBe(expected);
  });
});

describe("hasFileTourBullets", () => {
  test.each<[string, string, boolean]>([
    ["flags a bold label with a path separator", "- **src/cache.ts**: adds a cache", true],
    ["flags a bold label that ends in a file extension", "* **cache.ts**: adds a cache", true],
    [
      "flags a bold label wrapped in backticks denoting a path",
      "- **`lib/foo.ts`**: refactors it",
      true,
    ],
    ["does not flag a plain concept label", "- **Caching**: stores records in memory", false],
    [
      "does not flag a multi-word concept label",
      "- **Retry logic**: backs off exponentially",
      false,
    ],
  ])("%s", (_name, input, expected) => {
    expect(hasFileTourBullets(input)).toBe(expected);
  });
});

describe("extractBacktickedHexCandidates", () => {
  const sha40 = "2554da150000000000000000000000000000abcd";

  test.each<[string, string, string[]]>([
    ["pulls a backticked short SHA", "a `2554da15` b", ["2554da15"]],
    ["returns a backticked 40-char SHA", `Builds on \`${sha40}\`.`, [sha40]],
    ["ignores a bare (unbackticked) hex run", "commit 2554da15 landed", []],
    ["ignores a backticked non-hex identifier", "calls `getUser` then", []],
    ["ignores a backticked file path", "see `src/cache.ts`", []],
  ])("%s", (_name, input, expected) => {
    expect(extractBacktickedHexCandidates(input)).toEqual(expected);
  });
});

describe("findBacktickedCommits", () => {
  const known = new Set(["2554da15", "dc8acf12"]);
  const fakeVerifier = (sha: string) => Promise.resolve(known.has(sha));

  test.each<[string, string, string[]]>([
    ["returns candidates the verifier confirms", "Builds on `2554da15`.", ["2554da15"]],
    ["drops a hex candidate the verifier rejects", "random `deadbeef` hash", []],
  ])("%s", async (_name, input, expected) => {
    const candidates = extractBacktickedHexCandidates(input);
    expect(await findBacktickedCommits(candidates, fakeVerifier)).toEqual(expected);
  });
});

describe("hasBacktickedRef", () => {
  test.each<[string, string, boolean]>([
    ["flags a backticked issue/PR ref", "Closes `#123`", true],
    ["flags a backticked GitLab MR ref", "See `!45`", true],
    ["flags a backticked cross-repo ref", "Relates to `owner/repo#12`", true],
    ["does not flag a bare ref", "Closes #123", false],
    ["does not flag a backticked mention", "thanks `@user`", false],
    ["does not flag a backticked CSS id", "the `#main` selector", false],
  ])("%s", (_name, input, expected) => {
    expect(hasBacktickedRef(input)).toBe(expected);
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
