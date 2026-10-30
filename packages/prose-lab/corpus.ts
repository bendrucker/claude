import { readdir } from "node:fs/promises";
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

/** Every markdown file under a directory, relative to the repo root. */
export async function markdownUnder(dir: string, root = ROOT): Promise<string[]> {
  const names = await readdir(dir, { recursive: true });
  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => relative(root, join(dir, name)));
}

/** Files per Vale run, since one run over thousands of files fails. */
const LINT_BATCH = 400;

/** Lints in batches, halving a failed batch until the file Vale can't read is skipped. */
export async function lintFiles(
  plugin: string,
  config: string,
  files: readonly string[],
  root = ROOT,
): Promise<Hit[]> {
  if (files.length === 0) return [];
  const split = async (at: number) => [
    ...(await lintFiles(plugin, config, files.slice(0, at), root)),
    ...(await lintFiles(plugin, config, files.slice(at), root)),
  ];
  if (files.length > LINT_BATCH) return split(LINT_BATCH);
  let alerts: Awaited<ReturnType<typeof lint>>;
  try {
    alerts = await lint(
      files.map((file) => join(root, file)),
      { config },
    );
  } catch {
    if (files.length > 1) return split(Math.ceil(files.length / 2));
    console.error(`Skipped ${files[0]}: vale could not lint it.`);
    return [];
  }
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
    plugins: [...plugins],
  };
}
