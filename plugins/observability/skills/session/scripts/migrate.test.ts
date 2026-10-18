import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyIndex, sessionDbPath } from "./db";

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "migrate-"));
  dirs.push(dir);
  return dir;
}

async function legacyIndex(root: string, name: string): Promise<string> {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  await Bun.write(sessionDbPath(dir), "");
  return dir;
}

const exists = (path: string) => Bun.file(path).exists();

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("migrateLegacyIndex", () => {
  it("moves the plugin data dir to the new path", async () => {
    const root = scratch();
    const legacy = await legacyIndex(join(root, "data"), "observability-bendrucker");
    const target = join(root, "share", "claude-sessions");
    await migrateLegacyIndex(target, join(root, "data"));
    expect(await exists(sessionDbPath(target))).toBe(true);
    expect(await exists(sessionDbPath(legacy))).toBe(false);
  });

  it("moves nothing when the new path already exists", async () => {
    const root = scratch();
    const legacy = await legacyIndex(join(root, "data"), "observability-bendrucker");
    const target = await legacyIndex(root, "claude-sessions");
    await migrateLegacyIndex(target, join(root, "data"));
    expect(await exists(sessionDbPath(legacy))).toBe(true);
  });

  it("ignores other plugins and a missing data root", async () => {
    const root = scratch();
    await legacyIndex(join(root, "data"), "writing-bendrucker");
    const target = join(root, "claude-sessions");
    await migrateLegacyIndex(target, join(root, "data"));
    await migrateLegacyIndex(target, join(root, "absent"));
    expect(await exists(sessionDbPath(target))).toBe(false);
  });
});
