import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { ensureIndex, getDb } from "./db";
import { type HeldLock, holdLock } from "./lock-holder";

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "sessions");

let tmpDir: string;
let dataDir: string;
let importsDir: string;
let configDir: string;
let held: HeldLock | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "writer-scripts-"));
  dataDir = join(tmpDir, "data");
  importsDir = join(tmpDir, "home", "imports");
  configDir = join(tmpDir, "config");
  mkdirSync(join(tmpDir, "projects"), { recursive: true });
});

afterEach(async () => {
  await held?.release();
  held = undefined;
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
  it("waits out a writer instead of yielding to it", async () => {
    await buildIndex();
    await $`mkdir -p ${join(importsDir, "box", "projects")}`.quiet();
    await $`cp -R ${fixturesDir}/. ${join(importsDir, "box", "projects")}`.quiet();
    held = await holdLock(dataDir, "READ_WRITE");

    const importing = run("import.ts", "--host", "box");
    await Bun.sleep(1500);
    await held.release();
    held = undefined;

    expect((await importing).exitCode).toBe(0);
    expect((await refreshEvents()).map((e) => e.attributes.outcome)).toEqual(["indexed"]);
  });

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
  it.each<{ name: string; label: () => string }>([
    { name: "parent", label: () => ".." },
    { name: "current", label: () => "." },
    { name: "empty", label: () => "" },
    { name: "relative traversal", label: () => "../home" },
    { name: "absolute path", label: () => join(tmpDir, "home") },
    { name: "nested", label: () => "a/b" },
  ])("rejects a $name label before touching the index or disk", async ({ label }) => {
    await buildIndex();
    mkdirSync(join(importsDir, "box"), { recursive: true });
    await Bun.write(join(tmpDir, "home", "keep"), "keep\n");
    held = await holdLock(dataDir, "READ_WRITE");

    const { exitCode, stderr } = await run("forget.ts", "--host", label());

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/^(Invalid host label|--host is required)/);
    expect(await Bun.file(join(tmpDir, "home", "keep")).exists()).toBe(true);
    expect(readdirSync(importsDir)).toEqual(["box"]);
  });
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
