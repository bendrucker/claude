#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { cli } from "cleye";
import { stemmer } from "stemmer";
import {
  type CorrectionRow,
  execSessionQuery,
  type ModelSummaryRow,
  runSessionQuery,
  serializeCorpus,
  type TextRow,
  totalChars,
} from "./dump";
import { type CorpusStats, computeLift, excludePhrases, processCorpus } from "./ngram";
import { buildRuleHealth, type FtsAuditRow, renderReport, type TermLiftRow } from "./report";
import { loadWordlists, type WordlistEntry } from "./wordlists";

const argv = cli({
  name: "analyze",
  flags: {
    since: {
      type: String,
      description: "Lower bound date YYYY-MM-DD (default: 30 days ago)",
    },
    until: {
      type: String,
      description: "Upper bound date YYYY-MM-DD (default: today)",
    },
    model: {
      type: String,
      description: "Model glob filter for assistant corpus",
      default: "*opus*",
    },
    project: {
      type: String,
      description: "Project glob filter",
    },
    minLift: {
      type: Number,
      description: "Minimum lift threshold for keep/include decisions",
      default: 5.0,
    },
    top: {
      type: Number,
      description: "Top N candidate phrases to surface",
      default: 30,
    },
    out: {
      type: String,
      description: "Output report path (default: tmp/trope-analysis-<date>.md)",
    },
    sessionQuery: {
      type: String,
      description: "Path to session plugin query.ts (overrides auto-resolution)",
    },
    wordlistsDir: {
      type: String,
      description: "Wordlists directory (defaults to plugins/writing/wordlists)",
    },
    correctionsLimit: {
      type: Number,
      description: "Max correction candidates to include",
      default: 30,
    },
  },
});

const today = new Date().toISOString().slice(0, 10);
const since = argv.flags.since ?? daysAgo(30);
const until = argv.flags.until ?? today;
const modelFilter = argv.flags.model;
const projectFilter = argv.flags.project ?? null;
const minLift = argv.flags.minLift;
const topN = argv.flags.top;
const correctionsLimit = argv.flags.correctionsLimit;

const queryScript = await resolveQueryScript(argv.flags.sessionQuery);
const wordlistsDir = argv.flags.wordlistsDir ?? defaultWordlistsDir();
const outPath = argv.flags.out ?? path.join("tmp", `trope-analysis-${today}.md`);
const ftsQueryDir = path.join(import.meta.dirname, "..", "resources", "queries");

await main();

