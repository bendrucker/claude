#!/usr/bin/env bun
import { cli } from "cleye";
import { table } from "table";
import { stripCode } from "../../../detection/code-spans";
import { lintProse } from "../../../detection/vale";
import { readInput } from "../../../scripts/io";

export interface CheckScore {
  check: string;
  hits: number;
  density: number;
}

export interface ScoreReport {
  filePath: string | undefined;
  wordCount: number;
  checks: CheckScore[];
}

function countWords(text: string): number {
  return text.match(/[a-zA-Z]+/g)?.length ?? 0;
}

function density(hits: number, wordCount: number): number {
  if (wordCount === 0) return 0;
  return hits / (wordCount / 1000);
}

async function checkScores(
  text: string,
  filePath: string | undefined,
  wordCount: number,
): Promise<CheckScore[]> {
  const counts = new Map<string, number>();
  for (const alert of await lintProse(text, filePath)) {
    counts.set(alert.Check, (counts.get(alert.Check) ?? 0) + 1);
  }
  return [...counts.entries()].map(([check, hits]) => ({
    check,
    hits,
    density: density(hits, wordCount),
  }));
}

/** Alerts per 1000 words for each check, over the text with code stripped. */
export async function scoreText(text: string, filePath: string | undefined): Promise<ScoreReport> {
  const wordCount = countWords(stripCode(text));
  return { filePath, wordCount, checks: await checkScores(text, filePath, wordCount) };
}

function formatDensity(value: number): string {
  return value.toFixed(1);
}

export function renderTable(report: ScoreReport): string {
  const header = `${report.wordCount} words`;
  const rows = report.checks
    .toSorted((a, b) =>
      b.density === a.density ? a.check.localeCompare(b.check) : b.density - a.density,
    )
    .map((c) => [c.check, String(c.hits), formatDensity(c.density)]);
  if (rows.length === 0) return `${header}\nNo alerts.`;
  return `${header}\n${table([["Check", "Hits", "Density /1k"], ...rows])}`.trimEnd();
}

if (import.meta.main) {
  await cli(
    {
      name: "score",
      parameters: ["[input]"],
      help: {
        description:
          "Score one input (file path, inline text, or stdin) for trope density per 1000 words. Informational: always exits 0.",
      },
      flags: {
        json: {
          type: Boolean,
          description: "Emit the report as JSON for comparing two runs",
          default: false,
        },
      },
    },
    async (argv) => {
      const { text, filePath } = await readInput(argv._.input);
      const report = await scoreText(text, filePath);
      console.log(argv.flags.json ? JSON.stringify(report, null, 2) : renderTable(report));
    },
  );
}
