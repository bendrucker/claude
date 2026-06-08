import { type RegexCatalogEntry, regexCatalog, stripCode } from "../../../detection/tropes";

export type StructuralPattern = RegexCatalogEntry;

// The audit reuses the engine's regex catalog so it cannot drift from what the
// hook enforces. The catalog already excludes wordlist-backed and function
// tests (covered by the FTS pass) and normalizes each pattern to the global
// flag for counting.
export const STRUCTURAL_PATTERNS: StructuralPattern[] = regexCatalog();

function countHits(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  if (pattern.global) {
    return text.match(pattern)?.length ?? 0;
  }
  return pattern.test(text) ? 1 : 0;
}

export interface StructuralAuditRow {
  category: string;
  assistantHits: number;
  userHits: number;
  assistantRows: number;
  userRows: number;
  assistantSessions: number;
  fileOnly: boolean;
  sideEffectOnly: boolean;
}

export function auditStructuralPatterns(
  assistantRows: Array<{ session_id: string; text?: string }>,
  userRows: Array<{ text?: string }>,
): StructuralAuditRow[] {
  return STRUCTURAL_PATTERNS.map((sp) => {
    let assistantHits = 0;
    let assistantRowCount = 0;
    const sessions = new Set<string>();

    for (const row of assistantRows) {
      if (!row.text) continue;
      const stripped = stripCode(row.text);
      const hits = countHits(stripped, sp.pattern);
      if (hits > 0) {
        assistantHits += hits;
        assistantRowCount++;
        sessions.add(row.session_id);
      }
    }

    let userHits = 0;
    let userRowCount = 0;
    for (const row of userRows) {
      if (!row.text) continue;
      const stripped = stripCode(row.text);
      const hits = countHits(stripped, sp.pattern);
      if (hits > 0) {
        userHits += hits;
        userRowCount++;
      }
    }

    return {
      category: sp.category,
      assistantHits,
      userHits,
      assistantRows: assistantRowCount,
      userRows: userRowCount,
      assistantSessions: sessions.size,
      fileOnly: sp.fileOnly ?? false,
      sideEffectOnly: sp.sideEffectOnly ?? false,
    };
  });
}
