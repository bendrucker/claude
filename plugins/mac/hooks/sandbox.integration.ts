import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { hasBypassMarker, isGoBinary, processInput } from "./sandbox";

function makeInput(command: string, toolName = "Bash"): PreToolUseHookInput {
  return {
    tool_name: toolName,
    tool_input: { command },
  } as PreToolUseHookInput;
}

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const githubWatchScript = join(
  repoRoot,
  "plugins",
  "github",
  "skills",
  "actions-monitor",
  "scripts",
  "watch.ts",
);
const gitlabWatchScript = join(
  repoRoot,
  "plugins",
  "gitlab",
  "skills",
  "ci-monitor",
  "scripts",
  "watch.ts",
);
const jxaScript = join(repoRoot, "plugins", "mac", "scripts", "jxa.ts");

describe("isGoBinary", () => {
  test("gh is a Go binary", async () => {
    expect(await isGoBinary("gh")).toBe(true);
  });

  test("node is not a Go binary", async () => {
    expect(await isGoBinary("node")).toBe(false);
  });

  test("nonexistent binary returns false", async () => {
    expect(await isGoBinary("nonexistent-binary-12345")).toBe(false);
  });
});

describe("hasBypassMarker", () => {
  test("github actions-monitor watch.ts carries the marker", async () => {
    expect(await hasBypassMarker(githubWatchScript)).toBe(true);
  });

  test("gitlab ci-monitor watch.ts carries the marker", async () => {
    expect(await hasBypassMarker(gitlabWatchScript)).toBe(true);
  });

  test("mac jxa.ts carries the marker", async () => {
    expect(await hasBypassMarker(jxaScript)).toBe(true);
  });
});

describe("processInput", () => {
  test("disables sandbox for Go binary on darwin", async () => {
    const input = makeInput("gh api /rate_limit");
    const result = await processInput(input, "darwin");
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          ...(input.tool_input as Record<string, unknown>),
          dangerouslyDisableSandbox: true,
        },
      },
    });
  });

  test("detects Go binary through pipe", async () => {
    const result = await processInput(makeInput("gh api /rate_limit | jq .rate"), "darwin");
    expect(result).not.toBeNull();
  });

  test("detects Go binary through &&", async () => {
    const result = await processInput(makeInput("echo start && gh api /rate_limit"), "darwin");
    expect(result).not.toBeNull();
  });

  test("disables sandbox for github watch.ts under Monitor", async () => {
    const result = await processInput(
      makeInput(`bun ${githubWatchScript} --pr https://github.com/o/r/pull/1`, "Monitor"),
      "darwin",
    );
    expect(result).not.toBeNull();
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("disables sandbox for gitlab watch.ts under Monitor", async () => {
    const result = await processInput(
      makeInput(
        `bun ${gitlabWatchScript} --mr https://gitlab.com/o/r/-/merge_requests/1`,
        "Monitor",
      ),
      "darwin",
    );
    expect(result).not.toBeNull();
  });

  test("disables sandbox for mac jxa.ts", async () => {
    const result = await processInput(makeInput(`bun ${jxaScript} Finder 'app.name()'`), "darwin");
    expect(result).not.toBeNull();
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });
});
