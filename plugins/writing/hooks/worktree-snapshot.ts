#!/usr/bin/env bun

import { z } from "zod";
import { isPlanMode } from "./io";
import { lintTargets, snapshot } from "./worktree-changes";

const Input = z.looseObject({
  session_id: z.string(),
  cwd: z.string(),
  permission_mode: z.string().optional().catch(undefined),
});

async function main(): Promise<void> {
  const input = Input.parse(JSON.parse(await Bun.stdin.text()));
  if (isPlanMode(input)) return;
  await snapshot(input.session_id, input.cwd, lintTargets(input.cwd));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[writing/snapshot] ${error instanceof Error ? error.message : String(error)}`);
  });
}
