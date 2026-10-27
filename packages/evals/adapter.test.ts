import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAdapter } from "./adapter";
import { native } from "./adapters/native";

const compare = join(import.meta.dir, "../../evals/native/compare.ts");

async function module(source: string): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "adapter-")), "adapter.ts");
  await Bun.write(path, source);
  return path;
}

const fixed = `export default {
  name: "fixed",
  async read(path) {
    const run = (passed) => ({ score: passed ? 1 : 0, graders: [{ name: "fact", passed }] });
    const runs = path === "base" ? [run(false), run(false)] : [run(true), run(true)];
    return { result: { cases: [{ name: "from-module", arms: { with: runs } }] }, measured: new Map() };
  },
};
`;

describe("resolveAdapter", () => {
  test("defaults to native and resolves it by name", async () => {
    expect(await resolveAdapter(undefined)).toBe(native);
    expect(await resolveAdapter("native")).toBe(native);
  });

  test("loads a module's default or adapter export", async () => {
    expect((await resolveAdapter(await module(fixed))).name).toBe("fixed");
    const named = await module(
      `export const adapter = { name: "named", read: async () => ({}) };\n`,
    );
    expect((await resolveAdapter(named)).name).toBe("named");
  });
});

describe("compare.ts --adapter", () => {
  test("reports the cases a user module reads", async () => {
    const path = await module(fixed);
    const proc = Bun.spawnSync(["bun", compare, "--adapter", path, "base", "cand"]);
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString();
    expect(out).toContain("from-module");
    expect(out).toContain("│ base ");
  });

  test("exits non-zero naming a module without read", async () => {
    const path = await module(`export default { name: "broken" };\n`);
    const proc = Bun.spawnSync(["bun", compare, "--adapter", path, "base"]);
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr.toString()).toContain(path);
  });
});
