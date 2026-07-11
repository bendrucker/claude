#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to osascript via ensure-running, which the command sandbox blocks

import { cli } from "cleye";
import { ensureThingsRunning } from "./ensure-running";
import { dispatch } from "./url";

const INTERMEDIATE_LIST: Record<string, string> = {
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
  await dispatch("json", params);
}

async function reorder(targetList: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error("No IDs provided");
    process.exit(1);
  }

  const intermediate = INTERMEDIATE_LIST[targetList];
  if (!intermediate) {
    console.error(`Invalid list: ${targetList}`);
    process.exit(1);
  }

  await updateWhen(ids, intermediate);
  await updateWhen(ids, targetList);

  console.log(JSON.stringify({ success: true, list: targetList, reordered: ids.length }));
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
  await reorder(argv.flags.list, argv._.ids);
}
