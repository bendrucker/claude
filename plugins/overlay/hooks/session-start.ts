#!/usr/bin/env bun

import { join } from "node:path";
import { z } from "zod";
import { type OverlayStatus, overlayStatus } from "../scripts/link";

const HookInput = z.looseObject({ cwd: z.string() });

export function warning(status: OverlayStatus): string | null {
  if (!status.exists || status.state?.kind === "linked") return null;
  return `An overlay exists for ${status.key} but ${join(status.checkout, ".claude")} is not linked. Run claude-overlay link there, then restart the session to pick up its settings.`;
}

async function main(): Promise<void> {
  const input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  const message = warning(await overlayStatus(input.cwd));
  if (message == null) return;

  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
