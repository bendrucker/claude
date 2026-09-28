import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { SIDECAR_GUIDANCE, SIZE_THRESHOLD } from "./gate";
import { isPlanFile, processInput } from "./write-warn";

let home: string;
let cwd: string;
let plansDir: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "plan-write-warn-home-"));
  cwd = mkdtempSync(join(tmpdir(), "plan-write-warn-cwd-"));
  plansDir = join(home, ".claude", "plans");
  mkdirSync(plansDir, { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

function mockInput(
  toolName: string,
  filePath: string,
  permissionMode = "plan",
): PostToolUseHookInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "test-session",
    transcript_path: "/tmp/transcript.json",
    cwd,
    permission_mode: permissionMode,
    tool_name: toolName,
    tool_input: { file_path: filePath },
    tool_response: {},
    tool_use_id: "test",
  };
}

async function warn(
  toolName: string,
  filePath: string,
  permissionMode = "plan",
): Promise<PostToolUseHookSpecificOutput | null> {
  const result = await processInput(mockInput(toolName, filePath, permissionMode), home);
  const specific = result?.hookSpecificOutput;
  return specific?.hookEventName === "PostToolUse" ? specific : null;
}

describe("isPlanFile", () => {
  it("matches a markdown file directly under the plans directory", () => {
    expect(isPlanFile(join(plansDir, "add-retry.md"), plansDir)).toBe(true);
  });

  it("rejects a non-markdown file", () => {
    expect(isPlanFile(join(plansDir, "add-retry.txt"), plansDir)).toBe(false);
  });

  it("rejects a file outside the plans directory", () => {
    expect(isPlanFile(join(cwd, "add-retry.md"), plansDir)).toBe(false);
  });

  it("rejects a file nested in a subdirectory of the plans directory", () => {
    expect(isPlanFile(join(plansDir, "sub", "add-retry.md"), plansDir)).toBe(false);
  });
});

describe("processInput", () => {
  it("stays silent for a tool other than Write or Edit", async () => {
    const filePath = join(plansDir, "big.md");
    await Bun.write(filePath, "x".repeat(SIZE_THRESHOLD + 1));
    expect(await warn("Bash", filePath)).toBeNull();
  });

  it("stays silent outside plan mode, even on an oversized plan file", async () => {
    const filePath = join(plansDir, "big.md");
    await Bun.write(filePath, "x".repeat(SIZE_THRESHOLD + 1));
    expect(await warn("Write", filePath, "default")).toBeNull();
  });

  it("stays silent for a plan file at or under the threshold", async () => {
    const filePath = join(plansDir, "small.md");
    await Bun.write(filePath, "x".repeat(SIZE_THRESHOLD));
    expect(await warn("Write", filePath)).toBeNull();
  });

  it("stays silent for an oversized file outside the plans directory", async () => {
    const filePath = join(cwd, "big.md");
    await Bun.write(filePath, "x".repeat(SIZE_THRESHOLD + 1));
    expect(await warn("Write", filePath)).toBeNull();
  });

  it.each(["Write", "Edit"])(
    "warns with the character count and sidecar guidance on a %s over the threshold",
    async (toolName) => {
      const filePath = join(plansDir, "big.md");
      const content = "x".repeat(SIZE_THRESHOLD + 1);
      await Bun.write(filePath, content);
      const result = await warn(toolName, filePath);
      const context = result?.additionalContext ?? "";
      expect(context).toContain(content.length.toLocaleString());
      expect(context).toContain(SIDECAR_GUIDANCE);
    },
  );

  it("stays silent when the file_path is missing from tool_input", async () => {
    const input = mockInput("Write", "unused");
    input.tool_input = {};
    expect(await processInput(input)).toBeNull();
  });

  it("stays silent when the written file no longer exists", async () => {
    expect(await warn("Write", join(plansDir, "missing.md"))).toBeNull();
  });
});
