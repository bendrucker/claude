#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to osascript via ensure-running, which the command sandbox blocks

import { cli } from "cleye";
import { ensureThingsRunning } from "./ensure-running";
import { dispatch, warnFallback } from "./url";

const INTERMEDIATE_LIST: Record<string, string | undefined> = {
  today: "anytime",
  anytime: "someday",
  someday: "anytime",
};

async function updateWhen(ids: string[], when: string): Promise<void> {
  const params = new Map<string, string>();
  params.set(
    "data",
    JSON.stringify(
      ids.map((id) => ({
        type: "to-do",
        operation: "update",
        id,
        attributes: { when },
      })),
    ),
  );
  // Reordering moves the todos out of the list and back, so the second update
  // must land after the first. A fire-and-forget open guarantees no such order.
  warnFallback(await dispatch("json", params));
}

export interface ReorderResult {
  success: true;
  list: string;
  reordered: number;
}

/**
 * Throws on bad input and returns its outcome, leaving both for the caller to
 * present. The MCP server calls this on a live stdio connection, where an exit
 * ends the session and a print to stdout corrupts the JSON-RPC framing.
 */
export async function reorder(targetList: string, ids: string[]): Promise<ReorderResult> {
  if (ids.length === 0) {
    throw new Error("No IDs provided");
  }

  const intermediate = INTERMEDIATE_LIST[targetList];
  if (intermediate === undefined) {
    throw new Error(`Invalid list: ${targetList}`);
  }

  await updateWhen(ids, intermediate);
  await updateWhen(ids, targetList);

  return { success: true, list: targetList, reordered: ids.length };
}

if (import.meta.main) {
  const argv = cli({
    name: "reorder",
    parameters: ["[ids...]"],
    flags: {
      list: {
        type: String,
        default: "today",
        description: "Target list: today (default), anytime, someday",
      },
    },
  });

  await ensureThingsRunning();

  try {
    console.log(JSON.stringify(await reorder(argv.flags.list, argv._.ids)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
