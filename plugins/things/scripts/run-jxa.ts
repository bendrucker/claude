#!/usr/bin/env bun

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureThingsRunning } from "./ensure-running";

async function findJxaRunner(): Promise<string | null> {
  const pluginRoot = join(import.meta.dirname, "..");

  // Dev layout: sibling plugin directory
  const devPath = join(pluginRoot, "..", "mac", "scripts", "jxa.ts");
  if (await Bun.file(devPath).exists()) return devPath;

  // Prod layout: up 2 levels to marketplace root, then into mac/<version>/
  const marketplaceDir = join(pluginRoot, "..", "..", "mac");
  if (await Bun.file(marketplaceDir).exists()) {
    for (const entry of readdirSync(marketplaceDir)) {
      const candidate = join(marketplaceDir, entry, "scripts", "jxa.ts");
      if (await Bun.file(candidate).exists()) return candidate;
    }
  }

  return null;
}

if (import.meta.main) {
  await ensureThingsRunning();

  const jxaPath = await findJxaRunner();
  if (!jxaPath) {
    console.error("mac plugin jxa.ts not found — install the mac plugin");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const proc = Bun.spawn(["bun", jxaPath, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}
