#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { cli } from "cleye";
import { corpusPath, profilePath, resolveDataDir } from "./data-dir";
import { type Database, openSessionDb } from "./db";
import { auditDeliverableCorpus } from "./deliverable-audit";
import {
  type CorrectionRow,
  type CorrectiveRow,
  type DeliverableRow,
  type ModelSummaryRow,
  serializeCorpus,
  type TextRow,
  totalChars,
} from "./dump";
import { escapeRegex, frustrationRegex, gatedRegex } from "./frustration";
import { computeLift, excludePhrases, processCorpus, processRows } from "./ngram";
import { findQuote } from "./quote-context";
import { type CandidatePhrase, type ReportInput, renderReport } from "./report";
import { buildRuleHealth, type FtsAuditRow } from "./rule-health";
import { auditStructuralPatterns } from "./structural";
import { type TagSignatureRow, tagSequence } from "./tag-ngram";
import { loadProfile, phraseProfileStat } from "./voice-profile";
import type { WordlistEntry } from "./wordlists";
import { loadWordlists } from "./wordlists";

// Everything runAnalysis needs once flag parsing and date defaulting are done.
// generatedAt is supplied by the caller so the orchestration stays pure (no
// clock reads inside runAnalysis); the CLI passes today's date.
export interface AnalysisConfig {
  generatedAt: string;
  since: string;
  until: string;
  modelFilter: string;
  projectFilter: string | null;
  minLift: number;
  minCount: number;
  topN: number;
  tagMinLift: number;
  tagTop: number;
  wordlistsDir: string;
  dataDir: string;
  pasteMaxChars: number;
  selfName: string;
  correctiveLimit: number;
}

if (import.meta.main) {
  await main();
}

function parseFlags() {
  return cli({
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
        description: "Minimum lift threshold for surfacing new candidate phrases",
        default: 5.0,
      },
      minCount: {
        type: Number,
        description:
          "Minimum assistant occurrences for a rule to count as alive (below this is 'dead')",
        default: 5,
      },
      top: {
        type: Number,
        description: "Top N candidate phrases to surface",
        default: 30,
      },
      tagMinLift: {
        type: Number,
        description:
          "Minimum lift threshold for structural (part-of-speech tag sequence) signatures",
        default: 2.0,
      },
      tagTop: {
        type: Number,
        description: "Top N structural signatures to surface",
        default: 20,
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
      dataDir: {
        type: String,
        description:
          "Local data dir for the voice baseline (default: CLAUDE_PLUGIN_DATA or ~/.claude/plugins/data/writing-bendrucker)",
      },
      pasteMaxChars: {
        type: Number,
        description: "Length ceiling for human-authored user messages (paste filter)",
        default: 2000,
      },
      selfName: {
        type: String,
        description:
          "Your name, used to drop pasted prose that refers to you in the third person from the user baseline (case-insensitive; empty disables this signal)",
        default: "",
      },
      correctiveLimit: {
        type: Number,
        description: "Max corrective-feedback moments to surface",
        default: 25,
      },
    },
  });
}

async function main(): Promise<void> {
  const argv = parseFlags();
  const today = new Date().toISOString().slice(0, 10);
  const config: AnalysisConfig = {
    generatedAt: today,
    since: argv.flags.since ?? daysAgo(30),
    until: argv.flags.until ?? today,
    modelFilter: argv.flags.model,
    projectFilter: argv.flags.project ?? null,
    minLift: argv.flags.minLift,
    minCount: argv.flags.minCount,
    topN: argv.flags.top,
    tagMinLift: argv.flags.tagMinLift,
    tagTop: argv.flags.tagTop,
    wordlistsDir:
      argv.flags.wordlistsDir ?? path.join(import.meta.dirname, "..", "..", "..", "wordlists"),
    dataDir: resolveDataDir(argv.flags.dataDir),
    pasteMaxChars: argv.flags.pasteMaxChars,
    selfName: argv.flags.selfName,
    correctiveLimit: argv.flags.correctiveLimit,
  };
  const dbPath = path.resolve(argv.flags.sessionDb ?? "");
  const outPath = argv.flags.out ?? path.join("tmp", `trope-analysis-${today}.md`);

  const sessionId = process.env.CLAUDE_SESSION_ID ?? "anonymous";
  const isolatedPath = path.join(
    process.env.TMPDIR || "/tmp",
    `session-analyze-${sessionId}.duckdb`,
  );
  console.error(`Copying session DB to ${isolatedPath}`);
  await Bun.write(isolatedPath, Bun.file(dbPath));

  const db = await openSessionDb(isolatedPath);
  try {
    const report = renderReport(await runAnalysis(db, config));
    mkdirSync(path.dirname(outPath), { recursive: true });
    await Bun.write(outPath, report);
    console.error(`Wrote report to ${outPath}`);
    process.stdout.write(`${outPath}\n`);
  } finally {
    db.close();
    await rm(isolatedPath, { force: true });
  }
}

