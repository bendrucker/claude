import { type ValeAlert, type ValeSource, valeAlerts } from "../detection/vale";
import type { HookFinding } from "./report";

/** Lines of `after` whose text does not appear in `before`, as 1-based numbers. */
export function changedLines(before: string, after: string): Set<number> {
  const remaining = new Map<string, number>();
  for (const line of before.split("\n")) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const changed = new Set<number>();
  for (const [index, line] of after.split("\n").entries()) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) remaining.set(line, left - 1);
    else changed.add(index + 1);
  }
  return changed;
}

function alertKey(alert: ValeAlert): string {
  return `${alert.Check}\0${alert.Match.toLowerCase()}`;
}

/** Findings for alerts on the lines an edit changed, minus any the replaced lines already carried. */
export async function valeFileFindings(
  before: string,
  after: string,
  filePath: string,
): Promise<HookFinding[]> {
  const added = changedLines(before, after);
  const removed = changedLines(after, before);
  const [afterAlerts, beforeAlerts] = await Promise.all([
    valeAlerts(after, { filePath }),
    before.trim() === "" ? Promise.resolve([]) : valeAlerts(before, { filePath }),
  ]);
  const carried = new Map<string, number>();
  for (const alert of beforeAlerts) {
    if (removed.has(alert.Line))
      carried.set(alertKey(alert), (carried.get(alertKey(alert)) ?? 0) + 1);
  }
  const alerts = afterAlerts.filter((alert) => {
    if (!added.has(alert.Line)) return false;
    const left = carried.get(alertKey(alert)) ?? 0;
    if (left === 0) return true;
    carried.set(alertKey(alert), left - 1);
    return false;
  });
  return alerts.map((alert) => ({
    check: alert.Check,
    at: `${alert.Line}:${alert.Span[0]}`,
    tier: "context",
    message: alert.Message,
    introduced: alert.Severity === "error",
  }));
}

/** Findings for message prose. An error-level alert blocks the call. */
export async function valeMessageFindings(
  text: string,
  kind: Extract<ValeSource, { kind: string }>["kind"],
): Promise<HookFinding[]> {
  return (await valeAlerts(text, { kind })).map((alert) => ({
    check: alert.Check,
    at: `${alert.Line}:${alert.Span[0]}`,
    tier: alert.Severity === "error" ? "deny" : "context",
    message: alert.Message,
  }));
}
