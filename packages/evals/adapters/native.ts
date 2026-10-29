import { basename, dirname, join, relative, resolve } from "node:path";
import { $ } from "bun";
import type { Adapter, Transcript } from "../adapter";
import { listTraces, resultPath, tracePath } from "../layout";
import { regrade } from "../regrade";
import { erroredRuns, readResult } from "../result";
import { collectTraces, keepCases, pluginErrors, prepare, sessionEnv, splitCases } from "../run";
import { scoreSuite } from "../score";
import { loadTags, readSuite } from "../suite";
import { calls, type Measured, traceMeasures, traceReply } from "../trace";

async function measure(path: string): Promise<Measured> {
  const file = Bun.file(path);
  return (await file.exists()) ? traceMeasures(await file.text()) : {};
}

/** A results directory, from itself or the `aggregate-result.json` inside it. */
const resultsDir = (path: string) => (path.endsWith(".json") ? dirname(path) : path);

/** `claude plugin eval`: `aggregate-result.json` plus a `traces/` transcript per run. */
export const native: Adapter = {
  name: "native",

  async run(suiteArg, { ref, label, args: passed }) {
    const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
    const suite = relative(repo, resolve(suiteArg));
    const config = await readSuite(join(repo, suite));
    const [globs, args] = splitCases(passed);
    const { target, evalDir } = await prepare(repo, suite, ref);
    if (globs.length > 0) await keepCases(join(target, evalDir), globs);
    const stamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d+Z$/, "Z");
    const suffix = label ?? ref?.replaceAll("/", "-");
    const output = join(
      repo,
      suite,
      "results",
      suffix === undefined ? stamp : `${stamp}-${suffix}`,
    );
    const allow = config.allow_tools.length > 0 ? ["--allow-tools", ...config.allow_tools] : [];

    // An API key in the environment would bill the API instead of the subscription.
    const proc = Bun.spawn(
      [
        "claude",
        "plugin",
        "eval",
        target,
        "--eval-dir",
        evalDir,
        "--scaffold",
        "--trust-plugin",
        "--judge-model",
        config.judge_model,
        "--output-dir",
        output,
        "--keep-temp",
        ...allow,
        ...args,
      ],
      { env: sessionEnv(), stdio: ["inherit", "inherit", "inherit"] },
    );
    const code = await proc.exited;
    await collectTraces(output, config.collect);
    await $`rm -rf ${dirname(target)}`.quiet();
    if (await Bun.file(resultPath(output)).exists()) await scoreSuite(join(repo, suite), output);
    const loadErrors = await pluginErrors(output);
    if (loadErrors.length > 0)
      throw new Error(
        [
          `${loadErrors.length} plugin errors at session start, so those arms ran without the plugin:`,
          ...loadErrors.map((e) => `  ${e}`),
        ].join("\n"),
      );
    // The runner fails on a run that ended on an API error, which it leaves ungraded. A run it
    // graded despite an error, such as a timeout or a judge call that threw, exits clean.
    const result = resultPath(output);
    const errors = (await Bun.file(result).exists())
      ? erroredRuns(await readResult(result)).filter((e) => e.graded)
      : [];
    if (errors.length > 0)
      throw new Error(
        [
          `${errors.length} runs errored, and compare.ts leaves them out:`,
          ...errors.map((e) => `  ${e.label}`),
        ].join("\n"),
      );
    if (code !== 0) throw new Error(`claude plugin eval exited ${code}, results in ${output}`);
    return result;
  },

  async read(path) {
    const result = await readResult(path);
    const keyed = result.cases.flatMap((c) =>
      Object.entries(c.arms).map(async ([arm, runs]) => {
        const measured = await Promise.all(
          runs.map((_, i) => measure(tracePath(dirname(path), c.name, arm, i))),
        );
        return [`${c.name}/${arm}`, measured] as const;
      }),
    );
    return { result, measured: new Map(await Promise.all(keyed)) };
  },

  tags: loadTags,

  async rescore(suite, path) {
    const dir = resultsDir(path);
    const out = join(dirname(dir), `${basename(dir)}-regraded`);
    return { path: out, flips: await regrade(suite, dir, out) };
  },

  // Throws on a result with no traces, which would otherwise read as no session making a call.
  async traces(path) {
    const dir = resultsDir(path);
    const found = listTraces(dir);
    if (found.length === 0) throw new Error(`No traces/*.jsonl in ${dir}`);
    const read = await Promise.all(
      found.map(async (ref) => [ref, await Bun.file(ref.path).text()] as const),
    );
    const cells = new Map<string, Transcript[]>();
    for (const [ref, text] of read) {
      if (ref.arm !== "with" && ref.arm !== "without") continue;
      const key = `${ref.case}/${ref.arm}`;
      const runs = cells.get(key) ?? [];
      runs[ref.n] = { reply: traceReply(text), calls: calls(text) };
      cells.set(key, runs);
    }
    return cells;
  },

  label: (path) => basename(dirname(path)),
};
