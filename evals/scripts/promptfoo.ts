import * as path from "node:path";
import { expectSuccess, type RunCommand, runCommand } from "./command";

export const CONFIG_DIR_VAR = "PROMPTFOO_CONFIG_DIR";
export const DEFAULT_BIN = "bunx promptfoo";

export interface PromptfooOptions {
  run?: RunCommand | undefined;
  bin?: string | undefined;
}

// promptfoo defaults its database to ~/.promptfoo, which the repo sandbox cannot
// write. Every invocation points it at ~/.cache/promptfoo instead.
export function promptfooConfigDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env[CONFIG_DIR_VAR];
  if (configured != null && configured !== "") return configured;

  const home = env.HOME;
  if (home == null || home === "") {
    throw new Error(`Cannot locate the promptfoo database: set ${CONFIG_DIR_VAR} or HOME`);
  }
  return path.join(home, ".cache", "promptfoo");
}

export function promptfooEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return { [CONFIG_DIR_VAR]: promptfooConfigDir(env) };
}

export function promptfooCommand(args: readonly string[], bin?: string): string[] {
  const parts = (bin ?? process.env.PROMPTFOO_BIN ?? DEFAULT_BIN)
    .split(" ")
    .filter((p) => p !== "");
  return [...parts, ...args];
}

async function invoke(args: readonly string[], options: PromptfooOptions): Promise<string> {
  const command = promptfooCommand(args, options.bin);
  const run = options.run ?? runCommand;
  return expectSuccess(command, await run(command, { env: promptfooEnv() })).stdout;
}

export async function exportEval(
  evalId: string,
  outputPath: string,
  options: PromptfooOptions = {},
): Promise<void> {
  await invoke(["export", "eval", evalId, "-o", outputPath], options);
}

// --force keeps re-collecting a CI run idempotent: without it a second import of the
// same eval id aborts the whole collection.
export async function importEval(filePath: string, options: PromptfooOptions = {}): Promise<void> {
  await invoke(["import", filePath, "--force"], options);
}
