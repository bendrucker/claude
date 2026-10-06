#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { decode } from "../packages/decode/index";
import { loadPlugins, type Plugin } from "../packages/marketplace/index";

const Dependencies = z.looseObject({ dependencies: z.array(z.string()).optional() });

/** Where the engine writes a plugin's function-hooks declarations when it loads the plugin from a folder. */
export function typesEntry(dir: string): string {
  return join(dir, ".claude-plugin", "types", "claude-code", "index.d.ts");
}

/**
 * Plugins naming `modules`, plus the local plugins they depend on. The engine
 * skips a plugin whose dependency is not loaded, and writes it no types.
 */
export function modPlugins(plugins: Plugin[]): { mods: Plugin[]; load: Plugin[] } {
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const mods = plugins.filter(
    (plugin) => plugin.dir !== undefined && (plugin.hooks?.modules?.length ?? 0) > 0,
  );
  const load = new Map<string, Plugin>();
  const visit = (plugin: Plugin): void => {
    if (load.has(plugin.name)) return;
    load.set(plugin.name, plugin);
    const { dependencies = [] } = decode(Dependencies, plugin.manifest ?? {}, plugin.name);
    for (const name of dependencies) {
      const dependency = byName.get(name);
      if (dependency?.dir !== undefined) visit(dependency);
    }
  };
  for (const plugin of mods) visit(plugin);
  return { mods, load: [...load.values()] };
}

if (import.meta.main) {
  const { mods, load } = modPlugins(await loadPlugins());
  const scratch = await mkdtemp(join(tmpdir(), "mod-types-"));
  try {
    // `/cost` answers locally, so the load writes the types without auth or a model call.
    const proc = Bun.spawn(
      ["claude", "-p", ...load.flatMap((plugin) => ["--plugin-dir", plugin.dir ?? ""]), "/cost"],
      {
        cwd: scratch,
        env: { ...process.env, CLAUDE_CONFIG_DIR: scratch },
        stdout: "ignore",
        stderr: "inherit",
      },
    );
    if ((await proc.exited) !== 0) process.exit(1);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const present = await Promise.all(
    mods.map((plugin) => Bun.file(typesEntry(plugin.dir ?? "")).exists()),
  );
  const missing = mods.filter((_, index) => !present[index]).map((plugin) => plugin.name);
  if (missing.length > 0) {
    console.error(`claude wrote no engine types for: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`Engine types written for ${mods.map((plugin) => plugin.name).join(", ")}`);
}
