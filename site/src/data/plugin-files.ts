import { join } from "node:path";
import { Glob } from "bun";
import {
  countLines,
  parseSkill,
} from "../../../plugins/claude-code/skills/skill/scripts/skill-lint/parse";
import { githubBlobUrl } from "./routes";

export interface ComponentSummary {
  name: string;
  description: string;
  path: string;
  githubBlobUrl: string;
}

export type SkillSummary = ComponentSummary;

export interface HooksSummary {
  description: string;
  path: string;
  githubBlobUrl: string;
  /** Event names the plugin hooks into, e.g. `PreToolUse`. */
  events: string[];
}

export interface TsFileSummary {
  path: string;
  language: "typescript";
  lines: number;
  githubBlobUrl: string;
}

function basenameNoExt(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/, "");
}

async function readText(pluginDir: string, relPath: string): Promise<string> {
  return Bun.file(join(pluginDir, relPath)).text();
}

export async function scanSkills(pluginDir: string, pluginName: string): Promise<SkillSummary[]> {
  const glob = new Glob("skills/*/SKILL.md");
  const skills: SkillSummary[] = [];

  for await (const relPath of glob.scan({ cwd: pluginDir })) {
    const skillName = relPath.split("/")[1];
    const repoPath = `plugins/${pluginName}/${relPath}`;
    const raw = await readText(pluginDir, relPath);
    const { frontmatter } = parseSkill(raw);

    skills.push({
      name: frontmatter.name ?? skillName,
      description: frontmatter.description ?? "",
      path: repoPath,
      githubBlobUrl: githubBlobUrl(repoPath),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function scanAgents(
  pluginDir: string,
  pluginName: string,
): Promise<ComponentSummary[]> {
  const glob = new Glob("agents/*.md");
  const agents: ComponentSummary[] = [];

  for await (const relPath of glob.scan({ cwd: pluginDir })) {
    const name = basenameNoExt(relPath);
    const repoPath = `plugins/${pluginName}/${relPath}`;
    const raw = await readText(pluginDir, relPath);
    const { frontmatter } = parseSkill(raw);

    agents.push({
      name: frontmatter.name ?? name,
      description: frontmatter.description ?? "",
      path: repoPath,
      githubBlobUrl: githubBlobUrl(repoPath),
    });
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/** Command files get no page of their own. The index only needs a count for its chip. */
export async function countCommands(pluginDir: string): Promise<number> {
  const glob = new Glob("commands/*.md");
  let count = 0;
  for await (const _relPath of glob.scan({ cwd: pluginDir })) count++;
  return count;
}

export async function scanHooks(
  pluginDir: string,
  pluginName: string,
): Promise<HooksSummary | undefined> {
  const relPath = "hooks/hooks.json";
  const file = Bun.file(join(pluginDir, relPath));
  if (!(await file.exists())) return undefined;

  const data = (await file.json()) as Record<string, unknown>;
  const description = data.description;
  if (typeof description !== "string") return undefined;

  const repoPath = `plugins/${pluginName}/${relPath}`;
  return {
    description,
    path: repoPath,
    githubBlobUrl: githubBlobUrl(repoPath),
    events: hookEvents(data.hooks),
  };
}

/**
 * The event names a hooks file registers, one per event however many matchers
 * or scripts it declares. Enough to show what a plugin hooks into; the file
 * itself is a click away for the rest.
 */
function hookEvents(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
}

export async function scanTsFiles(pluginDir: string, pluginName: string): Promise<TsFileSummary[]> {
  const glob = new Glob("**/*.ts");
  const files: TsFileSummary[] = [];

  for await (const relPath of glob.scan({ cwd: pluginDir })) {
    // bun install populates plugins/*/node_modules in CI as well as locally;
    // this exclusion is permanent, not a local-only workaround.
    if (relPath.includes("node_modules") || relPath.includes(".bun-cache")) continue;

    const repoPath = `plugins/${pluginName}/${relPath}`;
    const text = await readText(pluginDir, relPath);
    files.push({
      path: repoPath,
      language: "typescript",
      lines: countLines(text),
      githubBlobUrl: githubBlobUrl(repoPath),
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}
