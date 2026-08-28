import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { getDb } from "./db";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");
const refreshScript = path.join(import.meta.dirname, "refresh.ts");

let tmpDir: string;
let dataDir: string;
let corpusDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "refresh-integration-"));
  dataDir = path.join(tmpDir, "data");
  corpusDir = path.join(tmpDir, "projects");
  mkdirSync(corpusDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  await $`cp -R ${fixturesDir}/. ${corpusDir}`.quiet();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function env() {
  return {
    ...process.env,
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_PROJECTS_DIR: corpusDir,
    CLAUDE_SESSION_IMPORTS_DIR: path.join(tmpDir, "imports"),
  };
}

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", refreshScript, ...args], {
    env: env(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function countRows(): Promise<number> {
  const db = await getDb(dataDir);
  try {
    const [row] = await db.query("SELECT COUNT(*) AS n FROM raw", z.object({ n: z.bigint() }));
    return Number(row?.n ?? 0n);
  } finally {
    db.close();
  }
}

async function touchCorpusFile(rel: string): Promise<void> {
  await $`touch ${path.join(corpusDir, rel)}`.quiet();
}

describe("refresh.ts", () => {
  it("prints the database path to stdout and writes a freshness stamp", async () => {
    const { stdout, exitCode } = await run();
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(path.join(dataDir, "session.duckdb"));
    expect(await Bun.file(path.join(dataDir, "last-refresh")).exists()).toBe(true);
  });

  it("is idempotent across repeated runs", async () => {
    const first = await run();
    const second = await run();
    expect(first.stdout).toBe(second.stdout);
    expect(second.exitCode).toBe(0);
  });

  it("skips the rescan while the stamp is fresh and rescans with --refresh", async () => {
    await run();
    const before = await countRows();

    await Bun.write(
      path.join(corpusDir, "-Users-test-project", "extra.jsonl"),
      `${JSON.stringify({
        type: "user",
        sessionId: "extra-session",
        cwd: "/Users/test/project",
        timestamp: "2024-01-15T10:00:00.000Z",
        message: { role: "user", content: "new file" },
      })}\n`,
    );

    const fast = await run();
    expect(fast.exitCode).toBe(0);
    expect(await countRows()).toBe(before);

    const forced = await run("--refresh");
    expect(forced.exitCode).toBe(0);
    expect(await countRows()).toBe(before + 1);
  });

  it("honors --max-age 0 as an expired stamp", async () => {
    await run();
    const before = await countRows();
    await Bun.write(
      path.join(corpusDir, "-Users-test-project", "extra.jsonl"),
      `${JSON.stringify({
        type: "user",
        sessionId: "extra-session",
        cwd: "/Users/test/project",
        timestamp: "2024-01-15T10:00:00.000Z",
        message: { role: "user", content: "new file" },
      })}\n`,
    );
    await run("--max-age", "0");
    expect(await countRows()).toBe(before + 1);
  });

  it("bounds file growth across repeated reimports of the same corpus", async () => {
    await run();
    const dbPath = path.join(dataDir, "session.duckdb");
    const initial = Bun.file(dbPath).size;

    for (let i = 0; i < 5; i++) {
      await touchCorpusFile(path.join("-Users-test-project", "basic.jsonl"));
      const { exitCode } = await run("--refresh");
      expect(exitCode).toBe(0);
    }

    // Pre-checkpoint, every import rewrote raw and content_items into fresh
    // blocks and the file grew without bound. Reimporting one small file five
    // times must not compound.
    expect(Bun.file(dbPath).size).toBeLessThan(initial * 3);
  });
});
