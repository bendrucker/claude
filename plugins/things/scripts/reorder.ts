#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to Launch Services (open) for Things URL schemes

import { $ } from "bun";
import { ensureThingsRunning } from "./ensure-running";
import { buildUrl } from "./url";

const INTERMEDIATE_LIST: Record<string, string> = {
  today: "anytime",
  anytime: "someday",
  someday: "anytime",
};

async function openJsonUrl(data: object[]): Promise<void> {
  const params = new Map<string, string>();
  params.set("data", JSON.stringify(data));
  const url = await buildUrl("json", params);
  await $`open -g ${url}`;
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

  await openJsonUrl(
    ids.map((id) => ({
      type: "to-do",
      operation: "update",
      id,
      attributes: { when: intermediate },
    })),
  );

  await openJsonUrl(
    ids.map((id) => ({
      type: "to-do",
      operation: "update",
      id,
      attributes: { when: targetList },
    })),
  );

  console.log(JSON.stringify({ success: true, list: targetList, reordered: ids.length }));
}

if (import.meta.main) {
  const { cli } = await import("cleye");

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
