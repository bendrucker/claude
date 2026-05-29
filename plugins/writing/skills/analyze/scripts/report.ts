import { type DeliverableAudit, isDeliverableSurface } from "./deliverable-audit";
import type { CorrectionRow, CorrectiveRow, ModelSummaryRow } from "./dump";
import type { LiftRow } from "./ngram";
import type { QuoteContext } from "./quote-context";
import type { StructuralAuditRow } from "./structural";
import type { VoiceProfile } from "./voice-profile";
import { phraseProfileStat } from "./voice-profile";
import type { WordlistEntry } from "./wordlists";

export interface FtsAuditRow {
  term: string;
  assistant_count: number;
  user_count: number;
  assistant_per_m: number | null;
  user_per_m: number | null;
  lift: number | null;
}

export type RemoveReason = "dead" | "not distinctive";
export type AuditSurface = "chat" | "deliverable";

export interface CurrentRuleHealth {
  entry: WordlistEntry;
  surface: AuditSurface;
  // Model rate on the audited surface (chat assistant text, or deliverable
  // prose) and the comparison baseline (chat user text, or voice baseline).
  modelCount: number;
  modelPerM: number | null;
  baselinePerM: number | null;
  lift: number | null;
  status: "keep" | "remove";
  removeReason: RemoveReason | null;
  noData: boolean;
  quote: QuoteContext | null;
}

export interface ReportInput {
  generatedAt: string;
  since: string;
  until: string;
  modelFilter: string;
  projectFilter: string | null;
  minLift: number;
  minCount: number;
  topN: number;
  modelSummary: ModelSummaryRow[];
  assistantTotalChars: number;
  deliverableTotalChars: number;
  userTotalChars: number;
  voiceProfile: VoiceProfile | null;
  ruleHealth: CurrentRuleHealth[];
  structuralAudit: StructuralAuditRow[];
  candidatePhrases: CandidatePhrase[];
  corrections: CorrectionRow[];
  corrective: CorrectiveRow[];
}

// A candidate phrase plus its baseline rate and a spot-checkable quote.
export interface CandidatePhrase extends LiftRow {
  baselineCount: number;
  baselinePerM: number;
  quote: QuoteContext | null;
}

export function renderReport(input: ReportInput): string {
  const sections = [
    renderHeader(input),
    renderSummary(input),
    renderProposedRemovals(input),
    renderProposedAdditions(input),
    renderRuleHealthTable(input),
    renderStructuralAudit(input),
    renderCorrectiveFeedback(input),
    renderCorrections(input),
  ];
  return `${sections.join("\n\n")}\n`;
}

function renderHeader(input: ReportInput): string {
  const project = input.projectFilter ? `\`${input.projectFilter}\`` : "(none)";
  return [
    `# Writing trope analysis (${input.generatedAt})`,
    "",
    `Window: ${input.since} to ${input.until}`,
    `Model filter: \`${input.modelFilter}\``,
    `Project filter: ${project}`,
    `Min lift threshold (additions): ${fmtLift(input.minLift)}`,
    `Min occurrences to count as alive: ${input.minCount}`,
    `Top N candidates: ${input.topN}`,
  ].join("\n");
}

function renderSummary(input: ReportInput): string {
  const removable = input.ruleHealth.filter((r) => r.status === "remove");
  const dead = removable.filter((r) => r.removeReason === "dead").length;
  const notDistinctive = removable.filter((r) => r.removeReason === "not distinctive").length;
  const keep = input.ruleHealth.length - removable.length;
  const lines = [
    "## Summary",
    "",
    `- All assistant text: ${fmtNum(input.assistantTotalChars)} chars`,
    `- Deliverable prose (Write/Edit/Bash): ${fmtNum(input.deliverableTotalChars)} chars`,
    `- User text (human only): ${fmtNum(input.userTotalChars)} chars`,
    `- Voice baseline: ${voiceBaselineSummary(input.voiceProfile)}`,
    `- Current wordlist entries audited: ${input.ruleHealth.length}`,
    `- Rules kept (distinctive and alive): ${keep}`,
    `- Proposed removals: ${removable.length} (dead: ${dead}, not distinctive: ${notDistinctive})`,
    `- Proposed additions (new candidates above threshold): ${input.candidatePhrases.length}`,
    `- Correction candidates surfaced: ${input.corrections.length}`,
    `- Corrective-feedback moments surfaced: ${input.corrective.length}`,
  ];
  if (input.modelSummary.length > 0) {
    lines.push("", "### Models Seen in Window", "");
    lines.push("| model | text items | messages | sessions | total chars |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of input.modelSummary) {
      lines.push(
        `| ${row.model} | ${fmtNum(row.text_items)} | ${fmtNum(row.messages)} | ${fmtNum(row.sessions)} | ${fmtNum(row.total_chars)} |`,
      );
    }
  }
  return lines.join("\n");
}

