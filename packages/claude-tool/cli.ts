#!/usr/bin/env bun

import { join } from "node:path";

const [name, ...args] = process.argv.slice(2);

if (!name) {
  console.error("Usage: claude-tool <package> [args...]");
  process.exit(1);
}

const packagesDir = join(import.meta.dirname, "..");
const packageDir = join(packagesDir, name);

if (!(await Bun.file(join(packageDir, "package.json")).exists())) {
  console.error(`Unknown package: ${name}`);
  process.exit(1);
}

const child = Bun.spawn(["bun", packageDir, ...args], {
  stdio: ["inherit", "inherit", "inherit"],
});

process.exit(await child.exited);
