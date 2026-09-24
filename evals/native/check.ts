#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { cli } from "cleye";
import { parse } from "yaml";
import { z } from "zod";
import { traceReply } from "./load";

export const RegexGrader = z.object({
  type: z.literal("regex"),
  pattern: z.string(),
  flags: z.string().default(""),
  match: z
    .union([z.enum(["contains", "not_contains"]), z.string().regex(/^count:\d+$/)])
    .default("contains"),
  target: z.unknown().optional(),
});
const Grader = z.union([RegexGrader, z.object({ type: z.string() })]);
const Example = z.object({ fail: z.array(z.string()).default([]) });

export type Graders = Map<string, z.output<typeof Grader>>;

/** A run as the runner recorded it: the final reply and, when kept, the raw trace JSONL. */
export interface Recorded {
  reply: string;
  trace?: string | undefined;
}

/** Splits a markdown file into its YAML frontmatter and body. */
function frontmatter(text: string): [unknown, string] {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  return match === null ? [{}, text] : [parse(match[1] ?? "") ?? {}, text.slice(match[0].length)];
}

export interface Mismatch {
  example: string;
  grader: string;
  expected: "pass" | "fail";
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
  return undefined;
}

/**
 * Grades a recorded run with a regex grader, matching a trace grader against the raw trace
 * JSONL as the runner does. Returns undefined for a grader that is not a regex, or whose
 * target the run does not record, such as a file in the session's working directory.
 */
export function verdict(grader: z.output<typeof Grader>, run: Recorded): boolean | undefined {
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
      return [basename(file, ".md"), Grader.parse(grader)] as const;
    }),
  );
  return new Map(graders);
}

/** Reads an example as a recorded run with the graders it must fail. */
async function readExample(path: string): Promise<[Recorded, string[]]> {
  const text = await Bun.file(path).text();
  if (extname(path) === ".md") {
    const [meta, reply] = frontmatter(text);
    return [{ reply }, Example.parse(meta).fail];
  }
  const sidecar = Bun.file(path.replace(/\.jsonl$/, ".yaml"));
  const meta: unknown = (await sidecar.exists()) ? parse(await sidecar.text()) : {};
  return [{ reply: traceReply(text) ?? "", trace: text }, Example.parse(meta ?? {}).fail];
}

export interface Checked {
  mismatches: Mismatch[];
  /** Regex graders, as `<case>/<grader>`, that no example could grade. */
  unchecked: string[];
}

/**
 * Runs every case's regex graders against the examples in `<suite>/examples/<case>/`. A `.md`
 * example is a hand-written reply whose frontmatter `fail:` lists the graders it must fail. A
 * `.jsonl` example is a trace, such as one copied from a run's `traces/`, graded on its raw
 * text and its last `result` line, with `fail:` in a sibling `.yaml`. Every other grader the
 * example can reach must pass it.
 */
export async function check(suite: string): Promise<Checked> {
  const examples = ["md", "jsonl"].flatMap((ext) =>
    globSync(`examples/*/*.${ext}`, { cwd: suite }),
  );
  const cases = [...new Set(examples.map((e) => basename(dirname(e))))];
  const graders = new Map(
    await Promise.all(cases.map(async (c) => [c, await loadGraders(join(suite, c))] as const)),
  );
  const reached = new Set<string>();
  const results = await Promise.all(
    examples.map(async (example) => {
      const name = basename(dirname(example));
      const [run, fail] = await readExample(join(suite, example));
      const known: Graders = graders.get(name) ?? new Map();
      const unknown = fail.filter((g) => !known.has(g));
      if (unknown.length > 0)
        throw new Error(`${example} names unknown graders: ${unknown.join(", ")}`);
      return [...known].flatMap(([g, grader]): Mismatch[] => {
        const passed = verdict(grader, run);
        if (passed === undefined) return [];
        reached.add(`${name}/${g}`);
        const expected = fail.includes(g) ? "fail" : "pass";
        return passed === (expected === "pass") ? [] : [{ example, grader: g, expected }];
      });
    }),
  );
  const unchecked = [...graders].flatMap(([c, known]) =>
    [...known]
      .filter(([g, grader]) => grader.type === "regex" && !reached.has(`${c}/${g}`))
      .map(([g]) => `${c}/${g}`),
  );
  return { mismatches: results.flat(), unchecked: unchecked.toSorted() };
}

if (import.meta.main) {
  const argv = cli({
    name: "check.ts",
    parameters: ["<suite>"],
    help: {
      description:
        "Test a suite's regex graders against the examples in <suite>/examples/<case>/ before spending runs on them: hand-written replies as .md with a frontmatter `fail:` list, and traces as .jsonl with `fail:` in a sibling .yaml. Every grader an example can reach must pass it unless listed.",
    },
  });
  const { mismatches, unchecked } = await check(argv._.suite);
  for (const m of mismatches) console.log(`${m.example}: ${m.grader} should ${m.expected}`);
  if (unchecked.length > 0) console.log(`No example reaches: ${unchecked.join(", ")}`);
  if (mismatches.length > 0) process.exit(1);
  console.log("Every regex grader agrees with its examples.");
}
