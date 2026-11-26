import type { ProcessRunResult } from "claude-code";

export interface Shell {
  path: string;
  version: string | null;
  active: boolean;
  error: string | null;
}

export const PROBE = `printf '%s\\n' "$ZSH_VERSION"`;

export function parse(path: string, stdout: string): Shell {
  const version = stdout.split("\n")[0]?.trim() ?? "";
  return { path, version: version || null, active: version !== "", error: null };
}

function isZsh(path: string): boolean {
  return /(^|\/)zsh$/.test(path);
}

export function fallback(path: string, error: string): Shell {
  return { path, version: null, active: isZsh(path), error };
}

// CLAUDE_CODE_SHELL, then $SHELL, each only when it names bash or zsh,
// then the first zsh on PATH.
export function resolve(candidates: (string | undefined)[]): string {
  return candidates.find((c) => c !== undefined && /bash|zsh/.test(c)) ?? "zsh";
}

export function probed(path: string, result: ProcessRunResult): Shell {
  if (result.exitCode !== 0) return fallback(path, `probe exited ${result.exitCode}`);
  return parse(path, result.stdout);
}
