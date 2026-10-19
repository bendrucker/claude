import { expect, test } from "bun:test";
import { mirrors, syncArgs } from "./sync";

const [, suite] = mirrors;

test("pulls from the bucket under a profile, or with the environment's credentials", () => {
  expect(syncArgs(suite!, "pull", { profile: "agents" }).slice(2, 4)).toEqual([
    suite!.remote,
    suite!.local,
  ]);
  expect(syncArgs(suite!, "push", { profile: false, dryRun: true })).not.toContain("--profile");
});
