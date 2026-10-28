import { isProseFile } from "./paths";
import { type Tier, tierOfSeverity, valeAlerts } from "./vale";

export interface ScanResult {
  line: number;
  col: number;
  category: string;
  tier: Tier;
  matched: string;
  message: string;
}

export interface ScanOptions {
  /** Lint as a message sent once (PR, issue, comment, commit) rather than a file. */
  message?: boolean;
}

/** Every Vale alert in `text` at a hook-visible level, sorted by position. A code file yields an empty list. */
export async function scanAll(
  text: string,
  filePath?: string,
  { message = false }: ScanOptions = {},
): Promise<ScanResult[]> {
  if (filePath !== undefined && !isProseFile(filePath)) return [];
  const source = message || filePath === undefined ? { kind: "body" as const } : { filePath };
  const results: ScanResult[] = [];
  for (const alert of await valeAlerts(text, source)) {
    const tier = tierOfSeverity(alert.Severity);
    if (tier === undefined) continue;
    results.push({
      line: alert.Line,
      col: alert.Span[0],
      category: alert.Check,
      tier,
      matched: alert.Match,
      message: alert.Message,
    });
  }
  return results.toSorted((a, b) => (a.line === b.line ? a.col - b.col : a.line - b.line));
}
