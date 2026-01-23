#!/usr/bin/env npx tsx

import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-code";

export type WriteInput = { file_path: string; content: string };
export type EditInput = { file_path: string; new_string: string };

type Mode = "write" | "edit";

type MarkdownMatch = {
  text: string;
  line: number;
  column: number;
};

type AstGrepMatch = {
  message: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function isMarkdownFile(ext: string): boolean {
  return ext === "md" || ext === "markdown";
}

export function checkMarkdown(content: string): string | null {
  const pluginDir = join(__dirname, "..");
  const scriptPath = join(pluginDir, "scripts", "check-markdown-headings.js");

  try {
    const result = execSync(
      `npx -y -p mdast-util-from-markdown@2 -p unist-util-visit@5 node "${scriptPath}" "${content.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (result && result !== "[]") {
      const matches: MarkdownMatch[] = JSON.parse(result);
      if (matches.length > 0) {
        return `Numbered heading: ${matches[0].text}`;
      }
    }
  } catch {
    // Script failed or no matches
  }

  return null;
}

export function checkCode(content: string, ext: string): string | null {
  // Check if sg is available
  try {
    execSync("command -v sg", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return null;
  }

  const tmpFile = join(tmpdir(), `hook-check.${ext}`);
  const ruleFile = join(__dirname, "numbering.yml");

  try {
    writeFileSync(tmpFile, content);

    // sg scan returns exit code 1 when matches are found (as errors)
    // We need to capture stdout regardless of exit code
    let result: string;
    try {
      result = execSync(`sg scan --rule "${ruleFile}" --json "${tmpFile}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      // execSync throws on non-zero exit, but we want stdout
      const execError = error as { stdout?: string };
      result = (execError.stdout || "").trim();
    }

    if (result) {
      const matches: AstGrepMatch[] = JSON.parse(result);
      if (matches.length > 0) {
        return matches[0].message;
      }
    }
  } catch {
    // sg failed or parse error
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  return null;
}

export function formatOutput(
  decision: "deny" | "ask",
  reason: string
): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

export function processInput(
  input: PreToolUseHookInput,
  mode: Mode
): SyncHookJSONOutput | null {
  const toolName = input.tool_name;

  let content: string | undefined;
  let filePath: string | undefined;

  if (toolName === "Write") {
    const toolInput = input.tool_input as WriteInput | undefined;
    content = toolInput?.content;
    filePath = toolInput?.file_path;
  } else if (toolName === "Edit") {
    const toolInput = input.tool_input as EditInput | undefined;
    content = toolInput?.new_string;
    filePath = toolInput?.file_path;
  } else {
    return null;
  }

  if (!content || !filePath) {
    return null;
  }

  const ext = getExtension(filePath);
  let match: string | null = null;

  if (isMarkdownFile(ext)) {
    match = checkMarkdown(content);
  } else {
    match = checkCode(content, ext);
  }

  if (!match) {
    return null;
  }

  const reason = `Detected numbered sequences that create tight coupling.
${match}

Use descriptive names instead. See CLAUDE.md Organization guidelines.`;

  if (mode === "write") {
    return formatOutput("deny", reason);
  } else {
    return formatOutput("ask", `This edit introduces numbered sequences. ${reason}`);
  }
}

async function main(): Promise<void> {
  const mode = (process.argv[2] || "write") as Mode;

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const inputText = Buffer.concat(chunks).toString("utf-8");

  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(inputText) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[style/numbering] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const output = processInput(input, mode);
  if (output) {
    console.log(JSON.stringify(output));
  }
}

main().catch(console.error);
