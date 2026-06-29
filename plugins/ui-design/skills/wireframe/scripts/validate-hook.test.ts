import { describe, expect, it } from "bun:test";
import path from "node:path";
import type {
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
} from "@bendrucker/claude-plugin-toolkit";

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
  it.each<[string, boolean]>([
    ["/path/to/file.svg", true],
    ["file.svg", true],
    ["/path/to/file.png", false],
    ["/path/to/file.ts", false],
    ["/path/to/file", false],
    [".svg", false],
    ["/path/to/.svg", false],
    ["/path/to/file.SVG", false],
  ])("isSvgFile(%p) is %p", (input, expected) => {
    expect(isSvgFile(input)).toBe(expected);
  });
});

describe("processInput", () => {
  it.each<{ name: string; tool: string; path: string; expected: null | string }>([
    { name: "non-Write/Edit tools", tool: "Read", path: "/path/to/file.svg", expected: null },
    { name: "non-SVG files", tool: "Write", path: "/path/to/file.ts", expected: null },
    {
      name: "valid SVG",
      tool: "Write",
      path: path.join(assetsDir, "login-screen.svg"),
      expected: null,
    },
    {
      name: "invalid SVG",
      tool: "Write",
      path: path.join(fixturesDir, "missing-dimensions.svg"),
      expected: "missing-dimensions",
    },
    {
      name: "Edit tool",
      tool: "Edit",
      path: path.join(fixturesDir, "overlapping-elements.svg"),
      expected: "overlap",
    },
  ])("handles $name", async ({ tool, path: filePath, expected }) => {
    const result = await processInput(makeInput(tool, filePath));

    if (expected === null) {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      const output = result?.hookSpecificOutput as PostToolUseHookSpecificOutput | undefined;
      expect(output?.additionalContext).toContain(expected);
    }
  });
});
