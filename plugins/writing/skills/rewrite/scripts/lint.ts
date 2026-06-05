#!/usr/bin/env bun
import { scanAll } from "../../../hooks/scan";

async function readInput(arg: string | undefined): Promise<{ text: string; filePath?: string }> {
  if (arg && (await Bun.file(arg).exists())) {
    return { text: await Bun.file(arg).text(), filePath: arg };
  }
  if (arg) {
    return { text: arg };
  }
  return { text: await new Response(Bun.stdin.stream()).text() };
}

async function main(): Promise<void> {
  const { text, filePath } = await readInput(process.argv[2]);
  const violations = scanAll(text, filePath);

  if (violations.length === 0) {
    console.log("No violations found.");
    process.exit(0);
  }

  for (const v of violations) {
    console.log(`${v.line}:${v.col}: ${v.category}: ${v.message}`);
  }

  process.exit(1);
}

await main();
