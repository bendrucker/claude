#!/usr/bin/env bun

import { join } from "node:path";
import { cli } from "cleye";
import { loadScenarios, type Scenario } from "./run-eval";

// `scenarios/` is the source of truth. promptfoo reads the generated `cases.json`,
// and `--check` fails when the two have drifted, so a scenario edit cannot slip
// past the suite unnoticed.

const BRANCH_MAX = 40;

/**
 * The branch a reviewer would see on the PR. Scenario titles carry a `subject: `
 * prefix naming the area, so the slug starts after it.
 */
export function branchName(title: string): string {
  const [prefix = "", ...rest] = title.split(": ");
  const summary = rest.length > 0 && !prefix.includes(" ") ? rest.join(": ") : title;
  const words = summary
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");

  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const next = length === 0 ? word.length : length + 1 + word.length;
    if (kept.length > 0 && next > BRANCH_MAX) break;
    kept.push(word);
    length = next;
  }
  return kept.join("-");
}

export function renderSubstance(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "(none recorded)";
}

export interface Case {
  description: string;
  vars: {
    repo: string;
    tier: string;
    base: string;
    branch: string;
    diffSummary: string;
    substance: string;
  };
  metadata: { scenarioId: string; url: string };
}

export function toCase(scenario: Scenario): Case {
  return {
    description: scenario.id,
    vars: {
      repo: scenario.repo,
      tier: scenario.tier,
      base: "main",
      branch: branchName(scenario.title),
      diffSummary: scenario.diffSummary.trim(),
      substance: renderSubstance(scenario.substance),
    },
    metadata: { scenarioId: scenario.id, url: scenario.url },
  };
}

export function renderCases(scenarios: readonly Scenario[]): string {
  return `${JSON.stringify(scenarios.map(toCase), null, 2)}\n`;
}

async function main(): Promise<void> {
  const dir = join(import.meta.dirname, "..");
  const argv = cli({
    name: "cases",
    help: { description: "Render scenarios/ into the promptfoo cases file." },
    flags: {
      scenarios: {
        type: String,
        default: join(dir, "scenarios"),
        description: "Directory of scenario JSON files",
      },
      out: {
        type: String,
        default: join(dir, "cases.json"),
        description: "Cases file promptfoo reads",
      },
      check: {
        type: Boolean,
        default: false,
        description: "Exit non-zero when the cases file is stale instead of rewriting it",
      },
    },
  });

  const rendered = renderCases(await loadScenarios(argv.flags.scenarios));
  const out = Bun.file(argv.flags.out);

  if (argv.flags.check) {
    const current = (await out.exists()) ? await out.text() : "";
    if (current === rendered) return;
    console.error(`${argv.flags.out} is stale. Run: bun run --cwd evals/pr-body cases`);
    process.exit(1);
  }

  await Bun.write(out, rendered);
  console.error(argv.flags.out);
}

if (import.meta.main) {
  await main();
}
