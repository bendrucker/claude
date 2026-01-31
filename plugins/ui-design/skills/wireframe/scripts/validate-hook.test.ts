import { describe, expect, it } from "bun:test";
import path from "node:path";
import type {
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";

import { isSvgFile, processInput } from "./validate-hook";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const assetsDir = path.join(import.meta.dirname, "..", "assets");

function makeInput(toolName: string, filePath: string): PostToolUseHookInput {
  return {
    tool_name: toolName,
    tool_input: { file_path: filePath },
  } as PostToolUseHookInput;
}

describe("isSvgFile", () => {
  it("returns true for .svg files", () => {
    expect(isSvgFile("/path/to/file.svg")).toBe(true);
    expect(isSvgFile("file.svg")).toBe(true);
  });

  it("returns false for non-svg files", () => {
    expect(isSvgFile("/path/to/file.png")).toBe(false);
    expect(isSvgFile("/path/to/file.ts")).toBe(false);
    expect(isSvgFile("/path/to/file")).toBe(false);
  });

  it("handles edge cases", () => {
    expect(isSvgFile(".svg")).toBe(false);
    expect(isSvgFile("/path/to/.svg")).toBe(false);
    expect(isSvgFile("/path/to/file.SVG")).toBe(false);
  });
});

describe("processInput", () => {
  it("returns null for non-Write/Edit tools", async () => {
    const result = await processInput(makeInput("Read", "/path/to/file.svg"));
    expect(result).toBeNull();
  });

  it("returns null for non-SVG files", async () => {
    const result = await processInput(makeInput("Write", "/path/to/file.ts"));
    expect(result).toBeNull();
  });

  it("returns null for valid SVG", async () => {
    const result = await processInput(makeInput("Write", path.join(assetsDir, "login-screen.svg")));
    expect(result).toBeNull();
  });

  it("returns violations for invalid SVG", async () => {
    const result = await processInput(
      makeInput("Write", path.join(fixturesDir, "missing-dimensions.svg")),
    );
    expect(result).not.toBeNull();
    const output = result?.hookSpecificOutput as PostToolUseHookSpecificOutput | undefined;
    expect(output?.additionalContext).toContain("missing-dimensions");
  });

  it("works with Edit tool", async () => {
    const result = await processInput(
      makeInput("Edit", path.join(fixturesDir, "overlapping-elements.svg")),
    );
    expect(result).not.toBeNull();
    const output = result?.hookSpecificOutput as PostToolUseHookSpecificOutput | undefined;
    expect(output?.additionalContext).toContain("overlap");
  });
});
