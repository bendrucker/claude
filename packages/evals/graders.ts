import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { $ } from "bun";
import { parse } from "yaml";
import { z } from "zod";
import { listCases } from "./layout";
import { readSuite } from "./suite";

export const RegexGrader = z.object({
  type: z.literal("regex"),
  pattern: z.string(),
  flags: z.string().default(""),
  match: z
    .union([z.enum(["contains", "not_contains"]), z.string().regex(/^count:\d+$/)])
    .default("contains"),
  target: z.unknown().optional(),
  weight: z.number().default(1),
  arm: z.enum(["both", "with-only"]).default("both"),
});
export const GraderFile = z.union([RegexGrader, z.object({ type: z.string() })]);
export type GraderFile = z.output<typeof GraderFile>;

export type Graders = Map<string, GraderFile>;

/** A run as the runner recorded it: the final reply and, when kept, the raw trace JSONL. */
export interface Recorded {
  reply: string;
  trace?: string | undefined;
  /** File contents by path, standing in for the session's working directory after the run. */
  files?: Map<string, string> | undefined;
}

const FileTarget = z.object({ source: z.literal("file"), path: z.string() });

/** Splits a markdown file into its YAML frontmatter and body. */
export function frontmatter(text: string): [unknown, string] {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  return match === null ? [{}, text] : [parse(match[1] ?? "") ?? {}, text.slice(match[0].length)];
}

/** Whether a regex grader passes on a text. */
export function passes(grader: z.output<typeof RegexGrader>, text: string): boolean {
  if (grader.match.startsWith("count:")) {
    const flags = grader.flags.includes("g") ? grader.flags : `${grader.flags}g`;
    return text.match(new RegExp(grader.pattern, flags))?.length === Number(grader.match.slice(6));
  }
  const found = new RegExp(grader.pattern, grader.flags).test(text);
  return found === (grader.match === "contains");
}

function recordedText(target: unknown, run: Recorded): string | undefined {
  if (target === undefined || target === "last_message") return run.reply;
  if (target === "trace") return run.trace;
  const file = FileTarget.safeParse(target);
  return file.success ? run.files?.get(file.data.path) : undefined;
}

/**
 * Grades a recorded run with a regex grader, matching a trace grader against the raw trace
 * JSONL as the runner does. Returns undefined for a grader that is not a regex, or whose
 * target the run does not record, such as a file with no example directory holding it.
 */
export function verdict(grader: GraderFile, run: Recorded): boolean | undefined {
  const parsed = RegexGrader.safeParse(grader);
  if (!parsed.success) return undefined;
  const text = recordedText(parsed.data.target, run);
  return text === undefined ? undefined : passes(parsed.data, text);
}

/** Loads a case's graders by name. */
export async function loadGraders(caseDir: string): Promise<Graders> {
  const files = globSync("graders/*.md", { cwd: caseDir });
  const graders = await Promise.all(
    files.map(async (file) => {
      const [grader] = frontmatter(await Bun.file(join(caseDir, file)).text());
      return [basename(file, ".md"), GraderFile.parse(grader)] as const;
    }),
  );
  return new Map(graders);
}

/** Grader name to the case-name globs it joins, as `suite.yaml` declares them. */
export type SharedGraders = Record<string, string[]>;

/** The suite-level graders whose globs match a case name. */
export function sharedFor(shared: SharedGraders, name: string): string[] {
  return Object.entries(shared)
    .filter(([, globs]) => globs.some((g) => new Bun.Glob(g).match(name)))
    .map(([grader]) => grader);
}

/** Loads a case's graders by name, with the suite-level graders `suite.yaml` shares into it. */
export async function caseGraders(suite: string, name: string): Promise<Graders> {
  const shared = sharedFor((await readSuite(suite)).graders, name);
  const inherited = [...(await loadGraders(suite))].filter(([g]) => shared.includes(g));
  return new Map([...inherited, ...(await loadGraders(join(suite, name)))]);
}

/**
 * Copies each grader in `<suite>/graders/` into every case its globs match, unless the case
 * holds a grader by that name, then removes `<suite>/graders/` so the runner never reads it as
 * a case.
 */
export async function shareGraders(suite: string, shared: SharedGraders): Promise<void> {
  const cases = await listCases(suite);
  const copies = cases.flatMap((name) =>
    sharedFor(shared, name).map(async (grader) => {
      const dest = Bun.file(join(suite, name, "graders", `${grader}.md`));
      if (await dest.exists()) return;
      const source = Bun.file(join(suite, "graders", `${grader}.md`));
      if (!(await source.exists())) throw new Error(`suite.yaml names a missing grader: ${grader}`);
      await Bun.write(dest, await source.text());
    }),
  );
  await Promise.all(copies);
  await $`rm -rf ${join(suite, "graders")}`.quiet();
}