// Orchestrates the tested modules over an opened session DB into a ReportInput.
// All inputs come from db + config; no flag parsing, clock reads, or report
// rendering happen here, so a fixture DB can drive the whole composition.
export async function runAnalysis(db: Database, config: AnalysisConfig): Promise<ReportInput> {
  const baseParams: Record<string, string | null> = {
    after_date: config.since,
    before_date: config.until,
    project: config.projectFilter,
    paste_max_chars: String(config.pasteMaxChars),
    // Escape regex metacharacters: the paste filter interpolates this into an
    // RE2 pattern (\b...\b), so a literal name with metachars must match
    // literally.
    self_name: escapeRegex(config.selfName),
  };

  console.error("Loading current wordlists");
  const wordlistEntries = await loadWordlists(config.wordlistsDir);
  console.error(`Loaded ${wordlistEntries.length} wordlist entries from ${config.wordlistsDir}`);

  console.error(`Loading voice profile from ${profilePath(config.dataDir)}`);
  const voiceProfile = await loadProfile(profilePath(config.dataDir));
  if (voiceProfile) {
    console.error(
      `Voice baseline: ${voiceProfile.documentCount} documents, ${voiceProfile.totalTokens.toLocaleString()} tokens`,
    );
  } else {
    console.error(
      `No voice profile found. Run ingest-voice.ts (seed: ${corpusPath(config.dataDir)}) then voice-profile.ts. Deliverable-surface rules are kept pending a baseline (distinctiveness unverified) instead of falling back to the chat audit.`,
    );
  }

  console.error("Creating paste filter for the user baseline");
  await db.execQuery("paste-filter", baseParams);

  console.error("Building FTS indexes");
  await db.execQuery("fts-setup", { ...baseParams, model: config.modelFilter });

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
    model: config.modelFilter,
    min_chars: "50",
  });

  console.error("Dumping deliverable-prose corpus (Write/Edit/Bash tool inputs)");
  const deliverableRows = await db.runQuery<DeliverableRow>("deliverable-prose", {
    ...baseParams,
    model: config.modelFilter,
  });

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
  const ngramSizes = [3, 4];
  // Mine candidates from deliverable prose only (file writes and Bash
  // commit/PR/MR bodies), not conversational assistant text. The hook scans
  // deliverables and side-effect inputs, never the model's chat, so chat
  // narration ("now let me", "let me check") would otherwise dominate the
  // candidate list with phrases the hook can never act on.
  const { stats: assistantCorpus, sessionSpread: sessionCounts } = processRows(
    deliverableRows,
    ngramSizes,
  );
  const userText = serializeCorpus(userRows);
  const userCorpus = processCorpus(userText, ngramSizes);
  const candidateSessions = new Set(deliverableRows.map((r) => r.session_id)).size;
  const minSessions = Math.max(3, Math.round(candidateSessions * 0.05));
  console.error(
    `Session threshold: ${minSessions} (${candidateSessions} deliverable sessions in window)`,
  );

  const allLifts = computeLift({
    assistant: assistantCorpus,
    user: userCorpus,
    minAssistantCount: { 3: 5, 4: 3 },
  });
  const exclusionSet = new Set(wordlistEntries.map((e) => e.phrase));
  const candidatePhrases: CandidatePhrase[] = excludePhrases(allLifts, exclusionSet)
    .filter((r) => r.lift >= config.minLift)
    .filter((r) => (sessionCounts.get(r.phrase) ?? 0) >= minSessions)
    .slice(0, config.topN)
    .map((r) => {
      const baseline = voiceProfile
        ? phraseProfileStat(voiceProfile, r.phrase)
        : { count: 0, perMillion: 0 };
      return {
        ...r,
        sessions: sessionCounts.get(r.phrase) ?? 0,
        baselineCount: baseline.count,
        baselinePerM: baseline.perMillion,
        quote: findQuote(r.phrase, deliverableRows),
      };
    });

  console.error("Auditing deliverable corpus for wordlist rules");
  const deliverableAudit = auditDeliverableCorpus(wordlistEntries, deliverableRows);

  console.error("Computing structural signatures (part-of-speech tag sequences)");
  const tagSizes = [3, 4, 5];
  const tagExamples = new Map<string, string>();
  const tagAssistant = processRows(deliverableRows, tagSizes, {
    tokenize: (s) => tagSequence(s),
    examples: tagExamples,
  });
  const tagUser = processCorpus(userText, tagSizes, (s) => tagSequence(s));
  // Tag sequences draw from an alphabet of ~17 tags, so they are far
  // denser than word n-grams; the floors are higher to compensate.
  const tagLifts = computeLift({
    assistant: tagAssistant.stats,
    user: tagUser,
    minAssistantCount: { 3: 30, 4: 15, 5: 8 },
  });
  const structuralSignatures: TagSignatureRow[] = tagLifts
    .filter((r) => r.lift >= config.tagMinLift)
    .filter((r) => (tagAssistant.sessionSpread.get(r.phrase) ?? 0) >= minSessions)
    .slice(0, config.tagTop)
    .map((r) => ({
      ...r,
      sessions: tagAssistant.sessionSpread.get(r.phrase) ?? 0,
      example: tagExamples.get(r.phrase) ?? null,
    }));

  console.error("Fetching correction candidates");
  const corrections = await db.runQuery<CorrectionRow>("correction-candidates", baseParams);

  console.error("Fetching corrective feedback (frustration lexicon)");
  const primaryPattern = frustrationRegex();
  const primaryRe = new RegExp(primaryPattern, "i");
  const combinedLexicon = `(?:${primaryPattern})|(?:${gatedRegex()})`;
  const rawCorrective = await db.runQuery<CorrectiveRow>("corrective-feedback", {
    ...baseParams,
    lexicon: combinedLexicon,
    max_user_chars: "400",
    limit: String(config.correctiveLimit),
  });
  // Gated terms (e.g. "sounds like") only count when a primary frustration
  // term also appears in the same message.
  const corrective = rawCorrective.filter((row) => primaryRe.test(row.user_text));

  console.error("Auditing structural patterns against all model-generated text");
  const structuralAudit = auditStructuralPatterns(allModelText, userRows);

  const ruleHealth = buildRuleHealth({
    entries: wordlistEntries,
    chatAudit: auditByTerm,
    deliverableAudit,
    voiceProfile,
    minCount: config.minCount,
    findQuote: (entry: WordlistEntry, surface) =>
      surface === "deliverable" ? findQuote(entry.phrase, deliverableRows) : null,
  });

  return {
    generatedAt: config.generatedAt,
    since: config.since,
    until: config.until,
    modelFilter: config.modelFilter,
    projectFilter: config.projectFilter,
    minLift: config.minLift,
    minCount: config.minCount,
    topN: config.topN,
    modelSummary,
    assistantTotalChars: totalChars(assistantRows),
    deliverableTotalChars: totalChars(deliverableRows),
    userTotalChars: totalChars(userRows),
    voiceProfile,
    ruleHealth,
    structuralAudit,
    structuralSignatures,
    candidatePhrases,
    corrections,
    corrective,
  };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
