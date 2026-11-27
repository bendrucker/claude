export const MUXES = ["rex", "herdr", "bg"] as const;
export type Mux = (typeof MUXES)[number];

// The host multiplexer is the default, and bg never is. A nested pane inherits
// the outer multiplexer's variables, so the environment cannot say which is inner.
export function detectMux(env: Readonly<Record<string, string | undefined>>): Mux {
  const rex = env.REX_BLOCK != null && env.REX_BLOCK !== "";
  const herdr = env.HERDR_ENV === "1";
  if (rex && herdr)
    throw new Error(
      "this session runs under both Rex and herdr, nested; pass --mux rex or --mux herdr",
    );
  if (rex) return "rex";
  if (herdr) return "herdr";
  throw new Error("no multiplexer hosts this session; pass --mux rex, --mux herdr, or --mux bg");
}

export function describeMuxDefault(env: Readonly<Record<string, string | undefined>>): string {
  try {
    return `defaults to ${detectMux(env)}, the multiplexer hosting this session`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// Variables the launching session set for itself would bind a background
// session to this one. Settings re-apply their own env in the new session.
export function detachedEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, undefined> {
  return Object.fromEntries(
    Object.keys(env)
      .filter((key) => /^CLAUDE(?:CODE$|_)/.test(key) && key !== "CLAUDE_CODE_OAUTH_TOKEN")
      .map((key) => [key, undefined]),
  );
}

// `claude --bg` prints the id `claude attach` takes, alone or inside a hint.
export function backgroundId(stdout: string): string | null {
  const hinted = /claude (?:attach|logs|stop) (\S+)/.exec(stdout)?.[1];
  if (hinted != null) return hinted;
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  const only = lines.length === 1 ? lines[0]?.trim() : undefined;
  return only != null && /^\S+$/.test(only) ? only : null;
}
