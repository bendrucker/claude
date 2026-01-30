import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SearchOptions } from "./types";

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

export interface SessionFile {
  path: string;
  mtime: Date;
}

export function matchesProjectFilter(projectDir: string, filter: string): boolean {
  const normalizedFilter = filter.replace(/\//g, "-");
  return projectDir.includes(normalizedFilter) || projectDir.includes(filter);
}

export function isWithinDateRange(timestamp: Date | null, options: SearchOptions): boolean {
  if (!timestamp) return true;
  if (options.after && timestamp < options.after) return false;
  if (options.before && timestamp > options.before) return false;
  return true;
}

export function compareTimestampsDesc(a: Date | null, b: Date | null): number {
  if (!a) return 1;
  if (!b) return -1;
  return b.getTime() - a.getTime();
}

export function getProjectsDir(options: SearchOptions): string {
  return options.projectsDir || process.env.CLAUDE_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;
}

export async function* streamSessionFiles(options: SearchOptions): AsyncGenerator<SessionFile> {
  const projectsDir = getProjectsDir(options);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(projectsDir, entry.name);

    if (options.project && !matchesProjectFilter(projectDir, options.project)) {
      continue;
    }

    const files = await fs.readdir(projectDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const filePath = path.join(projectDir, file);
        const stat = await fs.stat(filePath);

        if (options.after && stat.mtime < options.after) {
          continue;
        }
        if (options.before && stat.mtime > options.before) {
          continue;
        }

        yield { path: filePath, mtime: stat.mtime };
      }
    }
  }
}

export async function findSessionFile(
  sessionId: string,
  options: SearchOptions = {},
): Promise<string | null> {
  const filename = `${sessionId}.jsonl`;
  for await (const file of streamSessionFiles(options)) {
    if (path.basename(file.path) === filename) {
      return file.path;
    }
  }
  return null;
}
