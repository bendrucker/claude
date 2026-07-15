import { join, posix, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { githubBlobUrl, repoPathToRoute } from "../data/routes";
import { withBase } from "./base";

function isRewritableHref(href: string): boolean {
  return (
    href.length > 0 &&
    !href.startsWith("#") &&
    !href.startsWith("mailto:") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
    !href.startsWith("//")
  );
}

/**
 * Resolves a README's relative link against the README's own repo-relative
 * path, then maps the result to a site route or, when the target has no page
 * of its own (skills, references, scripts, ...), a GitHub blob URL.
 */
function resolveRepoLink(sourceRepoPath: string, href: string): string {
  const [rawPath, hash = ""] = href.split("#");
  const suffix = hash ? `#${hash}` : "";

  const targetRepoPath = rawPath.startsWith("/")
    ? rawPath.slice(1)
    : posix.normalize(posix.join(posix.dirname(sourceRepoPath), rawPath));

  const route = repoPathToRoute(targetRepoPath);
  return (route ? withBase(route) : githubBlobUrl(targetRepoPath)) + suffix;
}

function rehypeRewriteRepoLinks(repoRoot: string) {
  return (tree: Root, file: VFile) => {
    const sourceRepoPath = relative(repoRoot, String(file.path)).split(sep).join("/");

    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties.href;
      if (typeof href !== "string" || !isRewritableHref(href)) return;
      node.properties.href = resolveRepoLink(sourceRepoPath, href);
    });
  };
}

const processors = new Map<string, Promise<Awaited<ReturnType<typeof createMarkdownProcessor>>>>();

/**
 * A shiki-backed processor per repo root. Building one loads the syntax
 * highlighter, so they are cached rather than rebuilt per render, but the root
 * is baked into the link-rewriting plugin and so has to key the cache.
 */
function getProcessor(repoRoot: string) {
  let processor = processors.get(repoRoot);
  if (!processor) {
    processor = createMarkdownProcessor({
      syntaxHighlight: "shiki",
      shikiConfig: {
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      },
      rehypePlugins: [() => rehypeRewriteRepoLinks(repoRoot)],
    });
    processors.set(repoRoot, processor);
  }
  return processor;
}

/** Renders a plugin's README to HTML, with every relative link resolved to a site route or GitHub blob URL. */
export async function renderReadme(repoRoot: string, readmePath: string): Promise<string> {
  const absPath = join(repoRoot, readmePath);
  const source = await Bun.file(absPath).text();
  const render = await getProcessor(repoRoot);
  const result = await render.render(source, { fileURL: pathToFileURL(absPath) });
  return result.code;
}
