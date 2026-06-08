#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { cli } from "cleye";
import { corpusPath, profilePath, resolveDataDir } from "./data-dir";
import { openSessionDb } from "./db";
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
import { escapeRegex, frustrationRegex } from "./frustration";
import { computeLift, excludePhrases, processCorpus, processRows } from "./ngram";
import { processTagCorpus, processTagRows, type TagSignatureRow } from "./tag-ngram";
import { findQuote } from "./quote-context";
import { buildRuleHealth, type CandidatePhrase, type FtsAuditRow, renderReport } from "./report";
import { auditStructuralPatterns } from "./structural";
import { loadProfile, phraseProfileStat } from "./voice-profile";
import type { WordlistEntry } from "./wordlists";
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

const today = new Date().toISOString().slice(0, 10);
const since = argv.flags.since ?? daysAgo(30);
const until = argv.flags.until ?? today;
const modelFilter = argv.flags.model;
const projectFilter = argv.flags.project ?? null;
const minLift = argv.flags.minLift;
const minCount = argv.flags.minCount;
const topN = argv.flags.top;
const dbPath = path.resolve(argv.flags.sessionDb ?? "");
const wordlistsDir =
  argv.flags.wordlistsDir ?? path.join(import.meta.dirname, "..", "..", "..", "wordlists");
const outPath = argv.flags.out ?? path.join("tmp", `trope-analysis-${today}.md`);
const dataDir = resolveDataDir(argv.flags.dataDir);
const pasteMaxChars = String(argv.flags.pasteMaxChars);
const correctiveLimit = String(argv.flags.correctiveLimit);
const baseParams: Record<string, string | null> = {
  after_date: since,
  before_date: until,
  project: projectFilter,
  paste_max_chars: pasteMaxChars,
  // Escape regex metacharacters: the paste filter interpolates this into an RE2
  // pattern (\b...\b), so a literal name with metachars must match literally.
  self_name: escapeRegex(argv.flags.selfName ?? ""),
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

  console.error(`Loading voice profile from ${profilePath(dataDir)}`);
  const voiceProfile = await loadProfile(profilePath(dataDir));
  if (voiceProfile) {
    console.error(
      `Voice baseline: ${voiceProfile.documentCount} documents, ${voiceProfile.totalTokens.toLocaleString()} tokens`,
    );
  } else {
    console.error(
      `No voice profile found. Run ingest-voice.ts (seed: ${corpusPath(dataDir)}) then voice-profile.ts. Deliverable-surface rules are kept pending a baseline (distinctiveness unverified) instead of falling back to the chat audit.`,
    );
  }

  try {
    console.error("Creating paste filter for the user baseline");
    await db.execQuery("paste-filter", baseParams);

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
    const userCorpus = processCorpus(serializeCorpus(userRows), ngramSizes);
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
      .filter((r) => r.lift >= minLift)
      .filter((r) => (sessionCounts.get(r.phrase) ?? 0) >= minSessions)
      .slice(0, topN)
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
    const tagAssistant = processTagRows(deliverableRows);
    const tagUser = processTagCorpus(serializeCorpus(userRows));
    // Tag sequences draw from an alphabet of ~17 tags, so they are far
    // denser than word n-grams; the floors are higher to compensate.
    const tagLifts = computeLift({
      assistant: tagAssistant.stats,
      user: tagUser,
      minAssistantCount: { 3: 30, 4: 15, 5: 8 },
    });
    const structuralSignatures: TagSignatureRow[] = tagLifts
      .filter((r) => r.lift >= argv.flags.tagMinLift)
      .filter((r) => (tagAssistant.sessionSpread.get(r.phrase) ?? 0) >= minSessions)
      .slice(0, argv.flags.tagTop)
      .map((r) => ({
        ...r,
        sessions: tagAssistant.sessionSpread.get(r.phrase) ?? 0,
        example: tagAssistant.examples.get(r.phrase) ?? null,
      }));

    console.error("Fetching correction candidates");
    const corrections = await db.runQuery<CorrectionRow>("correction-candidates", baseParams);

    console.error("Fetching corrective feedback (frustration lexicon)");
    const corrective = await db.runQuery<CorrectiveRow>("corrective-feedback", {
      ...baseParams,
      lexicon: frustrationRegex(),
      max_user_chars: "400",
      limit: correctiveLimit,
    });

    console.error("Auditing structural patterns against all model-generated text");
    const structuralAudit = auditStructuralPatterns(allModelText, userRows);

    const ruleHealth = buildRuleHealth({
      entries: wordlistEntries,
      chatAudit: auditByTerm,
      deliverableAudit,
      voiceProfile,
      minCount,
      findQuote: (entry: WordlistEntry, surface) =>
        surface === "deliverable" ? findQuote(entry.phrase, deliverableRows) : null,
    });

    const report = renderReport({
      generatedAt: today,
      since,
      until,
      modelFilter,
      projectFilter,
      minLift,
      minCount,
      topN,
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
