import type { ValeAlert } from "../detection/vale";
import {
  type Decision,
  formatContext,
  formatDecision,
  type HookEvent,
  type SyncHookJSONOutput,
} from "./io";

export const MAX_REPORTED = 10;

export type Severity = ValeAlert["Severity"];

export interface HookAlert {
  check: string;
  decision: Decision;
  severity: Severity;
  message: string;
  /** Where Vale reported it, as `line:column`. */
  at: string;
}

export function hookAlertOf(alert: ValeAlert, decision: Decision): HookAlert {
  return {
    check: alert.Check,
    decision,
    severity: alert.Severity,
    message: alert.Message,
    at: `${alert.Line}:${alert.Span[0]}`,
  };
}

/** Only an error in prose not yet sent denies. A file is already written, so its errors are context. */
export function decisionOf(severity: Severity, event: HookEvent): Decision {
  return severity === "error" && event === "PreToolUse" ? "deny" : "context";
}

const SEVERITIES: Severity[] = ["error", "warning", "suggestion"];

/** The expectation each severity states, so the level tells the model how sure the check is. */
export const SEVERITY_LEADS: Record<Severity, string> = {
  error: "Errors are high-confidence. Fix each one:",
  warning: "Warnings are likely problems. Fix each one unless it is wrong for this text:",
  suggestion:
    "Suggestions are low-confidence. Apply one only where it makes the text better, and leave the rest as written:",
};

function line(alert: HookAlert): string {
  return `- ${alert.at} ${alert.check}: ${alert.message}`;
}

function render(alerts: HookAlert[], omitted: number, filePath: string | undefined): string {
  const total = alerts.length + omitted;
  const where = filePath === undefined ? "this text" : `\`${filePath}\``;
  const count = total === 1 ? "1 alert" : `${total} alerts`;
  const lines = [`Vale found ${count} in ${where}.`];
  for (const severity of SEVERITIES) {
    const group = alerts.filter((alert) => alert.severity === severity);
    if (group.length === 0) continue;
    lines.push("", SEVERITY_LEADS[severity], ...group.map(line));
  }
  if (omitted > 0) lines.push("", `…and ${omitted} more. Lint the text with Vale to see all.`);
  return lines.join("\n");
}

function rank(alert: HookAlert): number {
  return (alert.decision === "deny" ? 0 : 3) + SEVERITIES.indexOf(alert.severity);
}

/** Every alert in one hook output, denying when any alert denies. */
export function report(
  alerts: HookAlert[],
  { event, filePath }: { event: HookEvent; filePath?: string | undefined },
): { output: SyncHookJSONOutput; decision: Decision; shown: HookAlert[] } | null {
  if (alerts.length === 0) return null;
  const ordered = alerts.toSorted((a, b) => rank(a) - rank(b));
  const shown = ordered.slice(0, MAX_REPORTED);
  const text = render(shown, ordered.length - shown.length, filePath);
  const decision = ordered[0]?.decision ?? "context";
  const output = decision === "deny" ? formatDecision(text) : formatContext(event, text);
  return { output, decision, shown };
}
