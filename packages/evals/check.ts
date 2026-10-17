import { globSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { caseGraders, frontmatter, type Graders, type Recorded, verdict } from "./graders";
import { traceReply } from "./trace";

const Example = z.object({ fail: z.array(z.string()).default([]) });

export interface Mismatch {
  example: string;
  grader: string;
  expected: "pass" | "fail";
}

/** Reads every file under a directory by relative path, or undefined when there is none. */
async function readFiles(dir: string): Promise<Map<string, string> | undefined> {
  const entries = globSync("**/*", { cwd: dir, withFileTypes: true }).filter((e) => e.isFile());
  if (entries.length === 0) return undefined;
  const read = entries.map(async (e) => {
    const path = join(e.parentPath, e.name);
    return [relative(dir, path), await Bun.file(path).text()] as const;
  });
  return new Map(await Promise.all(read));
}

/** Reads an example as a recorded run with the graders it must fail. */
async function readExample(path: string): Promise<[Recorded, string[]]> {
  const text = await Bun.file(path).text();
  const files = await readFiles(path.slice(0, -extname(path).length));
  if (extname(path) === ".md") {
    const [meta, reply] = frontmatter(text);
    return [{ reply, files }, Example.parse(meta).fail];
  }
  const sidecar = Bun.file(path.replace(/\.jsonl$/, ".yaml"));
  const meta: unknown = (await sidecar.exists()) ? parse(await sidecar.text()) : {};
  return [{ reply: traceReply(text) ?? "", trace: text, files }, Example.parse(meta ?? {}).fail];
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
 * text and its last `result` line, with `fail:` in a sibling `.yaml`. A directory beside an
 * example with its name holds the files a file-target grader reads. Every other grader the
 * example can reach must pass it.
 */
export async function check(suite: string): Promise<Checked> {
  const examples = ["md", "jsonl"].flatMap((ext) =>
    globSync(`examples/*/*.${ext}`, { cwd: suite }),
  );
  const cases = [...new Set(examples.map((e) => basename(dirname(e))))];
  const graders = new Map(
    await Promise.all(cases.map(async (c) => [c, await caseGraders(suite, c)] as const)),
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
