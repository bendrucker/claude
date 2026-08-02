import { join } from "node:path";

export const root = join(import.meta.dirname, "..");

/** Where an asset is registered from, which decides when Claude Code loads it. */
export const SCOPES = ["plugin", "user", "project"] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export const SKILL_GLOBS = [
  "plugins/*/skills/*/SKILL.md",
  "user/skills/*/SKILL.md",
  ".claude/skills/*/SKILL.md",
];

export const AGENT_GLOBS = ["plugins/*/agents/*.md", "user/agents/*.md", ".claude/agents/*.md"];

export const COMMAND_GLOBS = [
  "plugins/*/commands/**/*.md",
  "user/commands/**/*.md",
  ".claude/commands/**/*.md",
];

export const RULE_GLOBS = ["user/rules/*.md", ".claude/rules/*.md"];

function isFixture(path: string): boolean {
  return path.includes("/test/") || path.includes("/fixtures/");
}

/** Repo-relative paths matching any pattern, minus test and fixture copies. */
export async function* assetPaths(patterns: string[]): AsyncGenerator<string> {
  for (const pattern of patterns) {
    // `dot` reaches the project scope under `.claude/`. A pattern whose
    // directory is absent yields nothing.
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root, dot: true })) {
      if (!isFixture(path)) yield path;
    }
  }
}

/** Reads every match concurrently, preserving discovery order. */
export async function readAll<T>(
  patterns: string[],
  read: (path: string) => Promise<T>,
): Promise<T[]> {
  const paths = await Array.fromAsync(assetPaths(patterns));
  return Promise.all(paths.map(read));
}

export function scopeOf(path: string): Scope {
  if (path.startsWith("plugins/")) return "plugin";
  if (path.startsWith("user/")) return "user";
  return "project";
}

export function origin(path: string): { scope: Scope; path: string; plugin?: string } {
  const plugin = path.startsWith("plugins/") ? path.split("/")[1] : undefined;
  return { scope: scopeOf(path), path, ...(plugin ? { plugin } : {}) };
}

/**
 * The name a skill is reachable by, which `Skill()` grants have to match.
 *
 * Frontmatter wins. Derivation covers the rest: a plugin skill namespaces as
 * `<plugin>:<skill>`, collapsing to `<plugin>` for the entry-skill pattern
 * where the two match. User and project skills carry no namespace.
 */
export function skillName(path: string, frontmatterName?: string): string {
  if (frontmatterName) return frontmatterName;

  const segments = path.split("/");
  const skill = segments.at(-2) ?? "";
  if (segments[0] !== "plugins") return skill;

  const plugin = segments[1];
  return skill === plugin ? plugin : `${plugin}:${skill}`;
}
