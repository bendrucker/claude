#!/usr/bin/env bun

import { join } from "node:path";
import { type Corpus, DOTFILES } from "../../../../../packages/eval-corpus/bucket";
import { syncCommand } from "../../../../../packages/eval-corpus/sync";

// results/ is gitignored, so the bucket is the permanent home of every run.

export const corpus: Corpus = {
  prefix: "issue-refine",
  description: "the issue-refine run results",
  mirrors: [
    { local: join(import.meta.dirname, "..", "results"), remote: "results", filters: [DOTFILES] },
  ],
};

export const program = syncCommand(corpus);

if (import.meta.main) {
  await program.parseAsync();
}
