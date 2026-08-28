#!/usr/bin/env bun

import { join } from "node:path";
import { cli, command } from "cleye";
import {
  applyOverlay,
  fetchBase,
  findOverlayConflicts,
  loadPatch,
  loadSources,
} from "../../packages/validate/overlay";

const SCHEMAS_DIR = join(import.meta.dirname, "../../schemas");

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const check = command({ name: "check" }, async () => {
  let failed = false;
  let warned = false;
  for (const source of await loadSources(SCHEMAS_DIR)) {
    // oxlint-disable-next-line no-await-in-loop -- each source prints its verdict as it is checked, so the fetches follow the printed order.
    const [base, patch] = await Promise.all([
      fetchBase(source.url),
      loadPatch(SCHEMAS_DIR, source),
    ]);

    try {
      applyOverlay(base, patch);
      console.log(`${green("✓")} ${source.name}: overlay applies to current upstream`);
    } catch (error) {
      console.log(
        `${red("✗")} ${source.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      failed = true;
    }

    for (const { index, path, kind } of findOverlayConflicts(base, patch)) {
      if (kind === "absorbed") {
        console.log(
          `${red("✗")} ${source.patch} op[${index}] (${path}) is now in upstream. ` +
            `Drop it from the overlay.`,
        );
        failed = true;
      } else {
        console.log(
          `${yellow("⚠")} ${source.patch} op[${index}] (${path}) replaces a definition ` +
            `upstream now ships. Confirm the override is still intended, otherwise drop the op.`,
        );
        warned = true;
      }
    }
  }
  if (failed) process.exit(1);
  if (warned) {
    console.log(yellow("\nSchema overlays apply, but some ops overwrite an upstream definition."));
    return;
  }
  console.log(green("\nAll schema overlays are current with upstream."));
});

await cli(
  {
    name: "schemas",
    commands: [check],
    help: {
      description:
        "Manage upstream-backed JSON schemas. Each is the upstream SchemaStore base fetched live plus an RFC 6902 overlay of our edits, merged in memory at validation time. `check` fetches current upstream, verifies the overlay still applies, flags ops upstream has absorbed, and warns on ops that overwrite an upstream definition.",
    },
  },
  (parsed) => parsed.showHelp(),
);
