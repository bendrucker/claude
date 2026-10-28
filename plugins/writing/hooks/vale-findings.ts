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

function firstPerCheck(alerts: ValeAlert[]): ValeAlert[] {
  const seen = new Map<string, ValeAlert>();
  for (const alert of alerts) if (!seen.has(alert.Check)) seen.set(alert.Check, alert);
  return [...seen.values()];
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
    if (alert.Severity === "suggestion" || !added.has(alert.Line)) return false;
    const left = carried.get(alertKey(alert)) ?? 0;
    if (left === 0) return true;
    carried.set(alertKey(alert), left - 1);
    return false;
  });
  return firstPerCheck(alerts).map((alert) => ({
    category: alert.Check,
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
  const alerts = (await valeAlerts(text, { kind })).filter(
    (alert) => alert.Severity !== "suggestion",
  );
  return firstPerCheck(alerts).map((alert) => ({
    category: alert.Check,
    tier: alert.Severity === "error" ? "deny" : "context",
    message: alert.Message,
  }));
}