function renderProposedRemovals(input: ReportInput): string {
  const lines = [
    "## Proposed Wordlist Removals",
    "",
    "Two reasons a rule earns removal:",
    "",
    `- **dead**: the model produced it fewer than ${input.minCount} times in the window on the surface where the rule fires, so the rule rarely fires.`,
    "- **not distinctive**: the comparison baseline uses it at least as often as the model (per token), so the rule would flag the user's own voice rather than slop.",
    "",
    "Each rule is judged on its firing surface. Chat-surface rules (openers, sycophantic patterns) compare the model's chat against the user's chat. Deliverable-surface rules (flowery phrases, soft phrasing, marketing verbs) compare the model's deliverable prose against the user's voice baseline, so a tell frequent in PR bodies and absent from the baseline reads as keep, not dead.",
    "",
  ];
  const removable = input.ruleHealth
    .filter((r) => r.status === "remove")
    .sort(
      (a, b) =>
        reasonRank(a.removeReason) - reasonRank(b.removeReason) ||
        (a.modelPerM ?? 0) - (b.modelPerM ?? 0),
    );
  if (removable.length === 0) {
    lines.push("_No removals proposed._");
    return lines.join("\n");
  }
  lines.push("| phrase | source | surface | reason | model/M | baseline/M | lift |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of removable) {
    lines.push(
      `| \`${esc(r.entry.phrase)}\` | ${r.entry.source} | ${r.surface} | ${r.removeReason} | ${fmtPerM(r.modelPerM)} | ${fmtPerM(r.baselinePerM)} | ${fmtLift(r.lift)} |`,
    );
  }
  lines.push("", "```diff");
  for (const r of removable) {
    lines.push(`- ${r.entry.phrase}  # ${r.removeReason}, source=${r.entry.source}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderProposedAdditions(input: ReportInput): string {
  const lines = [
    "## Proposed Wordlist Additions",
    "",
    `Phrases distinctive to the assistant (lift >= ${input.minLift.toFixed(1)}x) not yet in the wordlists. The baseline columns report the phrase's rate in the user's voice baseline; a count of 0 is the strongest "absent from my baseline" signal.`,
    "",
  ];
  if (input.candidatePhrases.length === 0) {
    lines.push("_No additions proposed._");
    return lines.join("\n");
  }
  lines.push(
    "| phrase | n | assistant count | user count | sessions | baseline count | baseline/M | lift |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of input.candidatePhrases) {
    lines.push(
      `| \`${esc(r.phrase)}\` | ${r.n} | ${r.assistantCount} | ${r.userCount} | ${r.sessions ?? "-"} | ${r.baselineCount} | ${fmtPerM(r.baselinePerM)} | ${r.lift.toFixed(1)} |`,
    );
  }
  lines.push("", "Context for each candidate (spot-check before adding):", "");
  for (const r of input.candidatePhrases) {
    lines.push(`- \`${esc(r.phrase)}\` ${formatQuote(r.quote)}`);
  }
  lines.push("", "```diff");
  for (const r of input.candidatePhrases) {
    lines.push(`+ ${r.phrase}  # lift=${r.lift.toFixed(1)}, n=${r.n}, baseline=${r.baselineCount}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderRuleHealthTable(input: ReportInput): string {
  const lines = [
    "## Current Rule Health",
    "",
    "Full audit of every wordlist entry on its firing surface. `remove` rules are either dead or not distinctive (see Proposed Removals). The surface column shows which corpora the model/baseline rates come from.",
    "",
  ];
  if (input.ruleHealth.length === 0) {
    lines.push("_No wordlists found at `plugins/writing/wordlists/`._");
    return lines.join("\n");
  }
  if (!input.voiceProfile && input.ruleHealth.some((r) => r.surface === "deliverable")) {
    lines.push(
      "Voice profile not loaded: deliverable-surface rules are kept pending a baseline (run `ingest-voice.ts` then `voice-profile.ts` to verify distinctiveness). Their baseline/M reads `-`.",
      "",
    );
  }
  lines.push("| phrase | source | type | surface | model/M | baseline/M | lift | status |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of input.ruleHealth) {
    const status =
      r.status === "keep"
        ? r.noData && r.surface === "deliverable"
          ? "keep (no baseline)"
          : "keep"
        : `remove (${r.removeReason})`;
    const ruleType = ruleTypeLabel(r.entry.source);
    lines.push(
      `| \`${esc(r.entry.phrase)}\` | ${r.entry.source} | ${ruleType} | ${r.surface} | ${fmtPerM(r.modelPerM)} | ${fmtPerM(r.baselinePerM)} | ${fmtLift(r.lift)} | ${status} |`,
    );
  }
  const withQuotes = input.ruleHealth.filter((r) => r.quote);
  if (withQuotes.length > 0) {
    lines.push("", "Deliverable context for audited tells (spot-check verdicts):", "");
    for (const r of withQuotes) {
      lines.push(`- \`${esc(r.entry.phrase)}\` ${formatQuote(r.quote)}`);
    }
  }
  return lines.join("\n");
}

