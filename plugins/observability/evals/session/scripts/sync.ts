#!/usr/bin/env bun

import { join } from "node:path";
import type { Corpus } from "../../../../../packages/eval-corpus/bucket";
import { syncCommand } from "../../../../../packages/eval-corpus/sync";

/** The session corpus as laid out under an `evals` directory. */
export function corpusAt(evals: string): Corpus {
  return {
    prefix: "session",
    description: "the session index's bench replay set, eval data and runs, and search labels",
    mirrors: [
      {
        local: join(evals, "bench"),
        remote: "bench",
        filters: [
          { exclude: "*" },
          { include: "replay.json" },
          { include: "snap/*" },
          { include: "results/*" },
        ],
      },
      {
        // The index stays out: bench.ts build regenerates it from the snapshot.
        local: join(evals, "session"),
        remote: "eval",
        filters: [
          { exclude: "*" },
          { include: "data/*" },
          { include: "results/*" },
          { exclude: "data/*.duckdb*" },
        ],
      },
      {
        local: join(evals, "search"),
        remote: "search",
        filters: [{ exclude: "*" }, { include: "labels.jsonl" }],
      },
    ],
  };
}

export const program = syncCommand(corpusAt(join(import.meta.dirname, "..", "..")));

if (import.meta.main) {
  await program.parseAsync();
}
