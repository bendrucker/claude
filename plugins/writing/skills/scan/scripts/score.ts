#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { lintFile, valeWords } from "../../../detection/vale";
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

function density(hits: number, wordCount: number): number {
  if (wordCount === 0) return 0;
  return hits / (wordCount / 1000);
}

/** Alerts per 1000 words for each check in the file at `filePath`, counting words as Vale does. */
export async function scoreFile(filePath: string): Promise<ScoreReport> {
  const [alerts, words] = await Promise.all([lintFile(filePath), valeWords(filePath)]);
  const wordCount = words ?? 0;
  const counts = new Map<string, number>();
  for (const alert of alerts) counts.set(alert.Check, (counts.get(alert.Check) ?? 0) + 1);
  const checks = [...counts].map(([check, hits]) => ({
    check,
    hits,
    density: density(hits, wordCount),
  }));
  return { filePath, wordCount, checks };
}

/** Score `text` as a markdown file. */
export async function scoreText(text: string): Promise<ScoreReport> {
  const dir = await mkdtemp(join(tmpdir(), "score-"));
  try {
    const filePath = join(dir, "input.md");
    await Bun.write(filePath, text);
    return { ...(await scoreFile(filePath)), filePath: undefined };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      const report = filePath === undefined ? await scoreText(text) : await scoreFile(filePath);
      console.log(argv.flags.json ? JSON.stringify(report, null, 2) : renderTable(report));
    },
  );
}
