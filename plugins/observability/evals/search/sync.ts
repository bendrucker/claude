#!/usr/bin/env bun
// Moves eval data that names private sessions between this directory and the eval bucket, so it
// never lands in git. Pass the bucket prefix to reuse it from another harness.
import { basename } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";

const BUCKET = "s3://ben-drucker-agents-eval-corpus";

const program = new Command()
  .name("sync")
  .argument("<direction>", "pull or push")
  .argument("<file>", "local file, named as its key under the prefix")
  .option("--prefix <prefix>", "key prefix in the bucket", "session/search")
  .action(async (direction, file, o) => {
    const remote = `${BUCKET}/${o.prefix}/${basename(file)}`;
    if (direction === "pull") await $`aws s3 cp ${remote} ${file} --profile agents`;
    else if (direction === "push") await $`aws s3 cp ${file} ${remote} --profile agents-admin`;
    else program.error(`Unknown direction ${direction}; expected pull or push.`);
  });

await program.parseAsync();
