#!/usr/bin/env bun

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function findJxaRunner(): string | null {
  const pluginRoot = join(import.meta.dirname, "..");

  // Dev layout: sibling plugin directory
  const devPath = join(pluginRoot, "..", "mac", "scripts", "jxa.ts");
  if (existsSync(devPath)) return devPath;

  // Prod layout: up 2 levels to marketplace root, then into mac/<version>/
  const marketplaceDir = join(pluginRoot, "..", "..", "mac");
  if (existsSync(marketplaceDir)) {
    for (const entry of readdirSync(marketplaceDir)) {
      const candidate = join(marketplaceDir, entry, "scripts", "jxa.ts");
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

if (import.meta.main) {
  const jxaPath = findJxaRunner();
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
