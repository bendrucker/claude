/**
 * Locates a script inside a sibling plugin. Cross-plugin imports are
 * disallowed, so a sibling's code is reachable only by path, and the path
 * depends on which layout the plugin is installed in.
 */

import { basename, join } from "node:path";

/**
 * Resolves `plugin`'s script from this plugin's own root, or null when no
 * sibling qualifies.
 *
 * A dev checkout keeps plugins as sibling directories. An installed
 * marketplace nests them one level deeper, as `<marketplace>/<plugin>/<version>`,
 * where the version directory is the marketplace commit. Only the sibling under
 * this plugin's own version directory came from that same commit, and the
 * contract between a caller and the script it spawns moves between commits, so
 * no other version qualifies.
 */
export async function findSiblingScript(
  pluginRoot: string,
  plugin: string,
  ...script: string[]
): Promise<string | null> {
  const devPath = join(pluginRoot, "..", plugin, ...script);
  if (await Bun.file(devPath).exists()) return devPath;

  const installedPath = join(pluginRoot, "..", "..", plugin, basename(pluginRoot), ...script);
  return (await Bun.file(installedPath).exists()) ? installedPath : null;
}
