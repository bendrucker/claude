export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export type RunCommand = (
  command: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

// A missing binary surfaces as a spawn throw rather than an exit code. Reporting it
// as 127 lets callers that probe for an optional tool (the AWS CLI) treat "absent"
// and "unauthorized" the same way, while callers that require the tool still fail
// with its message in stderr.
export const runCommand: RunCommand = async (command, options = {}) => {
  const [bin, ...args] = command;
  if (bin === undefined) throw new Error("runCommand needs a command to run");

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([bin, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 127, stdout: "", stderr: message };
  }

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

export function expectSuccess(command: readonly string[], result: CommandResult): CommandResult {
  if (result.code === 0) return result;
  const detail = result.stderr.trim() === "" ? result.stdout.trim() : result.stderr.trim();
  throw new Error(`${formatCommand(command)} failed (exit ${result.code})\n${detail}`);
}
