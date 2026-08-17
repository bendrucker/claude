/**
 * Runs the plugin's JXA query scripts through the mac plugin's runner
 * (AST scope validation + Apple Events retry). The runner is spawned as a
 * subprocess rather than imported: cross-plugin imports are disallowed, and
 * the runner is discovered by filesystem layout like the x-callback-url
 * runner in scripts/url.ts.
 */

import { basename, join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dirname, "..", "..");

export async function findJxaRunner(pluginRoot: string = PLUGIN_ROOT): Promise<string | null> {
  // Dev layout: sibling plugin directory
  const devPath = join(pluginRoot, "..", "mac", "scripts", "jxa.ts");
  if (await Bun.file(devPath).exists()) return devPath;

  // Installed layout: <marketplace>/<plugin>/<version>, where the version
  // directory is the marketplace commit. Only the sibling under this plugin's
  // own version was installed from the same commit, and the runner's argument
  // contract moves: it now forwards everything past the script path to the
  // script, where an older one claimed those flags for itself and left the
  // script with a short argument list it answers with a usage error.
  const installedPath = join(
    pluginRoot,
    "..",
    "..",
    "mac",
    basename(pluginRoot),
    "scripts",
    "jxa.ts",
  );
  return (await Bun.file(installedPath).exists()) ? installedPath : null;
}

export async function runQuery(script: string, args: string[]): Promise<unknown> {
  const runner = await findJxaRunner();
  if (!runner) {
    throw new Error("mac plugin JXA runner not found (expected plugins/mac/scripts/jxa.ts)");
  }

  const scriptPath = join(PLUGIN_ROOT, "scripts", "jxa", script);
  // process.execPath, not "bun": this process is spawned by tailgate, which
  // inherits launchd's PATH, and that lacks /opt/homebrew/bin. Both streams are
  // piped so the runner's diagnostics cannot reach this process's stdout, where
  // JSON-RPC lives.
  const proc = Bun.spawn([process.execPath, runner, "Things3", scriptPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;

  if (code !== 0) {
    throw new Error(`${script} failed (exit ${code}): ${stderr.trim()}`);
  }

  const result: unknown = JSON.parse(stdout);
  if (result && typeof result === "object" && "error" in result) {
    throw new Error(String((result as { error: unknown }).error));
  }
  return result;
}
