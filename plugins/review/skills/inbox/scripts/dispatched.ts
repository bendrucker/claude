#!/usr/bin/env bun

import { Command } from "@commander-js/extra-typings";
import { table } from "table";
import { readState, removeDispatch, writeState } from "./store";

// Inspect and edit the inbox's dedup set. Completion and live status are owned
// by `claude agents`; this only manages which URLs the inbox considers already
// dispatched. `--reset` clears the set at the start of a fresh inbox session so
// a re-request can dispatch again; `remove` untracks a single URL.
export const program = new Command("dispatched")
  .argument("[command]")
  .option("--url <url>", "PR/MR URL (for remove)")
  .option("--json", "Output as JSON", false)
  .option("--data-dir <dir>", "Data directory (defaults to CLAUDE_PLUGIN_DATA)")
  .option("--reset", "Clear all dispatched reviews and exit", false)
  .action(async (name, flags) => {
    const { dataDir } = flags;

    if (flags.reset) {
      await writeState({ dispatched: [] }, dataDir);
      console.log("Cleared dispatched reviews");
      process.exit(0);
    }

    const command = name ?? "list";

    switch (command) {
      case "list": {
        const state = await readState(dataDir);
        if (flags.json) {
          console.log(JSON.stringify(state.dispatched, null, 2));
        } else if (state.dispatched.length === 0) {
          console.log("No dispatched reviews");
        } else {
          const headers = ["URL", "Session", "Dispatched"];
          const rows = state.dispatched.map((d) => [
            d.url,
            d.sessionId?.slice(0, 8) ?? "-",
            d.dispatchedAt.slice(0, 19),
          ]);
          console.log(table([headers, ...rows]));
        }
        break;
      }

      case "remove": {
        const { url } = flags;
        if (url == null || url === "") {
          console.error("--url is required for remove");
          process.exit(1);
        }
        const state = await readState(dataDir);
        const removed = removeDispatch(state, url);
        await writeState(state, dataDir);
        console.log(`Removed ${removed} dispatch(es)`);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Commands: list, remove (or --reset)");
        process.exit(1);
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
