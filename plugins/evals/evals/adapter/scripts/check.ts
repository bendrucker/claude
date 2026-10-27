import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { type Adapter, resolveAdapter } from "../../../../../packages/evals/adapter";
import { countsDiffer, readTruth, resultCounts, type Truth, truthCounts } from "./truth";

/** One verdict per adapter operation, as the `score` script records it. */
export type Verdicts = Record<string, { passed: boolean; explanation: string }>;

export const GRADERS = ["loads", "read", "tags", "traces", "rescore", "run"] as const;

const suite = join(import.meta.dirname, "..");
const evals = join(suite, "../../../../packages/evals");

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), `adapter-${prefix}-`));

/** A fresh `setup.sh` copy of the framework's project. */
async function project(framework: string): Promise<string> {
  const dest = join(temp("project"), "project");
  await $`bash ${join(suite, "frameworks", framework, "setup.sh")} ${dest}`.quiet();
  return dest;
}

/** A fresh copy of the held run, so an adapter writing beside its input leaves the fixture unchanged. */
async function held(framework: string): Promise<string> {
  const dest = join(temp("held"), "held");
  await $`cp -R ${join(suite, "frameworks", framework, "fixtures/held")} ${dest}`.quiet();
  return dest;
}

type Operation = (adapter: Adapter, truth: Truth, framework: string) => Promise<string | undefined>;

/** Each operation returns a failure reason, or undefined when it passes. */
const OPERATIONS: Record<Exclude<(typeof GRADERS)[number], "loads">, Operation> = {
  async read(adapter, truth, framework) {
    const { result } = await adapter.read(join(await held(framework), truth.result));
    return countsDiffer(truthCounts(truth), resultCounts(result));
  },

  async tags(adapter, truth, framework) {
    const tags = await adapter.tags(await project(framework));
    for (const [name, c] of Object.entries(truth.cases)) {
      const got = tags.get(name);
      const missing = c.tags.filter((t) => !got?.includes(t));
      if (missing.length > 0) return `${name} lacks ${missing.join(", ")}`;
    }
    return undefined;
  },

  async traces(adapter, truth, framework) {
    const traces = await adapter.traces(join(await held(framework), truth.result));
    for (const [name, c] of Object.entries(truth.cases))
      for (const [arm, runs] of Object.entries(c.arms)) {
        const got = traces.get(`${name}/${arm}`)?.map((t) => t.reply?.trim());
        const want = runs.map((r) => r.reply.trim());
        if (JSON.stringify(got) !== JSON.stringify(want))
          return `${name}/${arm}: want ${want.length} replies, got ${got?.length ?? "none"} or different text`;
      }
    return undefined;
  },

  async rescore(adapter, truth, framework) {
    const dir = await project(framework);
    const patch = join(suite, "frameworks", framework, "fixtures/held/rescore.patch");
    await $`git apply ${patch}`.cwd(dir).quiet();
    const outcome = await adapter
      .rescore(dir, join(await held(framework), truth.result))
      .then((r) => ({ flips: r.flips }))
      .catch((error: unknown) => ({ error: String(error) }));
    if (!truth.rescore.supported)
      return "error" in outcome ? undefined : "returned flips for a framework that can't re-score";
    if ("error" in outcome) return `threw: ${outcome.error.split("\n")[0] ?? ""}`;
    const want = truth.rescore.flips;
    if (outcome.flips.length !== want.length)
      return `want ${want.length} flips, got ${outcome.flips.length}`;
    const unmatched = want.find(
      (w) => !outcome.flips.some((f) => f.grader.includes(w.grader) && f.grader.includes(w.case)),
    );
    return unmatched === undefined
      ? undefined
      : `no flip for ${unmatched.case}/${unmatched.grader}`;
  },

  async run(adapter, truth, framework) {
    const dir = await project(framework);
    const log = join(temp("log"), "stub.jsonl");
    process.env.ADAPTER_STUB_LOG = log;
    const path = await adapter.run(dir, { ref: "base", label: "score", args: [] });
    const { result } = await adapter.read(path);
    const differ = countsDiffer(truthCounts(truth), resultCounts(result));
    if (differ !== undefined) return `read after run: ${differ}`;
    const base = (await $`git show base:prompt.txt`.cwd(dir).quiet()).bytes();
    const hash = new Bun.CryptoHasher("sha256").update(base).digest("hex");
    const calls = (await Bun.file(log).exists()) ? await Bun.file(log).text() : "";
    return calls.includes(hash) ? undefined : "the stub never saw the base prompt.txt";
  },
};

/** Grades an adapter module for one framework against its held run. */
export async function check(adapterPath: string, framework: string): Promise<Verdicts> {
  const verdicts: Verdicts = {};
  const fail = (explanation: string) => {
    for (const g of GRADERS) verdicts[g] ??= { passed: false, explanation };
  };
  let adapter: Adapter;
  try {
    adapter = await resolveAdapter(adapterPath);
    verdicts.loads = { passed: true, explanation: "resolveAdapter accepted the module" };
  } catch (error) {
    fail(String(error).split("\n")[0] ?? "");
    return verdicts;
  }
  const truth = await readTruth(join(suite, "frameworks", framework, "fixtures/held"));
  process.env.PATH = `${join(suite, "frameworks", framework, "stub/bin")}:${process.env.PATH ?? ""}`;
  process.env.ADAPTER_FIXTURE = "held";
  const reasons = await Promise.all(
    Object.entries(OPERATIONS).map(async ([name, operation]) => {
      const reason = await operation(adapter, truth, framework).catch(
        (error: unknown) => `threw: ${String(error).split("\n")[0] ?? ""}`,
      );
      return [name, reason] as const;
    }),
  );
  for (const [name, reason] of reasons)
    verdicts[name] = { passed: reason === undefined, explanation: reason ?? "matches the truth" };
  return verdicts;
}

if (import.meta.main) {
  const [dir, framework] = process.argv.slice(2);
  if (dir === undefined || framework === undefined)
    throw new Error("usage: check.ts <artifacts dir> <framework>");
  await $`ln -sfn ${evals} ${join(dir, "evals")}`.quiet();
  console.log(JSON.stringify(await check(join(dir, "adapter.ts"), framework)));
}
