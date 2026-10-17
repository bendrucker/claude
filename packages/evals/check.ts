import { globSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  caseGraders,
  frontmatter,
  type Graders,
  type Recorded,
  sharedFor,
  verdict,
} from "./graders";
import { readSuite } from "./suite";
import { traceReply } from "./trace";

const Example = z.object({ fail: z.array(z.string()).default([]) });

export interface Mismatch {
  example: string;
  grader: string;
  expected: "pass" | "fail";
}

/** Reads every file under a directory by relative path, or undefined when there is none. */
async function readFiles(dir: string): Promise<Map<string, string> | undefined> {
  // `**/*` skips dotfiles, which a file-target grader may read, such as `.eval-verdicts`.
  const entries = globSync(["**/*", "**/.*"], { cwd: dir, withFileTypes: true }).filter((e) =>
    e.isFile(),
  );
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
  /** Cases whose `prompt.md` would send the session nothing, such as a blank or `undefined` body. */
  prompts: string[];
  /** Case graders that hide one `suite.yaml` shares in, from {@link shadowed}. */
  shadowed: string[];
  /** Graders whose frontmatter the runner would cut short, from {@link earlyClose}. */
  earlyClose: string[];
}

/**
 * Cases in a suite whose `prompt.md` is blank or the text of a missing value, such as
 * `undefined` from a generator that interpolated a field the case lacked. The runner sends the
 * body as the prompt, so the session would answer that text instead of the case.
 */
export async function emptyPrompts(suite: string): Promise<string[]> {
  const cases = globSync("*/case.yaml", { cwd: suite }).map((f) => dirname(f));
  const bad = await Promise.all(
    cases.map(async (c) => {
      const file = Bun.file(join(suite, c, "prompt.md"));
      if (!(await file.exists())) return [];
      return /^(undefined|null)?$/.test((await file.text()).trim()) ? [c] : [];
    }),
  );
  return bad.flat().toSorted();
}

/**
 * Grader files in a suite, relative to it, whose frontmatter holds a `---` before its closing
 * line. The runner ends frontmatter at the first `---` anywhere, even mid-line, so such a
 * grader fails to load as invalid YAML and takes every case that reaches it down with it.
 * Write a literal run of dashes in a pattern as `-{3}`.
 */
export async function earlyClose(suite: string): Promise<string[]> {
  const files = globSync(["graders/*.md", "*/graders/*.md"], { cwd: suite });
  const bad = await Promise.all(
    files.map(async (f) => {
      const text = await Bun.file(join(suite, f)).text();
      const match = /^---\n([\s\S]*?)\n---/.exec(text);
      if (match === null) return [];
      return text.indexOf("---", 3) === match[0].length - 3 ? [] : [f];
    }),
  );
  return bad.flat().toSorted();
}

/** Case graders, as `<case>/<grader>`, that hide a grader `suite.yaml` shares into the case. */
export async function shadowed(suite: string): Promise<string[]> {
  const shared = (await readSuite(suite)).graders;
  return globSync("*/case.yaml", { cwd: suite })
    .map(dirname)
    .flatMap((name) => {
      const own = new Set(
        globSync("graders/*.md", { cwd: join(suite, name) }).map((f) => basename(f, ".md")),
      );
      return sharedFor(shared, name)
        .filter((g) => own.has(g))
        .map((g) => `${name}/${g}`);
    })
    .toSorted();
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
  return {
    mismatches: results.flat(),
    unchecked: unchecked.toSorted(),
    prompts: await emptyPrompts(suite),
    shadowed: await shadowed(suite),
    earlyClose: await earlyClose(suite),
  };
}
