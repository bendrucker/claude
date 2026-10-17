export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function parsePermissionMode(value: string): PermissionMode {
  const mode = PERMISSION_MODES.find((m) => m === value);
  if (mode == null) {
    throw new Error(
      `Invalid permission mode: ${value} (expected one of ${PERMISSION_MODES.join(", ")})`,
    );
  }
  return mode;
}

// Build the `claude` args that launch a background review session bound to the
// `review` agent. The session collects in `claude agents` and, on its first
// write (the agent's `gh pr checkout`), the harness moves it into an isolated
// worktree, so parallel reviews never share a working tree. `--bg` assigns and
// manages its own session id (it rejects `--session-id`), so the id is read
// back from stdout with parseBackgroundedId rather than supplied. The PR URL is
// the session's initial prompt. The review agent's own initialPrompt drives the
// checkout-and-review workflow.
export function buildDispatchArgs({
  url,
  permissionMode,
}: {
  url: string;
  permissionMode?: PermissionMode | undefined;
}): string[] {
  return [
    "--bg",
    "--agent",
    "review",
    ...(permissionMode != null ? ["--permission-mode", permissionMode] : []),
    url,
  ];
}

// Read the short session id `claude --bg` prints ("backgrounded · <id>"). The
// id is wrapped in ANSI color codes. Dropping each code's `[<params>m` payload
// leaves only a bare escape byte before the id, which is non-hex noise the id
// match skips. Returns null when the line is absent (an older claude, or a
// launch failure that still exited zero).
export function parseBackgroundedId(stdout: string): string | null {
  const clean = stdout.replaceAll(/\[[0-9;]*m/g, "");
  const match = clean.match(/backgrounded[^0-9a-f]*([0-9a-f]{6,})/i);
  return match?.[1] ?? null;
}
