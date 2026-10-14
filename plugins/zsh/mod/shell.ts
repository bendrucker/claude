import type { EngineInterface } from "claude-code";

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

const PROBE = `printf '%s\\n' "$ZSH_VERSION" ${OPTIONS.map((o) => `"\${options[${o}]}"`).join(" ")}`;

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

function fallback(path: string, error: string): Shell {
  return {
    path,
    version: null,
    active: isZsh(path),
    options: { ...DEFAULTS },
    gates: gatesOf(DEFAULTS),
    error,
  };
}

interface Probing {
  env: Pick<EngineInterface["env"], "get">;
  process: Pick<EngineInterface["process"], "run">;
}

export async function detect($: Probing): Promise<Shell> {
  // The Bash tool's own order: the override, then $SHELL, each only when it names
  // bash or zsh, then the first zsh on PATH.
  const candidates = [await $.env.get("CLAUDE_CODE_SHELL"), await $.env.get("SHELL")];
  const path = candidates.find((c) => c !== undefined && /bash|zsh/.test(c)) ?? "zsh";

  try {
    const result = await $.process.run([path, "-c", PROBE], { timeoutMs: 5000 });
    if (result.exitCode !== 0) return fallback(path, `probe exited ${result.exitCode}`);
    return parse(path, result.stdout);
  } catch (error) {
    return fallback(path, error instanceof Error ? error.message : String(error));
  }
}
