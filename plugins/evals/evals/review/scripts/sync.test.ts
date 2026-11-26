import { expect, test } from "bun:test";
import { s3 } from "../../../../../packages/eval-corpus/storage";
import { sync } from "../../../../../packages/eval-corpus/sync";
import { corpus, SEEDS } from "./sync";

test.each<{ direction: "pull" | "push"; from: string; to: string }>([
  { direction: "pull", from: "s3://ben-drucker-agents-eval-corpus/review/seeds", to: SEEDS },
  { direction: "push", from: SEEDS, to: "s3://ben-drucker-agents-eval-corpus/review/seeds" },
])("$direction copies from $from", async ({ direction, from, to }) => {
  const calls: string[][] = [];
  const run = (args: string[]): Promise<void> => {
    calls.push(args);
    return Promise.resolve();
  };
  await sync(corpus, direction, s3({ profile: "p", dryRun: true, run }));
  expect(calls).toEqual([
    ["s3", "sync", from, to, "--exclude", ".*", "--profile", "p", "--dryrun"],
  ]);
});