function renderStructuralAudit(input: ReportInput): string {
  const lines = [
    "## Structural Pattern Audit",
    "",
    "Regex-based patterns from the writing hook, run against all model-generated text.",
    "",
  ];
  if (input.structuralAudit.length === 0) {
    lines.push("_No structural patterns defined._");
    return lines.join("\n");
  }
  lines.push("| pattern | scope | assistant hits | user hits | rows | sessions |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  const sorted = [...input.structuralAudit].sort((a, b) => b.assistantHits - a.assistantHits);
  for (const r of sorted) {
    const scope = r.sideEffectOnly ? "side-effect" : r.fileOnly ? "file-only" : "all";
    lines.push(
      `| ${r.category} | ${scope} | ${r.assistantHits} | ${r.userHits} | ${r.assistantRows} | ${r.assistantSessions} |`,
    );
  }
  return lines.join("\n");
}

function renderCorrections(input: ReportInput): string {
  const lines = [
    "## Correction Candidates",
    "",
    "Adjacent (long assistant, short user) pairs. Scan for prose corrections.",
    "",
  ];
  if (input.corrections.length === 0) {
    lines.push("_No correction candidates in window._");
    return lines.join("\n");
  }
  for (const c of input.corrections) {
    lines.push(`### ${c.assistant_timestamp} (${c.project ?? "unknown"})`);
    lines.push("");
    lines.push(`Assistant (${c.assistant_chars} chars):`);
    lines.push("", "```", c.assistant_snippet, "```", "");
    lines.push(`User reply (${c.user_chars} chars):`);
    lines.push("", "```", c.user_snippet, "```", "");
  }
  return lines.join("\n").trimEnd();
}

function renderCorrectiveFeedback(input: ReportInput): string {
  const lines = [
    "## Corrective Feedback",
    "",
    "Short, human-authored user messages that name a writing problem (frustration lexicon match), paired with the preceding model output. These are labeled-slop moments: the user explicitly called out prose the model produced.",
    "",
  ];
  if (input.corrective.length === 0) {
    lines.push("_No corrective-feedback moments in window._");
    return lines.join("\n");
  }
  for (const c of input.corrective) {
    lines.push(`### ${c.timestamp} (${c.project ?? "unknown"}): matched \`${c.matched_term}\``);
    lines.push("");
    if (c.context_snippet) {
      lines.push(`Preceding model output (${fmtNum(c.context_chars)} chars):`);
      lines.push("", "```", c.context_snippet, "```", "");
    }
    lines.push(`User feedback (${c.user_chars} chars):`);
    lines.push("", "```", c.user_text, "```", "");
  }
  return lines.join("\n").trimEnd();
}

export interface RuleHealthInput {
  entries: WordlistEntry[];
  chatAudit: Map<string, FtsAuditRow>;
  deliverableAudit: DeliverableAudit | null;
  voiceProfile: VoiceProfile | null;
  minCount: number;
  findQuote?: (entry: WordlistEntry, surface: AuditSurface) => QuoteContext | null;
}

// Audit each rule against the surface where it actually fires. Chat-surface
// rules (openers, sycophantic patterns, conversational vocabulary) keep the
// FTS chat comparison: the model's chat usage of a term tracks its habit.
// Deliverable-surface rules (flowery phrases, soft phrasing) are judged on the
// model's deliverable-prose rate. The chat audit cannot measure them: it stems
// each entry and joins against single-word FTS tokens, so a multi-word phrase
// never matches and would read as a false "dead". They are always routed to
// the deliverable audit. With the voice baseline loaded they also get a
// distinctiveness check against the user's hand-written voice. Without it the
// baseline is unknown, so an alive rule is kept rather than proposed for
// removal (we never recommend dropping a rule we cannot measure).
export function buildRuleHealth(input: RuleHealthInput): CurrentRuleHealth[] {
  const { entries, chatAudit, deliverableAudit, voiceProfile, minCount, findQuote } = input;

  return entries.map((entry) => {
    const onDeliverable = deliverableAudit !== null && isDeliverableSurface(entry.source);
    const surface: AuditSurface = onDeliverable ? "deliverable" : "chat";
    const quote = findQuote ? findQuote(entry, surface) : null;

    if (onDeliverable && deliverableAudit) {
      return buildDeliverableHealth(entry, deliverableAudit, voiceProfile, minCount, quote);
    }
    return buildChatHealth(entry, chatAudit, minCount, quote);
  });
}

function buildChatHealth(
  entry: WordlistEntry,
  chatAudit: Map<string, FtsAuditRow>,
  minCount: number,
  quote: QuoteContext | null,
): CurrentRuleHealth {
  const row = chatAudit.get(entry.phrase.toLowerCase());
  const modelCount = row?.assistant_count ?? 0;
  const baselinePerM = row?.user_per_m ?? null;
  const modelPerM = row?.assistant_per_m ?? null;
  const lift = row?.lift ?? null;
  const noData = !row || (modelCount === 0 && (row?.user_count ?? 0) === 0);

  const { status, removeReason } = verdict(modelCount, modelPerM, baselinePerM, minCount);
  return {
    entry,
    surface: "chat",
    modelCount,
    modelPerM,
    baselinePerM,
    lift,
    status,
    removeReason,
    noData,
    quote,
  };
}

function buildDeliverableHealth(
  entry: WordlistEntry,
  deliverableAudit: DeliverableAudit,
  voiceProfile: VoiceProfile | null,
  minCount: number,
  quote: QuoteContext | null,
): CurrentRuleHealth {
  const audit = deliverableAudit.byPhrase.get(entry.phrase);
  const modelCount = audit?.count ?? 0;
  const modelPerM = audit?.perMillion ?? 0;

  if (!voiceProfile) {
    // No baseline loaded. Judge only whether the rule fires on its deliverable
    // surface; distinctiveness is unmeasurable, so an alive rule is kept.
    const alive = modelCount >= minCount;
    return {
      entry,
      surface: "deliverable",
      modelCount,
      modelPerM,
      baselinePerM: null,
      lift: null,
      status: alive ? "keep" : "remove",
      removeReason: alive ? null : "dead",
      noData: true,
      quote,
    };
  }

  const baseline = phraseProfileStat(voiceProfile, entry.phrase);
  const baselinePerM = baseline.perMillion;
  const lift = baselinePerM > 0 ? modelPerM / baselinePerM : null;
  const noData = modelCount === 0 && baseline.count === 0;

  const { status, removeReason } = verdict(modelCount, modelPerM, baselinePerM, minCount);
  return {
    entry,
    surface: "deliverable",
    modelCount,
    modelPerM,
    baselinePerM,
    lift,
    status,
    removeReason,
    noData,
    quote,
  };
}

function verdict(
  modelCount: number,
  modelPerM: number | null,
  baselinePerM: number | null,
  minCount: number,
): { status: "keep" | "remove"; removeReason: RemoveReason | null } {
  const alive = modelCount >= minCount;
  const distinctive = (modelPerM ?? 0) > (baselinePerM ?? 0);
  if (!alive) return { status: "remove", removeReason: "dead" };
  if (!distinctive) return { status: "remove", removeReason: "not distinctive" };
  return { status: "keep", removeReason: null };
}

function reasonRank(reason: RemoveReason | null): number {
  if (reason === "dead") return 0;
  if (reason === "not distinctive") return 1;
  return 2;
}

function fmtNum(value: number | null): string {
  if (value === null) return "-";
  return Number(value).toLocaleString();
}

function fmtPerM(value: number | null): string {
  if (value === null) return "-";
  return value.toFixed(1);
}

function fmtLift(value: number | null): string {
  if (value === null) return "-";
  return `${value.toFixed(1)}x`;
}

function ruleTypeLabel(source: string): string {
  if (source === "openers.txt") return "opener";
  if (source === "marketing-verbs.txt" || source === "soft-phrasing.txt") return "weighted";
  if (source === "flowery-phrases.txt") return "phrase";
  return "vocabulary";
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function voiceBaselineSummary(profile: VoiceProfile | null): string {
  if (!profile) return "not loaded (run ingest-voice.ts + voice-profile.ts)";
  return `${fmtNum(profile.documentCount)} documents, ${fmtNum(profile.totalTokens)} tokens (sources: ${profile.sources.join("+") || "none"})`;
}

function formatQuote(quote: QuoteContext | null): string {
  if (!quote) return "(no deliverable occurrence found)";
  const pointer = quote.filePath
    ? `${quote.filePath}`
    : quote.sourceFile
      ? `${quote.sourceFile}:${quote.sourceLine ?? "?"}`
      : "(no source pointer)";
  return `"${quote.window}" (${pointer})`;
}
