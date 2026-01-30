#!/usr/bin/env bun

import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cli } from "cleye";

export async function createTempFile(content: string, ext: string): Promise<string> {
  const dir = `/tmp/claude/vscode-edit-${randomUUID()}`;
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `edit.${ext}`);
  await writeFile(filePath, content);
  return filePath;
}

export function openInEditor(filePath: string, wait: boolean): void {
  const args = wait ? ["--wait", filePath] : [filePath];
  if (wait) {
    execFileSync("code", args);
  } else {
    const child = execFile("code", args);
    child.unref();
  }
}

export async function readAndCleanup(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  await rm(dirname(filePath), { recursive: true });
  return content;
}

async function main() {
  const argv = cli({
    name: "edit",
    parameters: ["[file]"],
    flags: {
      ext: {
        type: String,
        description: "File extension for temp files",
        default: "md",
      },
      wait: {
        type: Boolean,
        description: "Wait for editor to close",
        default: true,
      },
    },
    help: {
      description: "Open content in VS Code for editing",
    },
  });

  const file = argv._.file;

  if (file) {
    openInEditor(file, argv.flags.wait);
  } else {
    const stdinContent = await Bun.stdin.text();

    const tempPath = await createTempFile(stdinContent, argv.flags.ext);
    openInEditor(tempPath, argv.flags.wait);

    if (argv.flags.wait) {
      const content = await readAndCleanup(tempPath);
      process.stdout.write(content);
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
