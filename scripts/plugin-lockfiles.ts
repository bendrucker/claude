#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { cli, command } from "cleye";
import { z } from "zod";
import { decodeFile } from "../packages/decode/index";
import { loadPlugins } from "../packages/marketplace/index";
import { runCheck } from "./check";

/**
 * Lockfile names Claude Code accepts, in the order it checks them.
 *
 * It installs a plugin's dependencies at install and update time only when the
 * plugin root holds both a `package.json` and one of these, and skips a plugin
 * that has the manifest alone without logging anything. Yarn and pnpm lockfiles
 * are excluded upstream because their resolution hooks bypass `--ignore-scripts`.
 */
const LOCKFILES = ["bun.lock", "bun.lockb", "npm-shrinkwrap.json", "package-lock.json"] as const;

/**
 * The lockfile this script generates.
 *
 * Claude Code runs the matched lockfile's package manager from the user's PATH
 * with no fallback to the other, so npm reaches installers that lack bun.
 */
const GENERATED = "package-lock.json";

const Manifest = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
type Manifest = z.infer<typeof Manifest>;

const Lockfile = z.looseObject({
  packages: z.record(z.string(), Manifest).optional(),
});

interface PluginPackage {
  name: string;
  dir: string;
  manifest: Manifest;
}

/** Local plugins that declare runtime dependencies, so a cached copy needs them installed. */
async function pluginPackages(): Promise<PluginPackage[]> {
  const plugins = await loadPlugins();
  const packages = await Promise.all(
    plugins.map(async ({ name, dir }) => {
      if (dir === undefined) return null;
      const path = join(dir, "package.json");
      if (!(await Bun.file(path).exists())) return null;
      const manifest = await decodeFile(Manifest, path);
      if (Object.keys(manifest.dependencies ?? {}).length === 0) return null;
      return { name, dir, manifest };
    }),
  );
  return packages
    .filter((entry) => entry !== null)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

async function existingLockfile(dir: string): Promise<string | null> {
  for (const name of LOCKFILES) {
    // oxlint-disable-next-line no-await-in-loop -- the first match wins, mirroring the order Claude Code resolves them in.
    if (await Bun.file(join(dir, name)).exists()) return name;
  }
  return null;
}

/**
 * Regenerates a plugin's lockfile in a scratch directory outside the repo.
 *
 * npm walks up to the nearest ancestor declaring `workspaces` and writes the
 * lockfile there, so resolving in place would produce a lockfile at the repo
 * root covering every workspace member rather than one scoped to the plugin.
 */
async function generate(plugin: PluginPackage): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "plugin-lockfile-"));
  try {
    await Bun.write(join(scratch, "package.json"), Bun.file(join(plugin.dir, "package.json")));
    await $`npm install --package-lock-only --ignore-scripts`.cwd(scratch).quiet();
    await Bun.write(join(plugin.dir, GENERATED), Bun.file(join(scratch, GENERATED)));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Dependency ranges a lockfile pins for the plugin itself, or null when unreadable.
 *
 * Only the npm formats carry the manifest's own ranges as JSON. A `bun.lock`
 * satisfies Claude Code just as well, so an unreadable format reports presence
 * without a staleness verdict rather than a violation.
 */
async function pinned(dir: string, lockfile: string): Promise<Manifest | null> {
  if (lockfile !== "package-lock.json" && lockfile !== "npm-shrinkwrap.json") return null;
  const lock = await decodeFile(Lockfile, join(dir, lockfile));
  return lock.packages?.[""] ?? null;
}

/**
 * A manifest's dependency ranges as one comparable string.
 *
 * Each entry carries the field it came from, so moving a package between
 * `dependencies` and `devDependencies` reads as drift the way `npm ci` sees it.
 */
export function ranges(manifest: Manifest): string {
  const entries: [string, string, string][] = [];
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    entries.push(["prod", name, range]);
  }
  for (const [name, range] of Object.entries(manifest.devDependencies ?? {})) {
    entries.push(["dev", name, range]);
  }
  return JSON.stringify(entries.toSorted((a, b) => a[1].localeCompare(b[1])));
}

/**
 * How a plugin's lockfile state breaks the cache install, or null when it holds.
 *
 * Missing and stale fail differently upstream: no lockfile skips the install
 * silently, while a lockfile disagreeing with `package.json` fails `npm ci`,
 * which refuses to re-resolve under a frozen install.
 */
export function violation(
  name: string,
  lockfile: string | null,
  pinnedRanges: Manifest | null,
  manifest: Manifest,
): string | null {
  if (lockfile === null) {
    return `${name}: declares dependencies with no lockfile, so the install is skipped`;
  }
  if (pinnedRanges !== null && ranges(pinnedRanges) !== ranges(manifest)) {
    return `${name}: ${lockfile} disagrees with package.json, so the install fails`;
  }
  return null;
}

const check = command({ name: "check" }, async () => {
  await runCheck(
    async () => {
      const plugins = await pluginPackages();
      const violations = await Promise.all(
        plugins.map(async (plugin) => {
          const lockfile = await existingLockfile(plugin.dir);
          const root = lockfile === null ? null : await pinned(plugin.dir, lockfile);
          return violation(plugin.name, lockfile, root, plugin.manifest);
        }),
      );

      return {
        header: [
          "Claude Code installs a plugin's dependencies when it caches the plugin, but only",
          "when the plugin root holds a lockfile beside package.json. Run `bun run",
          "plugin-lockfiles generate` to refresh these:",
          "",
        ],
        violations: violations.filter((entry) => entry !== null),
      };
    },
    { success: "Every plugin declaring dependencies ships a lockfile" },
  );
});

const generateCommand = command(
  {
    name: "generate",
    parameters: ["[plugins...]"],
    flags: {
      force: {
        type: Boolean,
        description: "Regenerate lockfiles that are already present and current",
      },
    },
    help: { description: "Write a package-lock.json for each plugin that declares dependencies." },
  },
  async (argv) => {
    const selected = new Set(argv._.plugins);
    const plugins = (await pluginPackages()).filter(
      (plugin) => selected.size === 0 || selected.has(plugin.name),
    );

    for (const plugin of plugins) {
      // oxlint-disable-next-line no-await-in-loop -- npm resolves against the registry, and a serial run keeps the printed progress in order.
      const lockfile = await existingLockfile(plugin.dir);
      if (lockfile !== null && !argv.flags.force) {
        // oxlint-disable-next-line no-await-in-loop -- see above.
        const root = await pinned(plugin.dir, lockfile);
        if (root === null || ranges(root) === ranges(plugin.manifest)) {
          console.log(`= ${plugin.name} (${lockfile} is current)`);
          continue;
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await generate(plugin);
      console.log(`+ ${plugin.name}/${GENERATED}`);
    }
  },
);

if (import.meta.main) {
  await cli(
    {
      name: "plugin-lockfiles",
      commands: [check, generateCommand],
      help: {
        description:
          "Manage the lockfiles Claude Code needs to install plugin dependencies. It installs them when it caches a plugin, but only when the plugin root holds a lockfile beside package.json, and skips a plugin without one silently. `generate` writes those lockfiles, `check` fails when one is missing or disagrees with package.json.",
      },
    },
    (parsed) => parsed.showHelp(),
  );
}
