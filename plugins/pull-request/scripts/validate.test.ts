import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HookInput, processInput } from "./validate";

function getPermissionDecision(result: Awaited<ReturnType<typeof processInput>>) {
  const output = result?.hookSpecificOutput;
  if (output && "permissionDecision" in output) {
    return output.permissionDecision;
  }
  return undefined;
}

function getAdditionalContext(result: Awaited<ReturnType<typeof processInput>>) {
  const output = result?.hookSpecificOutput;
  if (output && "additionalContext" in output) {
    return output.additionalContext;
  }
  return undefined;
}

function getDenyReason(result: Awaited<ReturnType<typeof processInput>>) {
  const output = result?.hookSpecificOutput;
  if (output && "permissionDecisionReason" in output) {
    return output.permissionDecisionReason;
  }
  return undefined;
}

describe("processInput", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "validate-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const repoRoot = join(import.meta.dir, "..", "..", "..");
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" })
    .stdout.trim()
    .slice(0, 12);

  function createInput(command: string, cwd?: string): HookInput {
    return { tool_input: { command }, ...(cwd != null && cwd !== "" && { cwd }) };
  }

  it("returns null when command has no --body-file", async () => {
    const result = await processInput(createInput("gh pr create --title 'Test'"));
    expect(result).toBeNull();
  });

  // A dispatch that escapes the `if` rules must stay inert, including one that
  // names a body file the hook must not read.
  test.each<[string]>([["ls -la"], ["cat /tmp/body.md"], ["{ echo one; echo two; }"]])(
    "returns null for unrelated command %p",
    async (command) => {
      expect(await processInput(createInput(command))).toBeNull();
    },
  );

  // A PR command quoted inside another program's argument is prose, not an
  // invocation, so the hook never reaches the body file its text names.
  test.each<[string]>([
    ["bun url.ts add --notes 'retry with gh pr edit 12 --body-file /nonexistent.md'"],
    [
      'bun url.ts add --notes "Blocked.\nRun gh pr edit 12 --body-file /nonexistent.md\nThen push."',
    ],
  ])("returns null for %p, where the PR command is an argument", async (command) => {
    expect(await processInput(createInput(command))).toBeNull();
  });

  // The round trip: read the PR, edit the file, write it back. The hook runs
  // before the shell, so no body it could read is the one the CLI sends.
  test.each<[string]>([
    [
      "gh pr view 12 --json body -q .body > /nonexistent.md && gh pr edit 12 --body-file /nonexistent.md",
    ],
    [
      "glab mr view 3 --output json | jq -r .description > /nonexistent.md && glab mr update 3 --description-file /nonexistent.md",
    ],
  ])("returns null for %p, a round trip through the same PR", async (command) => {
    expect(await processInput(createInput(command))).toBeNull();
  });

  it("denies a generator writing the body file it will pass", async () => {
    const result = await processInput(
      createInput("printf 'Prose.' > /nonexistent.md && gh pr edit 12 --body-file /nonexistent.md"),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("/nonexistent.md");
  });

  it("returns null when tool_input has no command", async () => {
    const result = await processInput({ tool_input: {} });
    expect(result).toBeNull();
  });

  // A skipped check must not read as a clean body, so the one case the hook
  // cannot inspect is the one case it refuses outright.
  test.each<[string, string]>([
    ["gh pr create --body-file /nonexistent.md", "/nonexistent.md"],
    ['glab mr create --description "$(cat /nonexistent.md)"', "/nonexistent.md"],
    ['glab mr create --description "$(git log --oneline)"', "$(git log --oneline)"],
    ["glab mr update 3 --description-file -", "standard input"],
  ])("denies %p, which it cannot read", async (command, fragment) => {
    const result = await processInput(createInput(command));
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain(fragment);
    expect(getDenyReason(result)).toContain("none of the body checks ran");
  });

  it("returns null for valid body", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Summary\nFixes a bug");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).toBeNull();
  });

  // Every shape a PR/MR body arrives in, bound to the same deny. The GitLab
  // rows are the ones the hook used to wave through: a `--description` value is
  // the only way `glab` took a body before `--description-file`, and neither
  // reached the checks.
  test.each<[string, (body: string) => string]>([
    ["gh pr create --body-file", (body) => `gh pr create --title T --body-file ${body}`],
    ["gh pr edit --body-file", (body) => `gh pr edit 12 --body-file ${body}`],
    ["gh pr create --body", (body) => `gh pr create --title T --body "$(cat ${body})"`],
    [
      "glab mr create --description-file",
      (body) => `glab mr create --title T --description-file ${body}`,
    ],
    ["glab mr update --description-file", (body) => `glab mr update 3 --description-file ${body}`],
    [
      "glab mr create --description",
      (body) => `glab mr create --title T --description "$(cat ${body})"`,
    ],
    ["glab mr update --description", (body) => `glab mr update 3 --description "$(cat ${body})"`],
    ["glab mr update -d", (body) => `glab mr update 3 -d "$(cat ${body})"`],
  ])("checks the body behind %s", async (_form, build) => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "Reshapes the resolver. Added 5 tests.");
    const result = await processInput(createInput(build(bodyFile), repoRoot));
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("test counts");
  });

  // The body file does not exist when the hook runs: the same command writes
  // it. The heredoc is the body.
  it("validates a body written by a heredoc in the same command", async () => {
    const bodyFile = join(tempDir, "body.md");
    const command = `mkdir -p tmp && cat > ${bodyFile} <<'EOF'\n## Two fixes found while testing\n\nReshapes the resolver.\nEOF\ngh pr create --title T --body-file ${bodyFile}`;
    const result = await processInput(createInput(command, repoRoot));
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
  });

  it("passes a clean body written by a heredoc in the same command", async () => {
    const bodyFile = join(tempDir, "body.md");
    const command = `cat > ${bodyFile} <<'EOF'\n## Summary\n\nFixes a bug.\nEOF\ngh pr create --title T --body-file ${bodyFile}`;
    expect(await processInput(createInput(command, repoRoot))).toBeNull();
  });

  it("resolves a relative body file behind a cd", async () => {
    const bodyFile = join(tempDir, "sub", "body.md");
    await Bun.write(bodyFile, "Reshapes the resolver. Added 5 tests.");
    const result = await processInput(
      createInput("cd sub && gh pr create --title T --body-file body.md", tempDir),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("test counts");
  });

  it("denies body with test count", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Test plan\nAdded 5 tests");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("denies a backticked real commit SHA", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("auto-link");
  });

  it("reports a verified SHA once when the body also has a backticked ref", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`. Closes \`#12\`.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)?.match(/auto-link/g)).toHaveLength(1);
  });

  it("does not warn on a bare commit SHA", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on ${headSha}.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(result).toBeNull();
  });

  it("re-cases a sentence-case heading in the body file and lets the command run", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Two fixes found while testing\n\nReshapes the resolver.");
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain(
      '"Two fixes found while testing" → "Two Fixes Found While Testing"',
    );
    expect(await Bun.file(bodyFile).text()).toBe(
      "## Two Fixes Found While Testing\n\nReshapes the resolver.",
    );
  });

  it("re-cases a relative body file behind a cd", async () => {
    const bodyFile = join(tempDir, "sub", "body.md");
    await Bun.write(bodyFile, "## Corpus results\n\nReshapes the resolver.");
    const result = await processInput(
      createInput("cd sub && gh pr create --title T --body-file body.md", tempDir),
    );
    expect(getAdditionalContext(result)).toContain(bodyFile);
    expect(await Bun.file(bodyFile).text()).toBe("## Corpus Results\n\nReshapes the resolver.");
  });

  it("leaves the file alone and denies when another deny stands with the heading", async () => {
    const bodyFile = join(tempDir, "body.md");
    const body = "## Two fixes found while testing\n\nAdded 5 tests.";
    await Bun.write(bodyFile, body);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
    expect(getDenyReason(result)).toContain("test counts");
    expect(await Bun.file(bodyFile).text()).toBe(body);
  });

  // The file the command names does not exist yet: the command's own heredoc
  // writes it, and would overwrite anything the hook put there.
  it("denies a heading in a heredoc body instead of correcting it", async () => {
    const bodyFile = join(tempDir, "body.md");
    const command = `cat > ${bodyFile} <<'EOF'\n## Two fixes found while testing\n\nReshapes it.\nEOF\ngh pr create --title T --body-file ${bodyFile}`;
    const result = await processInput(createInput(command, repoRoot));
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
    expect(await Bun.file(bodyFile).exists()).toBe(false);
  });

  it("denies a heading in an inline body instead of correcting it", async () => {
    const result = await processInput(
      createInput(`gh pr create --title T --body '## Two fixes found while testing'`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
  });

  // A generator writing the same file replaces it after the hook reads it, so a
  // correction would never reach the PR. The two spellings of the path need not
  // match for it to be the same file.
  test.each<[string, (dir: string) => string]>([
    [
      "the same spelling",
      (dir) =>
        `generate > ${join(dir, "body.md")} && gh pr create -T --body-file ${join(dir, "body.md")}`,
    ],
    [
      "a relative generator and an absolute body file",
      (dir) =>
        `cd ${dir} && generate > body.md && gh pr create -T --body-file ${join(dir, "body.md")}`,
    ],
    [
      "an absolute generator and a relative body file",
      (dir) =>
        `cd ${dir} && generate > ${join(dir, "body.md")} && gh pr create -T --body-file body.md`,
    ],
  ])(
    "denies a heading in a body file the command regenerates, through %s",
    async (_name, build) => {
      const bodyFile = join(tempDir, "body.md");
      const body = "## Two fixes found while testing\n\nReshapes the resolver.";
      await Bun.write(bodyFile, body);
      const result = await processInput(createInput(build(tempDir), repoRoot));
      expect(getPermissionDecision(result)).toBe("deny");
      expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
      expect(await Bun.file(bodyFile).text()).toBe(body);
    },
  );

  it("re-cases without retyping the whitespace the author wrote", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "##  Two  fixes\tfound\n\nReshapes the resolver.");
    await processInput(createInput(`gh pr create --body-file ${bodyFile}`, repoRoot));
    expect(await Bun.file(bodyFile).text()).toBe("##  Two  Fixes\tFound\n\nReshapes the resolver.");
  });

  it("leaves the body whole and denies when the correction cannot be written", async () => {
    const bodyFile = join(tempDir, "body.md");
    const body = "## Two fixes found while testing\n\nReshapes the resolver.";
    await Bun.write(bodyFile, body);
    spawnSync("chmod", ["500", tempDir]);
    try {
      const result = await processInput(
        createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
      );
      expect(getPermissionDecision(result)).toBe("deny");
      expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
      expect(await Bun.file(bodyFile).text()).toBe(body);
    } finally {
      spawnSync("chmod", ["700", tempDir]);
    }
    expect(readdirSync(tempDir)).toEqual(["body.md"]);
  });

  it("re-cases once and stays silent on the retry", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Null floor\n\nReshapes the resolver.");
    const command = `gh pr create --body-file ${bodyFile}`;
    await processInput(createInput(command, repoRoot));
    const corrected = await Bun.file(bodyFile).text();
    expect(await processInput(createInput(command, repoRoot))).toBeNull();
    expect(await Bun.file(bodyFile).text()).toBe(corrected);
  });

  it("combines a test-count and a backticked SHA into one deny", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`.\n\nAdded 5 tests`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    const reason = getDenyReason(result);
    expect(reason).toContain("- Testing section should not mention test counts");
    expect(reason).toContain("- Commit SHAs and issue/MR refs");
  });

  it("warns on the title the command sets", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "Adds an LRU cache to the resolver.");
    const result = await processInput(
      createInput(
        `gh pr create --title "Add an LRU Cache to the Resolver and Wire It Through" --body-file ${bodyFile}`,
        repoRoot,
      ),
    );
    expect(getAdditionalContext(result)).toContain("characters");
  });

  it("carries the title warning into the deny when the body file is missing", async () => {
    const result = await processInput(
      createInput(
        `gh pr create --title "Add an LRU Cache to the Resolver and Wire It Through" --body-file ${join(tempDir, "missing.md")}`,
        repoRoot,
      ),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("none of the body checks ran");
    expect(getDenyReason(result)).toContain("characters");
  });

  it("stays silent on a title-only command with a clean title", async () => {
    const result = await processInput(
      createInput('gh pr edit 12 --title "Add an LRU Cache"', repoRoot),
    );
    expect(result).toBeNull();
  });

  it("carries warnings inside the deny instead of a separate warn", async () => {
    const bodyFile = join(tempDir, "body.md");
    await Bun.write(bodyFile, "Added 5 tests.\n\n- **src/cache.ts**: adds a cache");
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getAdditionalContext(result)).toBeUndefined();
    expect(getDenyReason(result)).toContain("Also worth addressing in the same edit:");
  });
});
