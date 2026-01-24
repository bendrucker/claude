#!/usr/bin/env npx tsx

import { execSync } from "node:child_process";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type BashInput = { command: string };
export type BashResult = { stdout: string; stderr: string; exitCode: number };

interface LeasotTodo {
  file: string;
  line: number;
  tag: string;
  text: string;
}

function isGitCommit(command: string): boolean {
  return /\bgit\s+commit\b/.test(command);
}

function hasLeasot(): boolean {
  try {
    execSync("npx leasot --version", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function getCommittedFiles(): string[] {
  try {
    const output = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

function getHeadCommit(): string {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function isLineFromCommit(file: string, lineNumber: number, commitHash: string): boolean {
  try {
    const output = execSync(`git blame -l -L ${lineNumber},${lineNumber} -- "${file}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.startsWith(commitHash);
  } catch {
    return false;
  }
}

function runLeasot(files: string[]): LeasotTodo[] {
  if (files.length === 0) return [];

  const existingFiles = files.filter((f) => {
    try {
      execSync(`test -f "${f}"`, { stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch {
      return false;
    }
  });

  if (existingFiles.length === 0) return [];

  try {
    const output = execSync(`npx leasot --reporter json ${existingFiles.join(" ")}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(output) as LeasotTodo[];
  } catch (error) {
    const execError = error as { stdout?: string };
    if (execError.stdout) {
      try {
        return JSON.parse(execError.stdout) as LeasotTodo[];
      } catch {
        return [];
      }
    }
    return [];
  }
}

function findNewTodos(files: string[]): LeasotTodo[] {
  const todos = runLeasot(files);
  const headCommit = getHeadCommit();

  if (!headCommit) {
    return [];
  }

  return todos.filter((todo) => isLineFromCommit(todo.file, todo.line, headCommit));
}

export function formatOutput(todos: LeasotTodo[]): SyncHookJSONOutput {
  const todoList = todos.map((t) => `- ${t.file}:${t.line}: ${t.tag}: ${t.text}`).join("\n");

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `New TODOs committed:\n${todoList}\n\nConsider addressing these before creating a PR.`,
    },
  };
}

export function processInput(
  input: PostToolUseHookInput,
  result: BashResult | undefined,
): SyncHookJSONOutput | null {
  const toolName = input.tool_name;

  if (toolName !== "Bash") {
    return null;
  }

  const bashInput = input.tool_input as BashInput;
  if (!isGitCommit(bashInput.command)) {
    return null;
  }

  if (!result || result.exitCode !== 0) {
    return null;
  }

  if (!hasLeasot()) {
    return null;
  }

  const files = getCommittedFiles();
  if (files.length === 0) {
    return null;
  }

  const newTodos = findNewTodos(files);
  if (newTodos.length === 0) {
    return null;
  }

  return formatOutput(newTodos);
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = await readStdinJson<PostToolUseHookInput>();
  } catch (error) {
    console.error(
      `[commit-todos] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const result = input.tool_response as BashResult | undefined;
  const output = processInput(input, result);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch(console.error);
