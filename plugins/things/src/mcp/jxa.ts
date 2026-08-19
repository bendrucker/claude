/**
 * Runs the plugin's JXA scripts through the mac plugin's runner (AST scope
 * validation + Apple Events retry). The runner is spawned as a
 * subprocess because cross-plugin imports are disallowed, and it is
 * discovered by filesystem layout.
 */

import { join } from "node:path";
import { findSiblingScript } from "../marketplace";

const PLUGIN_ROOT = join(import.meta.dirname, "..", "..");

/**
 * The version match matters here because the runner's argument contract moves
 * between commits: this build expects everything past the script path to reach
 * the script, where a runner from another commit may claim those flags itself
 * and leave the script answering with a usage error.
 */
export function findJxaRunner(pluginRoot: string = PLUGIN_ROOT): Promise<string | null> {
  return findSiblingScript(pluginRoot, "mac", "scripts", "jxa.ts");
}

export async function runScript(script: string, args: string[]): Promise<unknown> {
  const runner = await findJxaRunner();
  if (!runner) {
    throw new Error("mac plugin JXA runner not found (expected plugins/mac/scripts/jxa.ts)");
  }

  const scriptPath = join(PLUGIN_ROOT, "scripts", "jxa", script);
  // Uses process.execPath because this process is spawned by tailgate, which
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
