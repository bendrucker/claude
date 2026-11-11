#!/usr/bin/env bun

import { globSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { type Corpus, DOTFILES } from "../../../../../packages/eval-corpus/bucket";
import { syncCommand } from "../../../../../packages/eval-corpus/sync";

/** The pr-body corpus as laid out under an `evals` directory. */
export function corpusAt(evals: string): Corpus {
  const scenarios = join(evals, "create-scenarios");
  return {
    prefix: "pr-body",
    description: "the pr-body fixtures and create-scenarios cases",
    mirrors: [
      { local: join(evals, "pr-body", "fixtures"), remote: "fixtures" },
      {
        local: join(evals, "pr-body", "data", "revisions"),
        remote: "data/revisions",
        filters: [DOTFILES],
      },
      {
        local: scenarios,
        remote: "create-scenarios",
        filters: [
          { exclude: "*" },
          { include: "scenario-*" },
          { include: "examples/scenario-*" },
          { include: "work-*" },
          { include: "examples/work-*" },
        ],
      },
    ],
    // S3 drops file modes, and the runner executes each case's scaffold script.
    afterPull: async () => {
      const scripts = globSync("*/fixture.sh", { cwd: scenarios });
      if (scripts.length > 0) await $`chmod +x ${scripts}`.cwd(scenarios);
    },
  };
}

export const program = syncCommand(corpusAt(join(import.meta.dirname, "..", "..")));

if (import.meta.main) {
  await program.parseAsync();
}
