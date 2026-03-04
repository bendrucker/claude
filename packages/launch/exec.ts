import type { CommandResult } from "./command";
import type { TuiResult } from "./tui";

export type ExecOptions = {
  command: CommandResult;
  tuiResult: TuiResult;
  cwd?: string;
};

export async function exec(options: ExecOptions): Promise<never> {
  const { command, tuiResult, cwd } = options;
  const env = { ...process.env, ...command.env };

  if (tuiResult.worktree) {
    const execCmd = command.args
      .map((a) => (a.includes(" ") || a.includes("{") ? `'${a}'` : a))
      .join(" ");
    const envPrefix = Object.entries(command.env)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    const fullExec = envPrefix ? `${envPrefix} ${execCmd}` : execCmd;

    const wtArgs = [
      "wt",
      "switch",
      ...(tuiResult.createBranch ? ["--create"] : []),
      tuiResult.worktree,
      ...(cwd ? ["-C", cwd] : []),
      "--execute",
      fullExec,
    ];
    const child = Bun.spawn(wtArgs, {
      env,
      stdio: ["inherit", "inherit", "inherit"],
    });
    process.exit(await child.exited);
  }

  const [cmd = "claude", ...args] = command.args;
  const child = Bun.spawn([cmd, ...args], {
    env,
    ...(cwd ? { cwd } : {}),
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await child.exited);
}
