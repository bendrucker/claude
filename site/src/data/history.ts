import { join } from "node:path";
import { $ } from "bun";

export interface PluginHistory {
  firstCommit: string;
  lastCommit: string;
  commitCount: number;
}

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..", "..");
const HEADER_DELIMITER = "\x01";

export interface LoadHistoryOptions {
  /** Repository root to run `git log` against. Defaults to the repo containing this module. */
  root?: string;
}

interface StatusEntry {
  status: string;
  oldPath?: string;
  newPath: string;
}

interface PluginTiming {
  firstDate: string;
  /** Position of the commit that set `firstDate` in the chronological log stream, used to compare across plugins without relying on ISO offset string ordering. */
  firstOrder: number;
  lastDate: string;
}

function pluginNameFromPath(path: string): string | undefined {
  return /^plugins\/([^/]+)\//.exec(path)?.[1];
}

function parseStatusLine(line: string): StatusEntry | undefined {
  const [status, ...paths] = line.split("\t");
  if (!status) return undefined;

  if (status.startsWith("R") || status.startsWith("C")) {
    const [oldPath, newPath] = paths;
    if (!oldPath || !newPath) return undefined;
    return { status, oldPath, newPath };
  }

  const [newPath] = paths;
  if (!newPath) return undefined;
  return { status, newPath };
}

async function assertNotShallow(root: string): Promise<void> {
  const isShallow = (await $`git rev-parse --is-shallow-repository`.cwd(root).text()).trim();
  if (isShallow === "true") {
    throw new Error(
      "loadHistory requires full git history, but this is a shallow clone. " +
        "Checkouts must use `fetch-depth: 0` (actions/checkout defaults to `fetch-depth: 1`).",
    );
  }
}

/**
 * Loads per-plugin commit history from the full `plugins/` git log in one pass.
 *
 * Renames are followed into a plugin's lineage only when the old path's plugin
 * no longer exists at HEAD (i.e. is absent from `names`). When both the old and
 * new plugin still exist on disk, the move is treated as file migration between
 * two live plugins and excluded from lineage.
 */
export async function loadHistory(
  names: string[],
  opts?: LoadHistoryOptions,
): Promise<Map<string, PluginHistory>> {
  const root = opts?.root ?? PACKAGE_ROOT;
  await assertNotShallow(root);

  const output =
    await $`git log --reverse --name-status -M --format=${`${HEADER_DELIMITER}%H %aI`} -- plugins/`
      .cwd(root)
      .text();

  const headSet = new Set(names);
  const ownShas = new Map<string, Set<string>>();
  const timing = new Map<string, PluginTiming>();
  /** newPlugin -> accepted ancestor plugin names (renames where the old plugin no longer exists at HEAD). */
  const ancestorsByPlugin = new Map<string, Set<string>>();

  const commits = output.split(HEADER_DELIMITER).slice(1);
  commits.forEach((chunk, order) => {
    const newlineIndex = chunk.indexOf("\n");
    const header = chunk.slice(0, newlineIndex);
    const [sha, date] = header.split(" ");
    if (!sha || !date) return;

    for (const line of chunk.slice(newlineIndex + 1).split("\n")) {
      if (!line) continue;
      const entry = parseStatusLine(line);
      if (!entry) continue;

      const newPlugin = pluginNameFromPath(entry.newPath);
      if (newPlugin) {
        let shas = ownShas.get(newPlugin);
        if (!shas) {
          shas = new Set();
          ownShas.set(newPlugin, shas);
        }
        shas.add(sha);

        const existing = timing.get(newPlugin);
        if (!existing)
          timing.set(newPlugin, { firstDate: date, firstOrder: order, lastDate: date });
        else existing.lastDate = date;
      }

      if (entry.status.startsWith("R") && entry.oldPath && newPlugin) {
        const oldPlugin = pluginNameFromPath(entry.oldPath);
        if (oldPlugin && oldPlugin !== newPlugin && !headSet.has(oldPlugin)) {
          let ancestors = ancestorsByPlugin.get(newPlugin);
          if (!ancestors) {
            ancestors = new Set();
            ancestorsByPlugin.set(newPlugin, ancestors);
          }
          ancestors.add(oldPlugin);
        }
      }
    }
  });

  function ancestorsOf(plugin: string): Set<string> {
    const result = new Set<string>();
    const stack = [plugin];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      for (const ancestor of ancestorsByPlugin.get(current) ?? []) {
        if (!result.has(ancestor)) {
          result.add(ancestor);
          stack.push(ancestor);
        }
      }
    }
    return result;
  }

  const history = new Map<string, PluginHistory>();
  for (const name of names) {
    const own = timing.get(name);
    if (!own) continue;

    const lineage = [name, ...ancestorsOf(name)];
    const allShas = new Set<string>();
    let earliest = own;
    for (const plugin of lineage) {
      for (const sha of ownShas.get(plugin) ?? []) allShas.add(sha);
      const pluginTiming = timing.get(plugin);
      if (pluginTiming && pluginTiming.firstOrder < earliest.firstOrder) earliest = pluginTiming;
    }

    history.set(name, {
      firstCommit: earliest.firstDate.slice(0, 10),
      lastCommit: own.lastDate.slice(0, 10),
      commitCount: allShas.size,
    });
  }

  return history;
}
