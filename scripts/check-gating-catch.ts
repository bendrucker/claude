#!/usr/bin/env bun

import { argv } from "node:process";
import { $ } from "bun";
import { z } from "zod";
import { decodeJson } from "../packages/decode/index";
import { runCheck } from "./check";

const GatingHook = z.object({ module: z.string(), hook: z.string(), hasCatch: z.boolean() });

const Report = z.object({
  contents: z.array(z.object({ gatingHooks: z.array(GatingHook).optional() })),
});

/**
 * Each gating hook in a `claude plugin validate --json` report registered
 * without a `.catch`. A failing hook there is skipped, so whether the call it
 * gates proceeds or is refused must be decided at the registration.
 */
export function uncaught(report: z.infer<typeof Report>): string[] {
  return report.contents
    .flatMap((content) => content.gatingHooks ?? [])
    .filter((hook) => !hook.hasCatch)
    .map((hook) => `${hook.module}: ${hook.hook}`);
}

if (import.meta.main) {
  const dir = argv[2];
  if (dir === undefined) throw new Error("usage: check-gating-catch.ts <plugin dir>");
  const output = await $`claude plugin validate ${dir} --json`
    .env({ ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" })
    .text();
  const report = decodeJson(Report, output, "claude plugin validate --json");
  await runCheck(() => ({
    header: `${dir}: gating hooks without .catch`,
    violations: uncaught(report),
  }));
}
