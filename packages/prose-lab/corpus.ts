import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { $ } from "bun";
import { lint } from "../vale-runner/index";
import { type Corpus, DOCS, entries, type Hit, hitId, type Sweep } from "./data";
import { wideConfig } from "./score";

export const ROOT = join(import.meta.dirname, "..", "..");

export const PLUGINS = {
  prompting: join(ROOT, "plugins", "prompting", ".vale.ini"),
  writing: join(ROOT, "plugins", "writing", ".vale.ini"),
} as const;
export type Plugin = keyof typeof PLUGINS;

const SKILLS = [":(glob)**/SKILL.md", ":(glob)**/skills/*/references/**/*.md"];

export const CORPORA = {
  skills: SKILLS,
  "agent-facing": [
    ...SKILLS,
    ":(glob)**/CLAUDE.md",
    ":(glob)**/AGENTS.md",
    ":(glob)**/.claude/agents/**/*.md",
    ":(glob)**/.claude/commands/**/*.md",
    ":(glob)**/.claude/rules/**/*.md",
    ":(glob)**/prompt/**/*.md",
    ":(glob)**/prompts/**/*.md",
  ],
  all: [":(glob)**/*.md"],
} as const satisfies Record<Corpus, readonly string[]>;

const SAMPLES = [
  ":(exclude,glob)**/fixtures/**",
  ":(exclude,glob)**/__snapshots__/**",
  ":(exclude,glob)**/evals/**",
];

/** Other checkouts' roots by name. Their files carry the name as a prefix, `name:path`. */
export type Repos = Readonly<Record<string, string>>;

export function filePath(file: string, repos: Repos = {}, root = ROOT): string {
  const at = file.indexOf(":");
  const repo = at > 0 ? repos[file.slice(0, at)] : undefined;
  return repo === undefined ? join(root, file) : join(repo, file.slice(at + 1));
}

async function toplevel(path: string): Promise<string> {
  return (await $`git -C ${path} rev-parse --show-toplevel`.text()).trim();
}

/** Each path's checkout root, named by its directory, rejecting this repo and duplicate names. */
export async function checkouts(paths: readonly string[], root = ROOT): Promise<Repos> {
  const [self, ...tops] = await Promise.all([root, ...paths].map(toplevel));
  const repos: Record<string, string> = {};
  for (const [index, repo] of tops.entries()) {
    const name = basename(repo);
    if (repo === self) throw new Error(`${paths[index]} is this repo, which every sweep covers.`);
    if (name in repos) throw new Error(`Two checkouts are named ${name}.`);
    repos[name] = repo;
  }
  return repos;
}

async function tracked(corpus: Corpus, root: string): Promise<string[]> {
  const out = await $`git -C ${root} ls-files -- ${[...CORPORA[corpus], ...SAMPLES]}`.text();
  return out.split("\n").filter(Boolean);
}

export interface CorpusOptions {
  root?: string;
  docs?: string;
  repos?: Repos;
}

export async function corpusFiles(
  corpus: Corpus,
  { root = ROOT, docs = DOCS, repos = {} }: CorpusOptions = {},
): Promise<string[]> {
  // Snapshots are gitignored, so ls-files never lists them.
  const reviewed = (await entries(docs))
    .filter((name) => name.endsWith(".md"))
    .map((name) => relative(root, join(docs, name)));
  const others = await Promise.all(
    Object.entries(repos).map(async ([name, repo]) =>
      (await tracked(corpus, repo)).map((file) => `${name}:${file}`),
    ),
  );
  return [...(await tracked(corpus, root)), ...reviewed, ...others.flat()];
}

/** Words outside fenced code, the denominator for a per-1,000-word rate. */
export function countWords(text: string): number {
  return text
    .replaceAll(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

export async function markdownUnder(dir: string, root = ROOT): Promise<string[]> {
  const names = await readdir(dir, { recursive: true });
  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => relative(root, join(dir, name)));
}

export async function lintFiles(
  plugin: string,
  config: string,
  files: readonly string[],
  root = ROOT,
  repos: Repos = {},
): Promise<Hit[]> {
  const paths = new Map(files.map((file) => [filePath(file, repos, root), file]));
  const alerts = await lint([...paths.keys()], {
    config,
    onSkip: (path) => {
      console.error(`Skipped ${paths.get(path) ?? path}: vale could not lint it.`);
    },
  });
  return [...alerts].flatMap(([path, found]) =>
    found.map((alert) => ({
      plugin,
      check: alert.Check,
      severity: alert.Severity,
      message: alert.Message,
      file: paths.get(path) ?? relative(root, path),
      line: alert.Line,
      span: alert.Span,
      match: alert.Match,
    })),
  );
}

/** The wide config's hits, each marked by whether the plugin's own config fires it too. */
export function markShipped(own: Hit[], wide: Hit[]): Hit[] {
  const ids = new Set(own.map(hitId));
  const found = new Set(wide.map(hitId));
  return [
    ...wide.map((hit) => Object.assign(hit, { shipped: ids.has(hitId(hit)) })),
    ...own
      .filter((hit) => !found.has(hitId(hit)))
      .map((hit) => Object.assign(hit, { shipped: true })),
  ];
}

export async function corpusHits(
  hits: readonly Hit[],
  corpus: Corpus,
  options: CorpusOptions = {},
): Promise<Hit[]> {
  const files = new Set(await corpusFiles(corpus, options));
  return hits.filter((hit) => files.has(hit.file));
}

export interface SweepOptions extends CorpusOptions {
  wide?: boolean | undefined;
}

export async function sweep(
  corpus: Corpus,
  plugins: readonly Plugin[],
  { root = ROOT, docs = DOCS, repos = {}, wide = false }: SweepOptions = {},
): Promise<Sweep> {
  const files = await corpusFiles(corpus, { root, docs, repos });
  const lintPlugin = async (plugin: Plugin): Promise<Hit[]> => {
    const own = lintFiles(plugin, PLUGINS[plugin], files, root, repos);
    if (!wide) return own;
    const config = await wideConfig(PLUGINS[plugin]);
    return markShipped(await own, await lintFiles(plugin, config, files, root, repos));
  };
  const [rev, hits, words] = await Promise.all([
    $`git -C ${root} rev-parse --short HEAD`.text(),
    Promise.all(plugins.map(lintPlugin)),
    Promise.all(
      files.map(async (file) => countWords(await Bun.file(filePath(file, repos, root)).text())),
    ),
  ]);
  return {
    corpus,
    rev: rev.trim(),
    words: words.reduce((a, b) => a + b, 0),
    hits: hits.flat(),
    plugins: [...plugins],
    repos: { ...repos },
  };
}
