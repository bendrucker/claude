import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DoctorOptions, runDoctor } from "../scripts/doctor";
import type { HistorySample } from "../scripts/history";

const RESET = 1000;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rate-limits-doctor-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedHistory(path: string, count: number, t: number): Promise<void> {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const s: HistorySample = {
      t: t - i * 60000,
      five: 40 - i,
      fiveReset: RESET,
      seven: null,
      sevenReset: null,
    };
    lines.push(JSON.stringify(s));
  }
  await Bun.write(path, `${lines.join("\n")}\n`);
}

function opts(dir: string, overrides: Partial<DoctorOptions> = {}): DoctorOptions {
  return {
    rlPath: join(dir, "rl.json"),
    rlFromEnv: false,
    historyPath: join(dir, "history.ndjson"),
    binPath: join(dir, "bin", "alert"),
    settingsPath: join(dir, "settings.json"),
    minSamples: 3,
    nowMs: 1_000_000_000,
    maxAgeMs: 5 * 60 * 1000,
    ...overrides,
  };
}

describe("doctor", () => {
  test("fresh rl.json plus populated history passes", async () => {
    const o = opts(dir);
    const now = o.nowMs - 10_000;
    await Bun.write(
      o.rlPath,
      JSON.stringify({ five_hour: { used_percentage: 40, resets_at: RESET } }),
    );
    await seedHistory(o.historyPath, 4, now);

    const report = await runDoctor(o);
    expect(report.ok).toBe(true);
  });

  test("missing history fails with recorder remediation", async () => {
    const o = opts(dir);
    await Bun.write(
      o.rlPath,
      JSON.stringify({ five_hour: { used_percentage: 40, resets_at: RESET } }),
    );

    const report = await runDoctor(o);
    expect(report.ok).toBe(false);
    const historyCheck = report.checks.find((c) => c.name === "history exists");
    expect(historyCheck?.status).toBe("fail");
    expect(historyCheck?.remediation).toContain("recorder");
  });

  test("too few in-block samples fails", async () => {
    const o = opts(dir);
    const now = o.nowMs - 10_000;
    await Bun.write(
      o.rlPath,
      JSON.stringify({ five_hour: { used_percentage: 40, resets_at: RESET } }),
    );
    await seedHistory(o.historyPath, 1, now);

    const report = await runDoctor(o);
    expect(report.ok).toBe(false);
    const samples = report.checks.find((c) => c.name === "history samples");
    expect(samples?.status).toBe("fail");
  });

  test("missing rl.json fails", async () => {
    const report = await runDoctor(opts(dir));
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "rl.json exists")?.status).toBe("fail");
  });
});
