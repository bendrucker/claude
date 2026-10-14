import type { ProcessRunResult } from "claude-code";

export type Option = "nomatch" | "nullglob" | "cshnullglob" | "equals";

export interface Shell {
  path: string;
  version: string | null;
  active: boolean;
  options: Record<Option, boolean>;
  gates: { glob: boolean; equals: boolean };
  error: string | null;
}

export const DEFAULTS: Record<Option, boolean> = {
  nomatch: true,
  nullglob: false,
  cshnullglob: false,
  equals: true,
};

const OPTIONS: Option[] = ["nomatch", "nullglob", "cshnullglob", "equals"];

export const PROBE = `printf '%s\\n' "$ZSH_VERSION" ${OPTIONS.map((o) => `"\${options[${o}]}"`).join(" ")}`;

function gatesOf(options: Record<Option, boolean>): Shell["gates"] {
  return {
    glob: options.nomatch && !options.nullglob && !options.cshnullglob,
    equals: options.equals,
  };
}

export function parse(path: string, stdout: string): Shell {
  const [version = "", ...flags] = stdout.split("\n");
  const options = { ...DEFAULTS };
  for (const [i, option] of OPTIONS.entries()) {
    const flag = flags[i]?.trim();
    if (flag === "on" || flag === "off") options[option] = flag === "on";
  }
  return {
    path,
    version: version.trim() || null,
    active: version.trim() !== "",
    options,
    gates: gatesOf(options),
    error: null,
  };
}

function isZsh(path: string): boolean {
  return /(^|\/)zsh$/.test(path);
}

export function fallback(path: string, error: string): Shell {
  return {
    path,
    version: null,
    active: isZsh(path),
    options: { ...DEFAULTS },
    gates: gatesOf(DEFAULTS),
    error,
  };
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
