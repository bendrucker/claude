import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-code";
import { processInput, runBiome } from ".";

let tempDir: string;

function mockPostToolUseInput(
  toolName: string,
  toolInput: Record<string, unknown>,
): PostToolUseHookInput {
  return {
    session_id: "test-session",
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: {},
    transcript_path: "/tmp/transcript.json",
    cwd: process.cwd(),
  };
}

const VALID_TS = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const INVALID_TS = `export function add(a, b) {
  var unused = 1
  return a + b
}
`;

describe("biome hook", () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "biome-test-"));
    writeFileSync(join(tempDir, "valid.ts"), VALID_TS);
    writeFileSync(join(tempDir, "invalid.ts"), INVALID_TS);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("processInput", () => {
    it("returns null for non-Edit/Write tools", () => {
      const input = mockPostToolUseInput("Read", { file_path: join(tempDir, "valid.ts") });
      expect(processInput(input)).toBeNull();
    });

    it("returns null for non-Biome file extensions", () => {
      const input = mockPostToolUseInput("Write", { file_path: "test.md" });
      expect(processInput(input)).toBeNull();
    });

    it("returns null when biome check passes", () => {
      const input = mockPostToolUseInput("Edit", { file_path: join(tempDir, "valid.ts") });
      expect(processInput(input)).toBeNull();
    });

    it("returns additionalContext when biome finds issues", () => {
      const input = mockPostToolUseInput("Write", { file_path: join(tempDir, "invalid.ts") });
      const result = processInput(input);

      expect(result).not.toBeNull();
      expect(result?.hookSpecificOutput).toMatchObject({
        hookEventName: "PostToolUse",
      });

      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("Biome found issues");
      expect(additionalContext).toContain("noUnusedVariables");
    });

    it("handles Write tool", () => {
      const input = mockPostToolUseInput("Write", { file_path: join(tempDir, "invalid.ts") });
      const result = processInput(input);
      expect(result).not.toBeNull();
    });

    it("handles Edit tool", () => {
      const input = mockPostToolUseInput("Edit", { file_path: join(tempDir, "invalid.ts") });
      const result = processInput(input);
      expect(result).not.toBeNull();
    });
  });

  describe("runBiome", () => {
    it("returns null when check passes", () => {
      expect(runBiome(join(tempDir, "valid.ts"))).toBeNull();
    });

    it("returns error output when check fails", () => {
      const result = runBiome(join(tempDir, "invalid.ts"));
      expect(result).not.toBeNull();
      expect(result).toContain("noUnusedVariables");
    });
  });
});
