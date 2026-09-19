import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// herdr agent names are `^[a-z][a-z0-9_-]{0,31}$`, and `lead-` takes five of those.
const LEAD_SLUG = /^[a-z][a-z0-9_-]{0,26}$/;

const Frontmatter = z.looseObject({
  name: z.string(),
  description: z.string(),
  repo: z.string().optional(),
  tracker: z.string().optional(),
  lead: z.string().optional(),
});

export interface Project extends z.infer<typeof Frontmatter> {
  slug: string;
}

export function projectsDir(dataDir: string): string {
  return join(dataDir, "projects");
}

export function leadName(slug: string): string {
  return `lead-${slug}`;
}

// `project.md` is shaped like a skill: frontmatter carries the routing line, the
// body carries the standing instructions, and only the frontmatter is read here.
export function parseProject(slug: string, text: string): Project {
  if (!LEAD_SLUG.test(slug))
    throw new Error(`projects/${slug}: slug must match ${LEAD_SLUG} to name a lead-${slug} agent`);
  const [node] = fromMarkdown(text, {
    extensions: [frontmatter("yaml")],
    mdastExtensions: [frontmatterFromMarkdown("yaml")],
  }).children;
  if (node?.type !== "yaml") throw new Error(`projects/${slug}/project.md has no frontmatter`);
  return { slug, ...Frontmatter.parse(parseYaml(node.value) ?? {}) };
}

export async function readProjects(
  dataDir: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<Project[]> {
  const root = projectsDir(dataDir);
  let slugs: string[];
  try {
    slugs = readdirSync(root);
  } catch {
    return [];
  }
  const read = await Promise.all(
    slugs
      .toSorted((a, b) => a.localeCompare(b))
      .map(async (slug) => {
        const file = Bun.file(join(root, slug, "project.md"));
        return (await file.exists()) ? { slug, path: file.name, text: await file.text() } : null;
      }),
  );
  const projects: Project[] = [];
  for (const entry of read) {
    if (entry == null) continue;
    try {
      projects.push(parseProject(entry.slug, entry.text));
    } catch (error) {
      warn(`${entry.path}: ${error instanceof Error ? error.message : String(error)}, skipped`);
    }
  }
  return projects;
}
