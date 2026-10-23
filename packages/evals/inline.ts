import { globSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import type { Link } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";

const NOTE = "Every file this skill links is appended below under its path.";

/** Relative markdown link targets in `text`, resolved against `file`'s directory. */
function linked(file: string, text: string): string[] {
  const urls: string[] = [];
  visit(fromMarkdown(text), "link", (node: Link) => {
    urls.push(node.url);
  });
  return urls
    .filter((url) => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url))
    .map((url) => normalize(join(dirname(file), url.replace(/#.*$/, ""))))
    .filter((target) => target.endsWith(".md"));
}

/**
 * Appends every markdown file a skill links, directly or through another linked file, to the
 * skill body. Paths are relative to `skills/`, and `read` returns undefined for a missing file.
 */
export async function inline(
  skill: string,
  text: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<string> {
  const self = join(skill, "SKILL.md");
  const seen = new Set([self]);
  const sections: string[] = [];
  const walk = async (level: string[]): Promise<void> => {
    const fresh = [...new Set(level)].filter((t) => !seen.has(t) && !t.startsWith(".."));
    if (fresh.length === 0) return;
    for (const t of fresh) seen.add(t);
    const bodies = await Promise.all(fresh.map(read));
    const next: string[] = [];
    for (const [i, body] of bodies.entries()) {
      const target = fresh[i] ?? "";
      if (body === undefined) continue;
      sections.push(`## \`${relative(skill, target)}\`\n\n${body.trimEnd()}`);
      next.push(...linked(target, body));
    }
    await walk(next);
  };
  await walk(linked(self, text));
  if (sections.length === 0) return text;
  const close = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
  const at = close === -1 ? 0 : close + "\n---\n".length;
  const head = text.slice(0, at);
  const rest = text.slice(at).replace(/^\n/, "");
  return `${head}${at === 0 ? "" : "\n"}${NOTE}\n\n${rest.trimEnd()}\n\n${sections.join("\n\n")}\n`;
}

/** Applies `inline` to every staged `skills/<name>/SKILL.md` in a plugin tree. */
export async function inlineSkills(root: string): Promise<void> {
  const skills = globSync("{skills,*/skills}/*/SKILL.md", { cwd: root });
  await Promise.all(
    skills.map(async (f) => {
      const base = join(root, dirname(dirname(f)));
      const path = join(root, f);
      const read = async (p: string) => {
        const file = Bun.file(join(base, p));
        return (await file.exists()) ? file.text() : undefined;
      };
      await Bun.write(
        path,
        await inline(dirname(f).split("/").at(-1) ?? "", await Bun.file(path).text(), read),
      );
    }),
  );
}
