#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { cli } from "cleye";
import { openSessionDb } from "./db";
import {
  type CorrectionRow,
  type DeliverableRow,
  type ModelSummaryRow,
  serializeCorpus,
  type TextRow,
  totalChars,
} from "./dump";
import { computeLift, excludePhrases, processCorpus, processRows } from "./ngram";
import { buildRuleHealth, type FtsAuditRow, renderReport } from "./report";
import { auditStructuralPatterns } from "./structural";
import { loadWordlists } from "./wordlists";

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
    sessionDb: {
      type: String,
      description: "Path to session DuckDB database file",
      required: true as const,
    },
    wordlistsDir: {
      type: String,
      description: "Wordlists directory (defaults to plugins/writing/wordlists)",
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
const dbPath = path.resolve(argv.flags.sessionDb ?? "");
const wordlistsDir =
  argv.flags.wordlistsDir ?? path.join(import.meta.dirname, "..", "..", "..", "wordlists");
const outPath = argv.flags.out ?? path.join("tmp", `trope-analysis-${today}.md`);
const baseParams: Record<string, string | null> = {
  after_date: since,
  before_date: until,
  project: projectFilter,
};

await main();

async function main(): Promise<void> {
  const sessionId = process.env.CLAUDE_SESSION_ID ?? "anonymous";
  const isolatedPath = path.join(
    process.env.TMPDIR || "/tmp",
    `session-analyze-${sessionId}.duckdb`,
  );
  console.error(`Copying session DB to ${isolatedPath}`);
  await Bun.write(isolatedPath, Bun.file(dbPath));

  const db = await openSessionDb(isolatedPath);

  console.error("Loading current wordlists");
  const wordlistEntries = await loadWordlists(wordlistsDir);
  console.error(`Loaded ${wordlistEntries.length} wordlist entries from ${wordlistsDir}`);

  try {
    console.error("Building FTS indexes");
    await db.execQuery("fts-setup", { ...baseParams, model: modelFilter });

    console.error("Auditing wordlists via FTS");
    const auditTerms = wordlistEntries.map((e) => e.phrase.toLowerCase()).join(",");
    const auditRows = await db.runQuery<FtsAuditRow>("fts-phrase-audit", { terms: auditTerms });
    const auditByTerm = new Map(auditRows.map((r) => [r.term, r]));

    console.error("Fetching model summary");
    const modelSummary = await db.runQuery<ModelSummaryRow>("model-summary", baseParams);

    console.error("Dumping all assistant text");
    const assistantRows = await db.runQuery<TextRow>("text-export", {
      ...baseParams,
      role: "assistant",
      model: modelFilter,
      min_chars: "50",
    });

    console.error("Dumping deliverable-prose corpus (Write/Edit/Bash tool inputs)");
    const deliverableRows = await db.runQuery<DeliverableRow>("deliverable-prose", baseParams);

    console.error("Dumping user corpus (human input only)");
    const userRows = await db.runQuery<TextRow>("text-export", {
      ...baseParams,
      role: "user",
      model: null,
      min_chars: "50",
      human_only: "true",
    });

    console.error(
      `All assistant: ${assistantRows.length} (${totalChars(assistantRows).toLocaleString()} chars), deliverable: ${deliverableRows.length} (${totalChars(deliverableRows).toLocaleString()} chars), user: ${userRows.length} (${totalChars(userRows).toLocaleString()} chars)`,
    );

    const allModelText = [...assistantRows, ...deliverableRows];
    const totalSessions = new Set(allModelText.map((r) => r.session_id)).size;
    const ngramSizes = [3, 4];
    const { stats: assistantCorpus, sessionSpread: sessionCounts } = processRows(
      allModelText,
      ngramSizes,
    );
    const userCorpus = processCorpus(serializeCorpus(userRows), ngramSizes);
    const minSessions = Math.max(3, Math.round(totalSessions * 0.05));
    console.error(`Session threshold: ${minSessions} (${totalSessions} sessions in window)`);

    const allLifts = computeLift({
      assistant: assistantCorpus,
      user: userCorpus,
      minAssistantCount: { 3: 5, 4: 3 },
    });
    const exclusionSet = new Set(wordlistEntries.map((e) => e.phrase));
    const candidatePhrases = excludePhrases(allLifts, exclusionSet)
      .filter((r) => r.lift >= minLift)
      .filter((r) => (sessionCounts.get(r.phrase) ?? 0) >= minSessions)
      .map((r) => ({ ...r, sessions: sessionCounts.get(r.phrase) ?? 0 }))
      .slice(0, topN);

    console.error("Fetching correction candidates");
    const corrections = await db.runQuery<CorrectionRow>("correction-candidates", baseParams);

    console.error("Auditing structural patterns against all model-generated text");
    const structuralAudit = auditStructuralPatterns(allModelText, userRows);

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
      deliverableTotalChars: totalChars(deliverableRows),
      userTotalChars: totalChars(userRows),
      ruleHealth,
      structuralAudit,
      candidatePhrases,
      corrections,
    });

    mkdirSync(path.dirname(outPath), { recursive: true });
    await Bun.write(outPath, report);
    console.error(`Wrote report to ${outPath}`);
    process.stdout.write(`${outPath}\n`);
  } finally {
    db.close();
    await rm(isolatedPath, { force: true });
  }
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
