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

export function isMarkdownFile(ext: string): boolean {
  return ext === "md" || ext === "markdown";
}

const PROSE_EXTENSIONS = new Set(["md", "markdown", "txt", "mdx", "rst", "adoc"]);

export function isProseFile(filePath: string): boolean {
  return PROSE_EXTENSIONS.has(getExtension(filePath));
}
