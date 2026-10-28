import type { ValeAlert } from "../detection/vale";
import {
  type Decision,
  formatContext,
  formatDecision,
  type HookEvent,
  type SyncHookJSONOutput,
} from "./io";

export const MAX_REPORTED = 10;

export interface HookFinding {
  check: string;
  decision: Decision;
  message: string;
  /** Where Vale reported it, as `line:column`. */
  at: string;
}

export function findingOf(alert: ValeAlert, decision: Decision): HookFinding {
  return {
    check: alert.Check,
    decision,
    message: alert.Message,
    at: `${alert.Line}:${alert.Span[0]}`,
  };
}

function render(findings: HookFinding[], omitted: number, filePath: string | undefined): string {
  const total = findings.length + omitted;
  const where = filePath === undefined ? "this text" : `\`${filePath}\``;
  const count = total === 1 ? "1 alert" : `${total} alerts`;
  const fix = total === 1 ? "Fix it." : "Fix them in one pass.";
  const lines = [`Vale found ${count} in ${where}. ${fix}`, ""];
  for (const finding of findings)
    lines.push(`- ${finding.at} ${finding.check}: ${finding.message}`);
  if (omitted > 0) lines.push(`- …and ${omitted} more. Lint the text with Vale to see all.`);
  return lines.join("\n");
}

/** Every finding in one hook output, denying when any finding denies. */
export function report(
  findings: HookFinding[],
  { event, filePath }: { event: HookEvent; filePath?: string | undefined },
): { output: SyncHookJSONOutput; decision: Decision; shown: HookFinding[] } | null {
  if (findings.length === 0) return null;
  const ordered = findings.toSorted(
    (a, b) => Number(b.decision === "deny") - Number(a.decision === "deny"),
  );
  const shown = ordered.slice(0, MAX_REPORTED);
  const text = render(shown, ordered.length - shown.length, filePath);
  const decision = ordered[0]?.decision ?? "context";
  const output = decision === "deny" ? formatDecision(text) : formatContext(event, text);
  return { output, decision, shown };
}
