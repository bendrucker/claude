import { expect, test } from "bun:test";
import { BUCKET, SEEDS, syncArgs } from "./sync";

test.each<{ direction: "pull" | "push"; from: string; to: string }>([
  { direction: "pull", from: BUCKET, to: SEEDS },
  { direction: "push", from: SEEDS, to: BUCKET },
])("$direction copies from $from", ({ direction, from, to }) => {
  expect(syncArgs(direction, { profile: "p", dryRun: true })).toEqual([
    "s3",
    "sync",
    from,
    to,
    "--exclude",
    ".*",
    "--profile",
    "p",
    "--dryrun",
  ]);
});
