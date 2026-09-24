#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { cli } from "cleye";
import { parse } from "yaml";
import { z } from "zod";

const RegexGrader = z.object({
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

/** Whether a regex grader passes on a reply. */
export function passes(grader: z.output<typeof RegexGrader>, reply: string): boolean {
  if (grader.match.startsWith("count:")) {
    const flags = grader.flags.includes("g") ? grader.flags : `${grader.flags}g`;
    return reply.match(new RegExp(grader.pattern, flags))?.length === Number(grader.match.slice(6));
  }
  const found = new RegExp(grader.pattern, grader.flags).test(reply);
  return found === (grader.match === "contains");
}

/**
 * Runs every case's reply-targeted regex graders against the hand-written replies in
 * `<suite>/examples/<case>/*.md`. An example's frontmatter lists the graders it must fail,
 * and every other such grader must pass it.
 */
export async function check(suite: string): Promise<Mismatch[]> {
  const examples = globSync("examples/*/*.md", { cwd: suite });
  const results = await Promise.all(
    examples.map(async (example) => {
      const name = basename(dirname(example));
      const [meta, reply] = frontmatter(await Bun.file(join(suite, example)).text());
      const { fail } = Example.parse(meta);
      const files = globSync("graders/*.md", { cwd: join(suite, name) });
      const graders = await Promise.all(
        files.map(async (file) => {
          const [grader] = frontmatter(await Bun.file(join(suite, name, file)).text());
          return [basename(file, ".md"), Grader.parse(grader)] as const;
        }),
      );
      const known = new Set(graders.map(([g]) => g));
      const unknown = fail.filter((g) => !known.has(g));
      if (unknown.length > 0)
        throw new Error(`${example} names unknown graders: ${unknown.join(", ")}`);
      return graders.flatMap(([g, grader]): Mismatch[] => {
        const parsed = RegexGrader.safeParse(grader);
        if (!parsed.success || parsed.data.target !== undefined) return [];
        const expected = fail.includes(g) ? "fail" : "pass";
        return passes(parsed.data, reply) === (expected === "pass")
          ? []
          : [{ example, grader: g, expected }];
      });
    }),
  );
  return results.flat();
}

if (import.meta.main) {
  const argv = cli({
    name: "check.ts",
    parameters: ["<suite>"],
    help: {
      description:
        "Test a suite's regex graders against hand-written replies in <suite>/examples/<case>/*.md before spending runs on them. An example's frontmatter `fail:` lists the graders it must fail; every other reply-targeted regex grader must pass it.",
    },
  });
  const mismatches = await check(argv._.suite);
  for (const m of mismatches) console.log(`${m.example}: ${m.grader} should ${m.expected}`);
  if (mismatches.length > 0) process.exit(1);
  console.log("Every regex grader agrees with its examples.");
}
