export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function parsePermissionMode(value: string): PermissionMode {
  const mode = PERMISSION_MODES.find((m) => m === value);
  if (!mode) {
    throw new Error(
      `Invalid permission mode: ${value} (expected one of ${PERMISSION_MODES.join(", ")})`,
    );
  }
  return mode;
}

export function buildWtArgs({
  paneName,
  sessionId,
  prompt,
  permissionMode,
}: {
  paneName: string;
  sessionId: string;
  prompt: string;
  permissionMode?: PermissionMode | undefined;
}): string[] {
  return [
    "wt",
    "switch",
    "--create",
    paneName,
    "-x",
    "claude",
    "--",
    "--session-id",
    sessionId,
    "--name",
    paneName,
    ...(permissionMode ? ["--permission-mode", permissionMode] : []),
    prompt,
  ];
}