async function main(): Promise<void> {
  process.stderr.write(`Refreshing session index via ${queryScript}\n`);
  await runSessionQuery(queryScript, "schema", {}, { refresh: true });

  process.stderr.write("Loading current wordlists\n");
  const wordlistEntries = await loadWordlists(wordlistsDir);
  process.stderr.write(`Loaded ${wordlistEntries.length} wordlist entries from ${wordlistsDir}\n`);

  process.stderr.write("Building FTS indexes\n");
  await execSessionQuery(
    queryScript,
    "fts-setup",
    {
      after_date: since,
      before_date: until,
      model: modelFilter,
      project: projectFilter ?? undefined,
    },
    { queryDir: ftsQueryDir },
  );

  try {
    process.stderr.write("Computing vocabulary lift via FTS\n");
    const vocabTerms = await runSessionQuery<TermLiftRow>(
      queryScript,
      "fts-term-lift",
      {
        min_count: 5,
        limit: 100,
      },
      { queryDir: ftsQueryDir },
    );

    process.stderr.write("Auditing wordlists via FTS\n");
    const auditByTerm = await auditWordlistsFts(wordlistEntries);

    process.stderr.write("Fetching model summary\n");
    const modelSummary = await runSessionQuery<ModelSummaryRow>(queryScript, "model-summary", {
      after_date: since,
      before_date: until,
      project: projectFilter ?? undefined,
    });

    process.stderr.write("Dumping assistant corpus\n");
    const assistantRows = await runSessionQuery<TextRow>(queryScript, "text-export", {
      role: "assistant",
      model: modelFilter,
      after_date: since,
      before_date: until,
      project: projectFilter ?? undefined,
      min_chars: 50,
    });

    process.stderr.write("Dumping user corpus\n");
    const userRows = await runSessionQuery<TextRow>(queryScript, "text-export", {
      role: "user",
      after_date: since,
      before_date: until,
      project: projectFilter ?? undefined,
      min_chars: 50,
    });

    process.stderr.write(
      `Assistant rows: ${assistantRows.length}, user rows: ${userRows.length}\n`,
    );

    const assistantCorpus = processCorpus(serializeCorpus(assistantRows));
    const userCorpus = processCorpus(serializeCorpus(userRows));

    const candidatePhrases = surfaceCandidates(assistantCorpus, userCorpus, wordlistEntries);

    process.stderr.write("Fetching correction candidates\n");
    const corrections = await runSessionQuery<CorrectionRow>(queryScript, "correction-candidates", {
      after_date: since,
      before_date: until,
      project: projectFilter ?? undefined,
      limit: correctionsLimit,
    });

    const wordlistStems = new Set(wordlistEntries.map((e) => stemmer(e.phrase.toLowerCase())));
    const filteredVocab = vocabTerms.filter((t) => !wordlistStems.has(t.term));

    const ruleHealth = buildRuleHealth(wordlistEntries, auditByTerm, minLift);

    const report = renderReport({
      generatedAt: today,
      since,
      until,
      modelFilter,
      projectFilter,
      minLift,
      topN,
      modelSummary,
      assistantTotalChars: totalChars(assistantRows),
      userTotalChars: totalChars(userRows),
      ruleHealth,
      candidatePhrases,
      vocabTerms: filteredVocab,
      corrections,
    });

    mkdirSync(path.dirname(outPath), { recursive: true });
    await Bun.write(outPath, report);
    process.stderr.write(`Wrote report to ${outPath}\n`);
    process.stdout.write(`${outPath}\n`);
  } finally {
    process.stderr.write("Cleaning up FTS indexes\n");
    await execSessionQuery(queryScript, "fts-cleanup", {}, { queryDir: ftsQueryDir });
  }
}

async function auditWordlistsFts(entries: WordlistEntry[]): Promise<Map<string, FtsAuditRow>> {
  const terms = entries.map((e) => e.phrase.toLowerCase()).join(",");
  const rows = await runSessionQuery<FtsAuditRow>(
    queryScript,
    "fts-phrase-audit",
    {
      terms,
    },
    { queryDir: ftsQueryDir },
  );
  const result = new Map<string, FtsAuditRow>();
  for (const row of rows) {
    result.set(row.term, row);
  }
  return result;
}

function surfaceCandidates(assistant: CorpusStats, user: CorpusStats, existing: WordlistEntry[]) {
  const all = computeLift({
    assistant,
    user,
    minAssistantCount: { 2: 8, 3: 5, 4: 3 },
  });
  const exclusionSet = new Set(existing.map((e) => e.phrase));
  const filtered = excludePhrases(all, exclusionSet).filter((r) => r.lift >= minLift);
  return filtered.slice(0, topN);
}

async function resolveQueryScript(override: string | undefined): Promise<string> {
  if (override) return path.resolve(override);
  const sessionQueryRelPath = path.join("claude-code", "skills", "session", "scripts", "query.ts");
  const candidates = [
    process.env.CLAUDE_PLUGIN_ROOT
      ? path.join(process.env.CLAUDE_PLUGIN_ROOT, "..", sessionQueryRelPath)
      : null,
    path.resolve(path.join(import.meta.dirname, "..", "..", "..", ".."), sessionQueryRelPath),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(
    `Could not locate session query script. Tried:\n${candidates.join("\n")}\nPass --session-query <path> to override.`,
  );
}

function defaultWordlistsDir(): string {
  return path.join(import.meta.dirname, "..", "..", "..", "wordlists");
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
