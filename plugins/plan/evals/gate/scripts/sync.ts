#!/usr/bin/env bun

import { join } from "node:path";
import { type Corpus, DOTFILES } from "../../../../../packages/eval-corpus/bucket";
import { syncCommand } from "../../../../../packages/eval-corpus/sync";

// data/ holds work-host plan text, so the bucket is its permanent home and the
// checkout keeps only a gitignored copy.

export const corpus: Corpus = {
  prefix: "plan-gate",
  description: "the plan gate's mined presentations and replay baseline",
  mirrors: [
    { local: join(import.meta.dirname, "..", "data"), remote: "data", filters: [DOTFILES] },
  ],
};

export const program = syncCommand(corpus);

if (import.meta.main) {
  await program.parseAsync();
}
