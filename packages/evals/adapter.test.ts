import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAdapter } from "./adapter";
import { native } from "./adapters/native";
import { resultPath, scoredDir } from "./layout";
import { writeResult } from "./result";

const cli = (name: string) => join(import.meta.dir, "../../evals/native", `${name}.ts`);

async function module(source: string): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "adapter-")), "adapter.ts");
  await Bun.write(path, source);
  return path;
}

/** A harness held in memory: `base` fails every run and anything else passes. */
const fixed = `export default {
  name: "fixed",
  async run(suite, { ref, args }) {
    return [suite, ref, ...args].join(" ");
  },
  async read(path) {
    const run = (passed) => ({ score: passed ? 1 : 0, graders: [{ name: "fact", passed }] });
    const runs = path === "base" ? [run(false), run(false)] : [run(true), run(true)];
    return { result: { cases: [{ name: "from-module", arms: { with: runs } }] }, measured: new Map() };
  },
  async tags() {
    return new Map([["from-module", ["holdout"]]]);
  },
  async rescore(_, path) {
    return { path: path + "-rescored", flips: [{ grader: "from-module/fact", run: "r0", passed: true }] };
  },
  async traces() {
    return new Map([["from-module/with", [{ calls: ["Read a.md"] }, { calls: ["Read a.md", "Bash ls"] }]]]);
  },
};
`;

const spawn = (args: string[]) => {
  const proc = Bun.spawnSync(["bun", ...args]);
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
};

describe("resolveAdapter", () => {
  test("defaults to native and resolves it by name", async () => {
    expect(await resolveAdapter(undefined)).toBe(native);
    expect(await resolveAdapter("native")).toBe(native);
  });

  test("loads a module's default or adapter export", async () => {
    expect((await resolveAdapter(await module(fixed))).name).toBe("fixed");
    const named = await module(fixed.replace("export default", "export const adapter ="));
    expect((await resolveAdapter(named)).name).toBe("fixed");
  });

  test("names the operations a module leaves out", async () => {
    const path = await module(`export default { name: "partial", read: async () => ({}) };\n`);
    expect(resolveAdapter(path)).rejects.toThrow(`${path} exports no adapter, missing: run, tags`);
  });
});

describe("the CLIs through a user module", () => {
  test("compare.ts reads its columns and tags", async () => {
    const path = await module(fixed);
    const r = spawn([cli("compare"), "--adapter", path, "--suite", "s", "base", "cand"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("from-module");
    expect(r.out).toContain("│ base ");
    expect(r.out).toContain("holdout");
  });

  test("run.ts prints the path the module stored", async () => {
    const r = spawn([cli("run"), "--adapter", await module(fixed), "s", "--ref", "v1", "--", "-x"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("s v1 -x");
  });

  test("regrade.ts reports the module's flips", async () => {
    const r = spawn([cli("regrade"), "--adapter", await module(fixed), "s", "out"]);
    expect(r.out).toContain("r0: from-module/fact now passes");
    expect(r.out).toContain("out-rescored: 1 verdicts changed");
  });

  test("calls.ts counts the module's transcripts", async () => {
    const r = spawn([cli("calls"), "--adapter", await module(fixed), "out"]);
    expect(r.out).toMatch(/from-module\/with\s*│\s*Read a\.md\s*│\s*2\/2/);
    expect(r.out).toMatch(/Bash ls\s*│\s*1\/2/);
  });

  test("exits non-zero naming a module without the interface", async () => {
    const path = await module(`export default { name: "broken" };\n`);
    const r = spawn([cli("compare"), "--adapter", path, "base"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(path);
  });
});

test("a scored/ result reads the source trace each of its runs carries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scored-"));
  const source = join(dir, "source.jsonl");
  await Bun.write(source, JSON.stringify({ type: "result", result: "run two" }));
  await writeResult(scoredDir(dir), { c: { with: [{ score: 0.5, graders: [], trace: source }] } });
  const scored = resultPath(scoredDir(dir));
  expect((await native.traces(scored)).get("c/with")?.map((t) => t.reply)).toEqual(["run two"]);
  expect((await native.read(scored)).measured.get("c/with")).toHaveLength(1);
});
