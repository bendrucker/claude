import type { CorrectionRow, ModelSummaryRow, PhraseLiftRow } from "./dump";
import type { LiftRow } from "./ngram";
import type { WordlistEntry } from "./wordlists";

export interface CurrentRuleHealth {
  entry: WordlistEntry;
  assistantCount: number;
  userCount: number;
  assistantPerM: number | null;
  userPerM: number | null;
  lift: number | null;
  stillDistinctive: boolean;
  noData: boolean;
}

export interface ReportInput {
  generatedAt: string;
  since: string;
  until: string;
  modelFilter: string;
  projectFilter: string | null;
  minLift: number;
  topN: number;
  modelSummary: ModelSummaryRow[];
  assistantTotalChars: number;
  userTotalChars: number;
  ruleHealth: CurrentRuleHealth[];
  candidatePhrases: LiftRow[];
  corrections: CorrectionRow[];
}

export function renderReport(input: ReportInput): string {
  const sections: string[] = [];
  sections.push(renderHeader(input));
  sections.push(renderSummary(input));
  sections.push(renderProposedRemovals(input));
  sections.push(renderProposedAdditions(input));
  sections.push(renderRuleHealthTable(input));
  sections.push(renderCorrections(input));
  return `${sections.join("\n\n")}\n`;
}

function renderHeader(input: ReportInput): string {
  return [
    `# Writing trope analysis (${input.generatedAt})`,
    "",
    `Window: ${input.since} to ${input.until}`,
    `Model filter: \`${input.modelFilter}\``,
    input.projectFilter ? `Project filter: \`${input.projectFilter}\`` : "Project filter: (none)",
    `Min lift threshold: ${input.minLift.toFixed(1)}x`,
    `Top N candidates: ${input.topN}`,
  ].join("\n");
}

function renderSummary(input: ReportInput): string {
  const removals = input.ruleHealth.filter((r) => !r.noData && !r.stillDistinctive).length;
  const additions = input.candidatePhrases.length;
  const lines = [
    "## Summary",
    "",
    `- Assistant corpus: ${formatNumber(input.assistantTotalChars)} chars`,
    `- User corpus: ${formatNumber(input.userTotalChars)} chars`,
    `- Current wordlist entries audited: ${input.ruleHealth.length}`,
    `- Proposed removals (collapsed lift): ${removals}`,
    `- Proposed additions (new candidates above threshold): ${additions}`,
    `- Correction candidates surfaced: ${input.corrections.length}`,
  ];
  if (input.modelSummary.length > 0) {
    lines.push("");
    lines.push("### Models seen in window");
    lines.push("");
    lines.push("| model | text items | messages | sessions | total chars |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of input.modelSummary) {
      lines.push(
        `| ${row.model} | ${formatNumber(row.text_items)} | ${formatNumber(row.messages)} | ${formatNumber(row.sessions)} | ${formatNumber(row.total_chars)} |`,
      );
    }
  }
  return lines.join("\n");
}

