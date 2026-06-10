import type { CorrectionRow, CorrectiveRow, ModelSummaryRow } from "./dump";
import type { LiftRow } from "./ngram";
import type { QuoteContext } from "./quote-context";
import type { CurrentRuleHealth, RemoveReason } from "./rule-health";
import type { StructuralAuditRow } from "./structural";
import type { TagSignatureRow } from "./tag-ngram";
import type { VoiceProfile } from "./voice-profile";

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
  structuralSignatures: TagSignatureRow[];
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
    renderStructuralSignatures(input),
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
    "Each rule is judged on its firing surface. Chat-surface rules (openers, sycophantic patterns) compare the model's chat against the user's chat. Deliverable-surface rules (flowery phrases, soft phrasing) compare the model's deliverable prose against the user's voice baseline, so a tell frequent in PR bodies and absent from the baseline reads as keep, not dead.",
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
      `| \`${esc(r.entry.phrase)}\` | ${r.entry.source} | ${r.surface} | ${r.removeReason} | ${fmtPerM(r.modelPerM)} | ${fmtPerM(r.baselinePerM)} | ${fmtLiftAgainstRate(r.lift, r.baselinePerM)} |`,
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
      `| \`${esc(r.phrase)}\` | ${r.n} | ${r.assistantCount} | ${r.userCount} | ${r.sessions ?? "-"} | ${r.baselineCount} | ${fmtPerM(r.baselinePerM)} | ${fmtLiftAgainstRate(r.lift, r.userPerM)} |`,
    );
  }
  lines.push("", "Context for each candidate (spot-check before adding):", "");
  for (const r of input.candidatePhrases) {
    lines.push(`- \`${esc(r.phrase)}\` ${formatQuote(r.quote)}`);
  }
  lines.push("", "```diff");
  for (const r of input.candidatePhrases) {
    lines.push(`+ ${r.phrase}  # lift=${fmtLiftAgainstRate(r.lift, r.userPerM)}, n=${r.n}, baseline=${r.baselineCount}`);
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
      `| \`${esc(r.entry.phrase)}\` | ${r.entry.source} | ${ruleType} | ${r.surface} | ${fmtPerM(r.modelPerM)} | ${fmtPerM(r.baselinePerM)} | ${fmtLiftAgainstRate(r.lift, r.baselinePerM)} | ${status} |`,
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
    "Patterns are grouped by detector layer. Cross-sentence patterns shipping in the hook",
    "without a promotion record appear here as misplacement signals.",
    "",
  ];
  if (input.structuralAudit.length === 0) {
    lines.push("_No structural patterns defined._");
    return lines.join("\n");
  }
  const layerOrder = ["vocabulary", "grammar", "cross-sentence", "meaning"] as const;
  const byLayer = new Map<string, typeof input.structuralAudit>();
  for (const r of input.structuralAudit) {
    const group = byLayer.get(r.layer) ?? [];
    group.push(r);
    byLayer.set(r.layer, group);
  }
  for (const layer of layerOrder) {
    const rows = byLayer.get(layer);
    if (!rows || rows.length === 0) continue;
    lines.push(`### ${layer}`);
    lines.push("");
    lines.push("| pattern | scope | assistant hits | user hits | rows | sessions | retire when |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    const sorted = [...rows].sort((a, b) => b.assistantHits - a.assistantHits);
    for (const r of sorted) {
      const scope = r.sideEffectOnly ? "side-effect" : r.fileOnly ? "file-only" : "all";
      lines.push(
        `| ${r.category} | ${scope} | ${r.assistantHits} | ${r.userHits} | ${r.assistantRows} | ${r.assistantSessions} | ${esc(r.retire)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderStructuralSignatures(input: ReportInput): string {
  const lines = [
    "## Structural Signatures",
    "",
    "Coarse part-of-speech tag sequences distinctive to the model's deliverable prose vs the user's voice. Word-independent: when vocabulary drifts between model releases, these shapes persist. Examples are verbatim corpus sentences. This report is local-only, so replace them with invented examples before quoting anywhere else.",
    "",
  ];
  if (input.structuralSignatures.length === 0) {
    lines.push("_No structural signatures above threshold._");
    return lines.join("\n");
  }
  lines.push("| shape | n | assistant/M | user/M | sessions | lift | example |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of input.structuralSignatures) {
    lines.push(
      `| \`${r.phrase}\` | ${r.n} | ${fmtPerM(r.assistantPerM)} | ${fmtPerM(r.userPerM)} | ${r.sessions ?? "-"} | ${fmtLiftAgainstRate(r.lift, r.userPerM)} | ${r.example ? esc(truncate(r.example, 100)) : "-"} |`,
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
  const proseCount = input.corrections.filter((c) => c.prose_signal).length;
  lines.push(
    `Signal-to-noise: ${proseCount}/${input.corrections.length} candidates carry a prose signal. If this ratio stays low across runs, the surface is mostly task pivots and should be retired.`,
    "",
  );
  for (const c of input.corrections) {
    const signal = c.prose_signal ? "prose" : "non-prose";
    lines.push(`### ${c.assistant_timestamp} (${c.project ?? "unknown"}) [${signal}]`);
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

// A lift computed against a zero user rate reflects the Laplace smoothing
// floor: the phrase is absent from the comparison text. Label the absence
// instead of printing a misleading multiplier.
function fmtLiftAgainstRate(lift: number | null, userRate: number | null): string {
  if (lift !== null && userRate === 0) return "absent from user text";
  return fmtLift(lift);
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
