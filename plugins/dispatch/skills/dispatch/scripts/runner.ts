export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  // A fetch over SSH waits on an agent that may be waiting on a hardware key,
  // which never returns unattended.
  timeoutMs?: number;
  // An undefined value removes the variable.
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export type Runner = (argv: readonly string[], options?: RunOptions) => Promise<CommandResult>;

export type Pause = (ms: number) => Promise<void>;

// The claude-dispatch sandbox.excludedCommands entry covers the whole invocation,
// so every subprocess takes an argv array.
export const spawnRunner: Runner = async (argv, options) => {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...options?.env }).filter(
          (entry): entry is [string, string] => entry[1] != null,
        ),
      ),
      cwd: options?.cwd ?? process.cwd(),
    });
  } catch (error) {
    // Spawning throws when the binary is missing, which would escape the
    // DispatchError contract and lose the partial record with it.
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 127, stdout: "", stderr: `${argv[0]}: ${reason}\n` };
  }
  const timer =
    options?.timeoutMs == null
      ? null
      : setTimeout(() => {
          proc.kill();
        }, options.timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (options?.timeoutMs == null || proc.signalCode == null) return { code, stdout, stderr };
    return {
      code: code === 0 ? 124 : code,
      stdout,
      stderr: `${stderr}${argv[0]}: killed after ${options.timeoutMs}ms\n`,
    };
  } finally {
    if (timer != null) clearTimeout(timer);
  }
};
