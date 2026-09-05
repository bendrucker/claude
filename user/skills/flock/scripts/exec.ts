export interface CommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd?: string;
  readonly stdin?: string;
}

export type Run = (argv: readonly string[], options?: RunOptions) => Promise<CommandResult>;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const spawnRun: Run = async (argv, options) => {
  try {
    const proc = Bun.spawn([...argv], {
      cwd: options?.cwd,
      stdin: options?.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: "", stderr: reason(error) };
  }
};

/**
 * A board scan fans out over every worktree at once, which without a cap opens
 * several hundred concurrent `git` processes and turns the disk into the
 * bottleneck.
 */
export function limiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

export function throttle(run: Run, limit: number): Run {
  const gate = limiter(limit);
  return (argv, options) => gate(() => run(argv, options));
}
