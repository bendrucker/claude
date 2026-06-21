#!/usr/bin/env bun

import { join } from "node:path";
import { cli, command } from "cleye";
import {
  applyOverlay,
  fetchBase,
  findRedundantOps,
  loadPatch,
  loadSources,
} from "../../packages/validate/overlay";

const SCHEMAS_DIR = join(import.meta.dirname, "../../schemas");

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const check = command({ name: "check" }, async () => {
  let failed = false;
  for (const source of await loadSources(SCHEMAS_DIR)) {
    const [base, patch] = await Promise.all([
      fetchBase(source.url),
      loadPatch(SCHEMAS_DIR, source),
    ]);

    try {
      applyOverlay(base, patch);
      console.log(`${green("✓")} ${source.name}: overlay applies to current upstream`);
    } catch (error) {
      console.log(`${red("✗")} ${source.name}: ${(error as Error).message}`);
      failed = true;
    }

    for (const { index, path } of findRedundantOps(base, patch)) {
      console.log(
        `${red("✗")} ${source.patch} op[${index}] (${path}) is now in upstream — ` +
          `drop it from the overlay`,
      );
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(green("\nAll schema overlays are current with upstream."));
});

cli(
  {
    name: "schemas",
    commands: [check],
    help: {
      description:
        "Manage upstream-backed JSON schemas. Each is the upstream SchemaStore base fetched live plus an RFC 6902 overlay of our edits, merged in memory at validation time. `check` fetches current upstream, verifies the overlay still applies, and flags ops upstream has absorbed.",
    },
  },
  (parsed) => parsed.showHelp(),
);
