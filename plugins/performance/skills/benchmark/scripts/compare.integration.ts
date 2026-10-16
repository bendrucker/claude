import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "compare.ts");
const root = mkdtempSync(join(tmpdir(), "compare-"));
const cache = join(root, "cache");

function compare(...args: string[]) {
  const proc = Bun.spawnSync(["bun", script, ...args], {
    stderr: "pipe",
    stdout: "pipe",
    env: { ...process.env, XDG_CACHE_HOME: cache },
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe("compare.ts against hyperfine", () => {
  const out = join(root, "sleep");

  it("runs interleaved rounds and stars a real slowdown", async () => {
    const run = compare(
      "run",
      out,
      "--hypothesis",
      "sleeping 10x longer slows the arm",
      "--arm",
      "base=sleep 0.05",
      "--arm",
      "slow=sleep 0.5",
      "--rounds",
      "2",
      "--runs",
      "3",
      "--warmup",
      "0",
      "--",
      "-N",
    );
    expect(run.stderr).toContain("round 2/2: slow, base");
    expect(run.stderr).toMatch(/load \d+→\d+ \/\d+cpu/);
    expect(run.code).toBe(0);

    const meta: unknown = await Bun.file(join(out, "meta.json")).json();
    expect(meta).toMatchObject({
      hypothesis: "sleeping 10x longer slows the arm",
      rounds: [expect.anything(), expect.anything()],
    });

    const log = await Bun.file(join(cache, "performance", "comparisons.jsonl")).text();
    const entry: unknown = JSON.parse(log.trim().split("\n").at(-1) ?? "");
    expect(entry).toMatchObject({ rounds: 2, planned: 2, arms: ["base", "slow"] });

    const report = compare("report", out, "--markdown");
    expect(report.code).toBe(0);
    expect(report.stdout).toStartWith("hypothesis: sleeping 10x longer slows the arm\nload: ");
    const row = report.stdout.split("\n").find((line) => line.startsWith("| slow "));
    expect(row).toMatch(/\| slow \| 6 \| \d+\.\dms \| [\d.]+% \| \+\d+\.\d%\* \|/);
  }, 60_000);

  it("refuses to pool into a directory that already holds exports", () => {
    const run = compare(
      "run",
      out,
      "--hypothesis",
      "A/A",
      "--arm",
      "a=true",
      "--arm",
      "b=true",
      "--",
      "-N",
    );
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("already holds exports");
  });

  it("refuses to measure without a hypothesis", () => {
    const run = compare(
      "run",
      join(root, "none"),
      "--arm",
      "a=true",
      "--arm",
      "b=true",
      "--",
      "-N",
    );
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("give --hypothesis before measuring");
  });
});
