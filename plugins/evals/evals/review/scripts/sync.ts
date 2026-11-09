#!/usr/bin/env bun

import { join } from "node:path";
import type { Corpus } from "../../../../../packages/eval-corpus/bucket";
import { syncCommand } from "../../../../../packages/eval-corpus/sync";

export const SEEDS = join(import.meta.dirname, "..", "seeds");

export const corpus: Corpus = {
  prefix: "review",
  description: "the review suite's seeds",
  mirrors: [{ local: SEEDS, remote: "seeds" }],
};

export const program = syncCommand(corpus);

if (import.meta.main) {
  await program.parseAsync();
}
