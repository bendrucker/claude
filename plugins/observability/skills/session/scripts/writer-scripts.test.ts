import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { ensureIndex, getDb } from "./db";
import { holdLock } from "./lock-holder";

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "sessions");

let tmpDir: string;
let dataDir: string;
let importsDir: string;
let configDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "writer-scripts-"));
  dataDir = join(tmpDir, "data");
  importsDir = join(tmpDir, "home", "imports");
  configDir = join(tmpDir, "config");
  mkdirSync(join(tmpDir, "projects"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function buildIndex(): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  const db = await getDb(dataDir);
  try {
    await ensureIndex(db, { projectsDir: fixturesDir, importsDir });
  } finally {
    db.close();
  }
}

async function run(script: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", join(import.meta.dirname, script), ...args], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      CLAUDE_SESSION_INDEX_DIR: dataDir,
      CLAUDE_PROJECTS_DIR: join(tmpDir, "projects"),
      CLAUDE_SESSION_IMPORTS_DIR: importsDir,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_SESSION_ID: "",
    },
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

const EventRecord = z.object({
  event_name: z.string(),
  attributes: z.record(z.string(), z.unknown()),
});

async function refreshEvents(): Promise<z.infer<typeof EventRecord>[]> {
  const dir = join(configDir, "mod-events", "cli");
  const files = readdirSync(dir).filter((f) => f.startsWith("session-index."));
  const lines = await Promise.all(files.map((f) => Bun.file(join(dir, f)).text()));
  return lines
    .flatMap((text) => text.trim().split("\n"))
    .map((line) => EventRecord.parse(JSON.parse(line)))
    .filter((record) => record.event_name === "session-index.refresh");
}

describe("import.ts", () => {
  it("stamps the index and records a refresh event", async () => {
    await $`mkdir -p ${join(importsDir, "box", "projects")}`.quiet();
    await $`cp -R ${fixturesDir}/. ${join(importsDir, "box", "projects")}`.quiet();

    const { exitCode, stderr } = await run("import.ts", "--host", "box");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(await Bun.file(join(dataDir, "last-refresh")).exists()).toBe(true);
    const [event] = await refreshEvents();
    expect(event?.attributes).toMatchObject({ outcome: "indexed", trigger: "import" });
  });
});

describe("forget.ts", () => {
  it.each(["..", "../home", "a/b"])(
    "rejects the label %p without deleting anything",
    async (label) => {
      await buildIndex();
      mkdirSync(importsDir, { recursive: true });
      await Bun.write(join(tmpDir, "home", "keep"), "keep\n");

      const { exitCode } = await run("forget.ts", "--host", label);

      expect(exitCode).toBe(1);
      expect(await Bun.file(join(tmpDir, "home", "keep")).exists()).toBe(true);
    },
  );
});

describe("hosts.ts", () => {
  it("reads last-import times while a reader holds the index", async () => {
    await buildIndex();

    const reader = await holdLock(dataDir, "READ_ONLY");
    try {
      const { stdout, exitCode } = await run("hosts.ts");
      expect(exitCode).toBe(0);
      const local = stdout.split("\n").find((line) => line.includes("(this machine)"));
      expect(local).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    } finally {
      await reader.release();
    }
  });
});
