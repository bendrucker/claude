#!/usr/bin/env bun

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

export interface ReorderResult {
  success: true;
  list: string;
  reordered: number;
}

export async function reorder(targetList: string, ids: string[]): Promise<ReorderResult> {
  if (ids.length === 0) {
    throw new Error("No IDs provided");
  }

  const intermediate = INTERMEDIATE_LIST[targetList];
  if (!intermediate) {
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
    const result = await reorder(argv.flags.list, argv._.ids);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
