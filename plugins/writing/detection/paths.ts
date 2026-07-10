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
// Bash scan still runs. Only a tmp segment below the working tree counts as
// scratch: a repository that happens to live under a tmp-named ancestor
// (~/tmp/myproject) still gets its committed prose scanned.
export function isScratchPath(filePath: string, cwd: string = process.cwd()): boolean {
  const resolved = resolve(cwd, filePath);
  const tmpDir = process.env.TMPDIR;
  if (tmpDir && resolved.startsWith(`${resolve(tmpDir)}/`)) return true;
  if (JOBS_PATH_PATTERN.test(resolved)) return true;
  if (resolved.startsWith("/tmp/") || resolved.startsWith("/private/tmp/")) return true;
  const root = resolve(cwd);
  if (!resolved.startsWith(`${root}/`)) return false;
  return resolved
    .slice(root.length + 1)
    .split("/")
    .includes("tmp");
}

export function isMarkdownFile(ext: string): boolean {
  return ext === "md" || ext === "markdown";
}

const PROSE_EXTENSIONS = new Set(["md", "markdown", "txt", "mdx", "rst", "adoc"]);

export function isProseFile(filePath: string): boolean {
  return PROSE_EXTENSIONS.has(getExtension(filePath));
}
