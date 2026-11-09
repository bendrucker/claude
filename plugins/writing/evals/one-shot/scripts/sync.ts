#!/usr/bin/env bun

import { join } from "node:path";
import type { Corpus } from "../../../../../packages/eval-corpus/bucket";
import { syncCommand } from "../../../../../packages/eval-corpus/sync";

// data/ is gitignored because it holds text mined from sessions, so the
// bucket is its only shared home.

export const corpus: Corpus = {
  prefix: "one-shot",
  description: "the one-shot drafts",
  mirrors: [{ local: join(import.meta.dirname, "..", "data"), remote: "data" }],
};

export const program = syncCommand(corpus);

if (import.meta.main) {
  await program.parseAsync();
}
