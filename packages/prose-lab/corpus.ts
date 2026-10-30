import { join, relative } from "node:path";
import { $ } from "bun";
import { lint } from "../../plugins/prompting/skills/scan/scripts/vale";
import { type Corpus, DOCS, entries, type Hit, type Sweep } from "./data";

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

export async function corpusFiles(corpus: Corpus, root = ROOT, docs = DOCS): Promise<string[]> {
  const out = await $`git -C ${root} ls-files -- ${[...CORPORA[corpus], ...SAMPLES]}`.text();
  // Snapshots are gitignored, so ls-files never lists them.
  const reviewed = (await entries(docs))
    .filter((name) => name.endsWith(".md"))
    .map((name) => relative(root, join(docs, name)));
  return [...out.split("\n").filter(Boolean), ...reviewed];
}

/** Words outside fenced code, the denominator for a per-1,000-word rate. */
export function countWords(text: string): number {
  return text
    .replaceAll(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

export async function lintFiles(
  plugin: string,
  config: string,
  files: readonly string[],
  root = ROOT,
): Promise<Hit[]> {
  const alerts = await lint(
    files.map((file) => join(root, file)),
    { config },
  );
  return [...alerts].flatMap(([path, found]) =>
    found.map((alert) => ({
      plugin,
      check: alert.Check,
      severity: alert.Severity,
      message: alert.Message,
      file: relative(root, path),
      line: alert.Line,
      span: alert.Span,
      match: alert.Match,
    })),
  );
}

export async function sweep(
  corpus: Corpus,
  plugins: readonly Plugin[],
  root = ROOT,
): Promise<Sweep> {
  const files = await corpusFiles(corpus, root);
  const [rev, hits, words] = await Promise.all([
    $`git -C ${root} rev-parse --short HEAD`.text(),
    Promise.all(plugins.map((plugin) => lintFiles(plugin, PLUGINS[plugin], files, root))),
    Promise.all(files.map(async (file) => countWords(await Bun.file(join(root, file)).text()))),
  ]);
  return {
    corpus,
    rev: rev.trim(),
    words: words.reduce((a, b) => a + b, 0),
    hits: hits.flat(),
  };
}