function renderProposedRemovals(input: ReportInput): string {
  const lines = ["## Proposed wordlist removals"];
  lines.push("");
  lines.push(
    "Rules whose assistant-vs-user lift dropped below the threshold. Review and remove from the wordlist file shown.",
  );
  lines.push("");
  const removable = input.ruleHealth
    .filter((r) => !r.noData && !r.stillDistinctive)
    .sort((a, b) => (a.lift ?? 0) - (b.lift ?? 0));
  if (removable.length === 0) {
    lines.push("_No removals proposed._");
    return lines.join("\n");
  }
  lines.push("| phrase | source | assistant/M | user/M | lift |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of removable) {
    lines.push(
      `| \`${escapePipe(r.entry.phrase)}\` | ${r.entry.source} | ${formatPerM(r.assistantPerM)} | ${formatPerM(r.userPerM)} | ${formatLift(r.lift)} |`,
    );
  }
  lines.push("");
  lines.push("Diff (paste into the relevant wordlist file):");
  lines.push("");
  lines.push("```diff");
  for (const r of removable) {
    lines.push(`- ${r.entry.phrase}  # was lift=${formatLift(r.lift)}, source=${r.entry.source}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderProposedAdditions(input: ReportInput): string {
  const lines = ["## Proposed wordlist additions"];
  lines.push("");
  lines.push(
    `Phrases distinctive to the assistant (lift >= ${input.minLift.toFixed(1)}x) and not yet covered by the current wordlists.`,
  );
  lines.push("");
  if (input.candidatePhrases.length === 0) {
    lines.push("_No additions proposed._");
    return lines.join("\n");
  }
  lines.push("| phrase | n | assistant count | user count | lift |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of input.candidatePhrases) {
    lines.push(
      `| \`${escapePipe(r.phrase)}\` | ${r.n} | ${r.assistantCount} | ${r.userCount} | ${r.lift.toFixed(1)} |`,
    );
  }
  lines.push("");
  lines.push("Diff (paste into the relevant wordlist file):");
  lines.push("");
  lines.push("```diff");
  for (const r of input.candidatePhrases) {
    lines.push(`+ ${r.phrase}  # lift=${r.lift.toFixed(1)}, n=${r.n}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderRuleHealthTable(input: ReportInput): string {
  const lines = ["## Current rule health"];
  lines.push("");
  lines.push(
    "Full audit of every existing wordlist entry. Use this when a phrase has marginal but non-zero lift.",
  );
  lines.push("");
  if (input.ruleHealth.length === 0) {
    lines.push("_No wordlists found at `plugins/writing/wordlists/`._");
    return lines.join("\n");
  }
  lines.push("| phrase | source | assistant/M | user/M | lift | status |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of input.ruleHealth) {
    const status = r.noData ? "no data" : r.stillDistinctive ? "keep" : "remove";
    lines.push(
      `| \`${escapePipe(r.entry.phrase)}\` | ${r.entry.source} | ${formatPerM(r.assistantPerM)} | ${formatPerM(r.userPerM)} | ${formatLift(r.lift)} | ${status} |`,
    );
  }
  return lines.join("\n");
}

function renderCorrections(input: ReportInput): string {
  const lines = ["## Correction candidates"];
  lines.push("");
  lines.push(
    "Adjacent (long assistant, short user) pairs. Scan for prose corrections the assistant might have missed.",
  );
  lines.push("");
  if (input.corrections.length === 0) {
    lines.push("_No correction candidates in window._");
    return lines.join("\n");
  }
  for (const c of input.corrections) {
    lines.push(`### ${c.assistant_timestamp} (${c.project ?? "unknown"})`);
    lines.push("");
    lines.push(`Assistant (${c.assistant_chars} chars):`);
    lines.push("");
    lines.push("```");
    lines.push(c.assistant_snippet);
    lines.push("```");
    lines.push("");
    lines.push(`User reply (${c.user_chars} chars):`);
    lines.push("");
    lines.push("```");
    lines.push(c.user_snippet);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function buildRuleHealth(
  entries: WordlistEntry[],
  liftByPhrase: Map<string, PhraseLiftRow[]>,
  minLift: number,
): CurrentRuleHealth[] {
  return entries.map((entry) => {
    const rows = liftByPhrase.get(entry.phrase.toLowerCase()) ?? [];
    if (rows.length === 0) {
      return {
        entry,
        assistantCount: 0,
        userCount: 0,
        assistantPerM: null,
        userPerM: null,
        lift: null,
        stillDistinctive: false,
        noData: true,
      };
    }
    const assistantRows = rows.filter((r) => r.role === "assistant");
    const userRows = rows.filter((r) => r.role === "user");
    const assistantCount = assistantRows.reduce((s, r) => s + Number(r.phrase_count), 0);
    const userCount = userRows.reduce((s, r) => s + Number(r.phrase_count), 0);
    const assistantChars = assistantRows.reduce((s, r) => s + Number(r.total_chars), 0);
    const userChars = userRows.reduce((s, r) => s + Number(r.total_chars), 0);
    const assistantPerM = assistantChars > 0 ? (assistantCount / assistantChars) * 1_000_000 : null;
    const userPerM = userChars > 0 ? (userCount / userChars) * 1_000_000 : null;
    const lift =
      assistantPerM !== null && userPerM !== null ? assistantPerM / Math.max(userPerM, 1) : null;
    const stillDistinctive = lift !== null && lift >= minLift;
    return {
      entry,
      assistantCount,
      userCount,
      assistantPerM,
      userPerM,
      lift,
      stillDistinctive,
      noData: false,
    };
  });
}

function formatNumber(value: number | bigint | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString();
}

function formatPerM(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(1);
}

function formatLift(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}x`;
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}
