import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractBodyFilePath, processInput, validateBody } from "./validate";

function getPermissionDecision(result: Awaited<ReturnType<typeof validateBody>>) {
  const output = result?.hookSpecificOutput;
  if (output && "permissionDecision" in output) {
    return output.permissionDecision;
  }
  return undefined;
}

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
});

describe("processInput", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createInput(command: string): PreToolUseHookInput {
    return {
      tool_name: "Bash",
      tool_input: { command },
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
    fs.writeFileSync(bodyFile, "## Summary\nFixes a bug");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).toBeNull();
  });

  it("denies body with test count", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    fs.writeFileSync(bodyFile, "## Test plan\nAdded 5 tests");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });
});
