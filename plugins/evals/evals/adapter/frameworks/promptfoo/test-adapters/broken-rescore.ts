import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import type { Adapter } from "../../../../../../../packages/evals/adapter";
import { adapter as correct } from "./correct";

/** Re-scores under the committed graders, missing an uncommitted grader edit. */
export default {
  ...correct,
  async rescore(suite, path) {
    const head = await mkdtemp(join(tmpdir(), "broken-rescore-"));
    await $`git archive HEAD | tar -x -C ${head}`.cwd(suite).quiet();
    return correct.rescore(head, path);
  },
} satisfies Adapter;
