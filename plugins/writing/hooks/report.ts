import { formatContext, formatDecision, type PermissionTier, type SyncHookJSONOutput } from "./io";

export const MAX_REPORTED = 10;

const TIER_RANK: Record<PermissionTier, number> = { deny: 0, ask: 1, context: 2 };

export interface HookFinding {
  check: string;
  tier: PermissionTier;
  message: string;
  // A deny-tier trope in a Write or Edit already happened, so it is reported as
  // context with an instruction to fix only the introduced text.
  introduced?: boolean;
}

export interface ReportTarget {
  toolName: string;
  filePath?: string | undefined;
}

function introducedInstruction({ toolName, filePath }: ReportTarget, listed: boolean): string {
  const target = filePath != null && filePath !== "" ? `\`${filePath}\`` : "the file";
  const subject = listed ? "the findings marked (introduced)" : "this";
  if (toolName === "Write") {
    const what = listed ? "those tropes" : "the trope you just introduced";
    return `You wrote ${target} introducing ${subject}. Issue a follow-up Edit that fixes only ${what}. Do not modify unrelated parts of the file.`;
  }
  return `You introduced ${subject} in your edit to ${target}. Issue a follow-up Edit that targets only the text you just changed. Do not modify unrelated parts of the file, including other pre-existing tropes.`;
}

function renderOne(finding: HookFinding, target: ReportTarget): string {
  return finding.introduced === true
    ? `${finding.message} ${introducedInstruction(target, false)}`
    : finding.message;
}

function renderMany(findings: HookFinding[], omitted: number, target: ReportTarget): string {
  const lines = [
    `Writing checks found ${findings.length + omitted} issues in this text. Fix them in one pass.`,
  ];
  if (findings.some((finding) => finding.introduced === true)) {
    lines.push(introducedInstruction(target, true));
  }
  lines.push("");
  for (const finding of findings) {
    const mark = finding.introduced === true ? " (introduced)" : "";
    lines.push(`- ${finding.check}${mark}: ${finding.message}`);
  }
  if (omitted > 0) {
    lines.push(`- …and ${omitted} more. Run writing:scan --input to see all.`);
  }
  return lines.join("\n");
}

/** Every finding in one hook output, at the strictest tier any of them carries. */
export function report(
  findings: HookFinding[],
  target: ReportTarget,
): { output: SyncHookJSONOutput; tier: PermissionTier; shown: HookFinding[] } | null {
  if (findings.length === 0) return null;
  const ordered = findings.toSorted((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  const shown = ordered.slice(0, MAX_REPORTED);
  const omitted = ordered.length - shown.length;
  const [first] = shown;
  const text =
    shown.length === 1 && first ? renderOne(first, target) : renderMany(shown, omitted, target);
  const tier = ordered[0]?.tier ?? "context";
  const output = tier === "context" ? formatContext(text) : formatDecision(tier, text);
  return { output, tier, shown };
}
