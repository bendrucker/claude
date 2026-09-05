#!/usr/bin/env bun
import { cli } from "cleye";
import { deferredPath, drop, isoDate, record, updateDeferrals } from "./deferred";

export async function defer(key: string, reason: string, at: Date, path: string): Promise<void> {
  await updateDeferrals(path, (current) => record(current, key, reason, isoDate(at)));
}

export async function undefer(key: string, path: string): Promise<void> {
  await updateDeferrals(path, (current) => drop(current, key));
}

if (import.meta.main) {
  const argv = cli({
    name: "defer",
    parameters: ["<key>", "[reason...]"],
    flags: {
      drop: {
        type: Boolean,
        description: "Remove the deferral instead of recording one",
      },
    },
    help: { description: "Record or drop a flock deferral, the write half of the board's held rows." },
  });

  const path = deferredPath(process.env);
  const key = argv._.key;
  const reason = argv._.reason.join(" ");

  if (argv.flags.drop === true) {
    await undefer(key, path);
    console.log(`dropped: ${key}`);
  } else if (reason === "") {
    console.error("usage: defer.ts <key> <reason> | defer.ts --drop <key>");
    process.exit(2);
  } else {
    await defer(key, reason, new Date(), path);
    console.log(`deferred: ${key}`);
  }
}
