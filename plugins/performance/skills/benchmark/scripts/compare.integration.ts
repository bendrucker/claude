import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "compare.ts");

function compare(...args: string[]) {
  const proc = Bun.spawnSync(["bun", script, ...args], { stderr: "pipe", stdout: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe("compare.ts against hyperfine", () => {
  const out = join(mkdtempSync(join(tmpdir(), "compare-")), "sleep");

  it("runs interleaved rounds and stars a real slowdown", () => {
    const run = compare(
      "run",
      out,
      "--arm",
      "base=sleep 0.02",
      "--arm",
      "slow=sleep 0.08",
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
    expect(run.code).toBe(0);

    const report = compare("report", out, "--markdown");
    expect(report.code).toBe(0);
    const row = report.stdout.split("\n").find((line) => line.startsWith("| slow "));
    expect(row).toMatch(/\| slow \| 6 \| \d+\.\dms \| [\d.]+% \| \+\d+\.\d%\* \|/);
  }, 60_000);

  it("refuses to pool into a directory that already holds exports", () => {
    const run = compare("run", out, "--arm", "a=true", "--arm", "b=true", "--", "-N");
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("already holds exports");
  });
});
