import type { CorrectionRow, CorrectiveRow, ModelSummaryRow } from "./dump";
import type { MeaningAudit } from "./judge";
import type { LiftRow } from "./ngram";
import type { QuoteContext } from "./quote-context";
import type { CorpusRateTrends } from "./rate-detectors";
import type { CurrentRuleHealth, RemoveReason } from "./rule-health";
import type { StructuralAuditRow } from "./structural";
import type { TagSignatureRow } from "./tag-ngram";
import { type FeatureRate, VOICE_DELTA_FEATURES } from "./voice-delta";
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
  // Per-feature mean rates across the deliverable corpus for the analysis
  // window. Compared against voiceProfile.voiceDelta baseline rates.
  voiceDeltaRates: Map<string, FeatureRate>;
  ruleHealth: CurrentRuleHealth[];
  structuralAudit: StructuralAuditRow[];
  structuralSignatures: TagSignatureRow[];
  /** Corpus-level rate trends (action-verb opener density, backtick ref density, template rates). */
  rateTrends: CorpusRateTrends;
  meaningAudit: MeaningAudit | null;
  candidatePhrases: CandidatePhrase[];
  corrections: CorrectionRow[];
  corrective: CorrectiveRow[];
}

export interface CandidatePhrase extends LiftRow {
  baselineCount: number;
  baselinePerM: number;
  quote: QuoteContext | null;
}

export function renderReport(input: ReportInput): string {
  const sections = [
    renderHeader(input),
    renderSummary(input),
    renderVoiceDelta(input),
    renderProposedRemovals(input),
    renderProposedAdditions(input),
    renderRuleHealthTable(input),
    renderStructuralAudit(input),
    renderStructuralSignatures(input),
    renderStructuralTrends(input),
    renderMeaningAudit(input),
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

function renderVoiceDelta(input: ReportInput): string {
  const baseline = input.voiceProfile?.voiceDelta ?? null;
  const hasBaseline = baseline !== null;

  const lines = [
    "## Voice Delta",
    "",
    hasBaseline
      ? `Baseline: ${fmtNum(baseline.documentCount)} documents (computed ${baseline.computedAt}). Each rate is the mean across the deliverable corpus in this window vs the pre-AI baseline. Provenance labels: **skill-prescribed** = tune the skill if the aggregate drifts; **skill-encouraged** = under-application of the skill; **ungoverned** = genuine voice signal.`
      : "No voice-delta baseline loaded. Run `ingest-voice.ts` then `voice-profile.ts` to build a baseline. Rates shown are corpus means only.",
    "",
  ];

  if (hasBaseline) {
    lines.push("| feature | provenance | corpus rate | baseline rate | delta |");
    lines.push("| --- | --- | --- | --- | --- |");
  } else {
    lines.push("| feature | provenance | corpus rate |");
    lines.push("| --- | --- | --- |");
  }

  for (const feature of VOICE_DELTA_FEATURES) {
    const corpusEntry = input.voiceDeltaRates.get(feature.id);
    const corpusRate = corpusEntry?.rate ?? 0;
    const fmt = feature.format ?? ((r: number) => r.toFixed(2));
    const corpusStr = fmt(corpusRate);

    if (hasBaseline) {
      const baselineRate = baseline.rates[feature.id];
      if (baselineRate === undefined) {
        lines.push(
          `| ${feature.label} | ${feature.provenance} | ${corpusStr} | (no baseline stat) | - |`,
        );
      } else {
        const baselineStr = fmt(baselineRate);
        const delta = corpusRate - baselineRate;
        const deltaStr = feature.isFraction
          ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`
          : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
        lines.push(
          `| ${feature.label} | ${feature.provenance} | ${corpusStr} | ${baselineStr} | ${deltaStr} |`,
        );
      }
    } else {
      lines.push(`| ${feature.label} | ${feature.provenance} | ${corpusStr} |`);
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
    lines.push(
      `+ ${r.phrase}  # lift=${fmtLiftAgainstRate(r.lift, r.userPerM)}, n=${r.n}, baseline=${r.baselineCount}`,
    );
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

function renderStructuralTrends(input: ReportInput): string {
  const t = input.rateTrends;
  const lines = [
    "## Structural Trends",
    "",
    "Corpus-level rate metrics across deliverable documents. These are aggregate signals, not per-document flags.",
    "",
  ];
  if (t.documentCount === 0) {
    lines.push("_No deliverable documents analyzed._");
    return lines.join("\n");
  }
  lines.push(`Documents analyzed: ${fmtNum(t.documentCount)}`);
  lines.push("");
  lines.push("| metric | value | note |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| action-verb opener rate | ${fmtPct(t.meanActionVerbOpenerRate)} | mean fraction of non-first lines opening with a bare verb; 16.6% AI-era vs 2.4% baseline (2026-06) |`,
  );
  lines.push(
    `| backtick ref density | ${t.meanBacktickRefDensity.toFixed(1)}/1k words | mean inline code spans per 1k words; ~60/1k marks over-reliance on identifiers as structure (2026-06) |`,
  );
  lines.push(
    `| template document rate | ${fmtPct(t.templateDocumentRate)} | fraction of documents with at least one ## section heading |`,
  );
  lines.push(
    `| template on small document | ${t.templateOnSmallDocumentCount} docs | full ## Changes + ## Testing on body under 150 words; pull-request:create scopes sections to larger changes |`,
  );
  lines.push("");
  lines.push("Section count distribution (## Changes / ## Testing / ## Issue / ## References):");
  lines.push("");
  lines.push("| sections present | documents |");
  lines.push("| --- | --- |");
  for (let i = 0; i <= 4; i++) {
    const count = t.sectionCountDistribution[i] ?? 0;
    lines.push(`| ${i} | ${count} |`);
  }
  return lines.join("\n");
}

function renderMeaningAudit(input: ReportInput): string {
  const lines = [
    "## Meaning-Layer Audit (LLM Judge)",
    "",
    "Per-criterion flag rates from the batch LLM judge over the deliverable corpus, in rubric order (information-density leads; press-release-structure is deprioritized). The prompt is a versioned artifact: a different hash means these numbers are not comparable to prior runs. Sampled spans quote session text, so this section stays in the local report and is never committed.",
    "",
  ];
  const audit = input.meaningAudit;
  if (!audit) {
    lines.push("_Judge not run. Pass `--judge` (requires `ANTHROPIC_API_KEY`) to enable._");
    return lines.join("\n");
  }
  lines.push(
    `Prompt: \`${audit.promptSha256}\` | Model: \`${audit.model}\` | Documents: ${fmtNum(audit.documents)} | Est. cost: $${audit.estimatedCostUsd.toFixed(4)}`,
    "",
    "| criterion | question | flagged | rate |",
    "| --- | --- | --- | --- |",
  );
  for (const stat of audit.criteria) {
    const rate = stat.total > 0 ? `${((stat.flagged / stat.total) * 100).toFixed(0)}%` : "-";
    lines.push(`| ${stat.id} | ${esc(stat.question)} | ${stat.flagged}/${stat.total} | ${rate} |`);
  }
  const withSpans = audit.criteria.filter((c) => c.spans.length > 0);
  if (withSpans.length > 0) {
    lines.push("", "Sampled spans (local-only; spot-check before acting):", "");
    for (const stat of withSpans) {
      for (const span of stat.spans) {
        // Spans are verbatim quotes and may contain newlines, which would
        // break the list item; collapse all whitespace runs to single spaces.
        const flat = span.replace(/\s+/g, " ").trim();
        lines.push(`- ${stat.id}: "${esc(truncate(flat, 160))}"`);
      }
    }
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

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
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
