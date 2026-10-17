import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { type Database, ensureIndex, getDb, sessionDbPath } from "./db";

export async function backdate(target: string): Promise<void> {
  // Bun's shell builtin touch lacks -t, so use the system binary.
  await $`/usr/bin/touch -t 200001010000 ${target}`.quiet();
}

export const fixturesDir = join(import.meta.dirname, "..", "fixtures", "sessions");
export const resourcesDir = join(import.meta.dirname, "..", "resources");
export const plansFixtureDir = join(import.meta.dirname, "..", "fixtures", "plans");

export async function loadExtensions(database: Database): Promise<void> {
  // `getenv` exists only in the duckdb CLI, so stub it for the node binding.
  await database.run("CREATE OR REPLACE TEMP MACRO getenv(name) AS NULL");
  await database.run(await Bun.file(join(resourcesDir, "extensions.sql")).text());
}

export function filterParams(
  overrides: Record<string, string | null> = {},
): Record<string, string | null> {
  return { after_date: null, before_date: null, project: null, host: null, ...overrides };
}

export function queryParams(
  overrides: Record<string, string | null> = {},
): Record<string, string | null> {
  return filterParams({ limit: "20", ...overrides });
}

export let db: Database;
export let tmpDir: string;
export let importsDir: string;
let templateDir: string;

// Gives every test in the calling file its own copy of an index built once from the fixtures.
export function useFixtureIndex(): void {
  // The first `INSTALL ... FROM community` downloads the markdown/yaml extensions over
  // the network, which can exceed the default per-test timeout on a cold CI runner.
  // Warm the shared extension cache once so the per-test LOAD reads from disk.
  beforeAll(async () => {
    const warmDir = mkdtempSync(join(tmpdir(), "session-warm-"));
    const warm = await getDb(warmDir);
    try {
      await loadExtensions(warm);
    } finally {
      warm.close();
      await rm(warmDir, { recursive: true, force: true });
    }

    // Indexing the fixtures from empty dominates each test's setup, so index them once
    // and give every test a copy of the finished index.
    templateDir = mkdtempSync(join(tmpdir(), "session-template-"));
    const templateImports = join(templateDir, "imports");
    mkdirSync(templateImports, { recursive: true });
    const template = await getDb(templateDir);
    try {
      await ensureIndex(template, { projectsDir: fixturesDir, importsDir: templateImports });
    } finally {
      template.close();
    }
  }, 120_000);

  afterAll(async () => {
    await rm(templateDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-test-"));
    importsDir = join(tmpDir, "imports");
    mkdirSync(importsDir, { recursive: true });
    await Bun.write(sessionDbPath(tmpDir), Bun.file(sessionDbPath(templateDir)));
    db = await getDb(tmpDir);
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });
}

export async function reopenDb(): Promise<void> {
  db = await getDb(tmpDir);
}

export async function importFixtureHost(
  label: string,
  opts: { source?: string } = {},
): Promise<void> {
  const projects = join(importsDir, label, "projects");
  mkdirSync(projects, { recursive: true });
  await $`cp -R ${fixturesDir}/. ${projects}`.quiet();
  await Bun.write(
    join(importsDir, label, "manifest.json"),
    `${JSON.stringify({
      host: label,
      source: opts.source ?? `${label}:.claude/projects/`,
      imported_at: "2026-01-01T00:00:00Z",
      policy: { block_egress: true },
    })}\n`,
  );
}

export async function reindex(): Promise<void> {
  await ensureIndex(db, { projectsDir: fixturesDir, importsDir });
}
