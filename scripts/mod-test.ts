#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: claude plugin test creates its scratch dirs where the sandbox denies writes

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";

// `claude plugin test` runs every *.test.ts under the plugin, bun tests
// included, so it runs against a copy holding only what a mod loads.
const PARTS = [".claude-plugin", "hooks/hooks.json", "mod"];

const argv = cli({
  name: "mod-test",
  parameters: ["<plugin>"],
  help: { description: "Run a plugin's mod tests under claude plugin test" },
});

const plugin = argv._.plugin;
const source = join(import.meta.dirname, "..", "plugins", plugin);
const stage = await mkdtemp(join(tmpdir(), "mod-test-"));
const dir = join(stage, plugin);

try {
  await mkdir(join(dir, "hooks"), { recursive: true });
  await Promise.all(PARTS.map((part) => $`cp -R ${join(source, part)} ${join(dir, part)}`));
  const proc = Bun.spawn(["claude", "plugin", "test", dir], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" },
  });
  process.exitCode = await proc.exited;
} finally {
  await rm(stage, { recursive: true, force: true });
}
