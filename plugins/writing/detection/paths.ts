import { resolve } from "node:path";

export function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

const MEMORY_PATH_PATTERN = /\/\.claude\/projects\/[^/]+\/memory\//;

export function isMemoryPath(filePath: string): boolean {
  return MEMORY_PATH_PATTERN.test(resolve(filePath));
}

export function isPlanPath(filePath: string): boolean {
  const home = process.env.HOME ?? "";
  return home !== "" && filePath.startsWith(`${home}/.claude/plans/`);
}

const JOBS_PATH_PATTERN = /\/\.claude\/jobs\//;

// Scratch prose is internal handoff text (job scripts, worktree tmp/ notes,
// $TMPDIR files) that no human reads at the write site. Content that matters
// leaves through an egress surface (--body-file, --field key=@file), where the
// Bash scan still runs. A bare `tmp` segment covers /tmp, /private/tmp, and any
// working-tree tmp/ directory. TMPDIR and job dirs need explicit checks.
export function isScratchPath(filePath: string): boolean {
  const resolved = resolve(filePath);
  const tmpDir = process.env.TMPDIR;
  if (tmpDir && resolved.startsWith(`${resolve(tmpDir)}/`)) return true;
  if (JOBS_PATH_PATTERN.test(resolved)) return true;
  return resolved.split("/").includes("tmp");
}

export function isMarkdownFile(ext: string): boolean {
  return ext === "md" || ext === "markdown";
}

const PROSE_EXTENSIONS = new Set(["md", "markdown", "txt", "mdx", "rst", "adoc"]);

export function isProseFile(filePath: string): boolean {
  return PROSE_EXTENSIONS.has(getExtension(filePath));
}
