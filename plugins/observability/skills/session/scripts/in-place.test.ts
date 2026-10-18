import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inPlaceDataDir } from "./db";

const dirs: string[] = [];

async function pluginsDir(registry: unknown): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "in-place-"));
  dirs.push(dir);
  await Bun.write(join(dir, "known_marketplaces.json"), JSON.stringify(registry));
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("inPlaceDataDir", () => {
  const registry = {
    bendrucker: { source: { source: "directory", path: "/repo" }, installLocation: "/repo" },
    other: { source: { source: "github", repo: "o/r" }, installLocation: "/clones/other" },
  };

  it("names the data dir for a plugin inside a directory marketplace", async () => {
    const dir = await pluginsDir(registry);
    expect(await inPlaceDataDir("/repo/plugins/observability/skills/session/scripts", dir)).toBe(
      join(dir, "data", "observability-bendrucker"),
    );
  });

  it("ignores a script outside every directory marketplace", async () => {
    const dir = await pluginsDir(registry);
    expect(
      await inPlaceDataDir("/src/claude/plugins/observability/skills/session/scripts", dir),
    ).toBeUndefined();
    expect(await inPlaceDataDir("/clones/other/plugins/x/scripts", dir)).toBeUndefined();
  });

  it("ignores a path in the marketplace but outside plugins/", async () => {
    expect(await inPlaceDataDir("/repo/user/scripts", await pluginsDir(registry))).toBeUndefined();
  });

  it("returns undefined when the registry is unreadable", async () => {
    expect(await inPlaceDataDir("/repo/plugins/observability", "/nonexistent")).toBeUndefined();
  });
});
