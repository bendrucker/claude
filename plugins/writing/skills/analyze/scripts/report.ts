import type { CorrectionRow, ModelSummaryRow } from "./dump";
import type { LiftRow } from "./ngram";
import type { StructuralAuditRow } from "./structural";
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

export interface CurrentRuleHealth {
  entry: WordlistEntry;
  assistantCount: number;
  userCount: number;
  assistantPerM: number | null;
  userPerM: number | null;
  lift: number | null;
  status: "keep" | "remove";
  removeReason: RemoveReason | null;
  noData: boolean;
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
  ruleHealth: CurrentRuleHealth[];
  structuralAudit: StructuralAuditRow[];
  candidatePhrases: LiftRow[];
  corrections: CorrectionRow[];
}

export function renderReport(input: ReportInput): string {
  const sections = [
    renderHeader(input),
    renderSummary(input),
    renderProposedRemovals(input),
    renderProposedAdditions(input),
    renderRuleHealthTable(input),
    renderStructuralAudit(input),
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
    `- Current wordlist entries audited: ${input.ruleHealth.length}`,
    `- Rules kept (distinctive and alive): ${keep}`,
    `- Proposed removals: ${removable.length} (dead: ${dead}, not distinctive: ${notDistinctive})`,
    `- Proposed additions (new candidates above threshold): ${input.candidatePhrases.length}`,
    `- Correction candidates surfaced: ${input.corrections.length}`,
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
    `- **dead**: the model produced it fewer than ${input.minCount} times in the window, so the rule rarely fires.`,
    "- **not distinctive**: the user uses it at least as often as the model (per token), so the rule would flag the user's own voice rather than slop.",
    "",
    "A rule the model uses far more than the user is **kept** even when its lift reads low, because the smoothed user baseline (see methodology) compresses lift for any word the user never types.",
    "",
  ];
  const removable = input.ruleHealth
    .filter((r) => r.status === "remove")
    .sort(
      (a, b) =>
        reasonRank(a.removeReason) - reasonRank(b.removeReason) ||
        (a.assistantPerM ?? 0) - (b.assistantPerM ?? 0),
    );
  if (removable.length === 0) {
    lines.push("_No removals proposed._");
    return lines.join("\n");
  }
  lines.push("| phrase | source | reason | assistant/M | user/M | lift |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of removable) {
    lines.push(
      `| \`${esc(r.entry.phrase)}\` | ${r.entry.source} | ${r.removeReason} | ${fmtPerM(r.assistantPerM)} | ${fmtPerM(r.userPerM)} | ${fmtLift(r.lift)} |`,
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
    `Phrases distinctive to the assistant (lift >= ${input.minLift.toFixed(1)}x) not yet in the wordlists.`,
    "",
  ];
  if (input.candidatePhrases.length === 0) {
    lines.push("_No additions proposed._");
    return lines.join("\n");
  }
  lines.push("| phrase | n | assistant count | user count | sessions | lift |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of input.candidatePhrases) {
    lines.push(
      `| \`${esc(r.phrase)}\` | ${r.n} | ${r.assistantCount} | ${r.userCount} | ${r.sessions ?? "-"} | ${r.lift.toFixed(1)} |`,
    );
  }
  lines.push("", "```diff");
  for (const r of input.candidatePhrases) {
    lines.push(`+ ${r.phrase}  # lift=${r.lift.toFixed(1)}, n=${r.n}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderRuleHealthTable(input: ReportInput): string {
  const lines = [
    "## Current Rule Health",
    "",
    "Full audit of every wordlist entry. `remove` rules are either dead or not distinctive (see Proposed Removals).",
    "",
  ];
  if (input.ruleHealth.length === 0) {
    lines.push("_No wordlists found at `plugins/writing/wordlists/`._");
    return lines.join("\n");
  }
  lines.push("| phrase | source | type | assistant/M | user/M | lift | status |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of input.ruleHealth) {
    const status = r.status === "keep" ? "keep" : `remove (${r.removeReason})`;
    const ruleType = ruleTypeLabel(r.entry.source);
    lines.push(
      `| \`${esc(r.entry.phrase)}\` | ${r.entry.source} | ${ruleType} | ${fmtPerM(r.assistantPerM)} | ${fmtPerM(r.userPerM)} | ${fmtLift(r.lift)} | ${status} |`,
    );
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

export function buildRuleHealth(
  entries: WordlistEntry[],
  auditByTerm: Map<string, FtsAuditRow>,
  minCount: number,
): CurrentRuleHealth[] {
  return entries.map((entry) => {
    const row = auditByTerm.get(entry.phrase.toLowerCase());
    const assistantCount = row?.assistant_count ?? 0;
    const userCount = row?.user_count ?? 0;
    const assistantPerM = row?.assistant_per_m ?? null;
    const userPerM = row?.user_per_m ?? null;
    const lift = row?.lift ?? null;
    const noData = !row || (assistantCount === 0 && userCount === 0);

    const alive = assistantCount >= minCount;
    const distinctive = (assistantPerM ?? 0) > (userPerM ?? 0);

    let status: "keep" | "remove" = "keep";
    let removeReason: RemoveReason | null = null;
    if (!alive) {
      status = "remove";
      removeReason = "dead";
    } else if (!distinctive) {
      status = "remove";
      removeReason = "not distinctive";
    }

    return {
      entry,
      assistantCount,
      userCount,
      assistantPerM,
      userPerM,
      lift,
      status,
      removeReason,
      noData,
    };
  });
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
