import { PATTERNS, stripCode } from "../../../hooks/tropes";
import { WORDLISTS } from "../../../hooks/wordlists";

export interface StructuralPattern {
  category: string;
  pattern: RegExp;
  fileOnly?: boolean;
  sideEffectOnly?: boolean;
}

function globalize(pattern: RegExp): RegExp {
  return pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

// Derived from the hook's regex patterns so the audit cannot drift from what
// the hook enforces. Wordlist-backed and function tests are excluded: stemmed
// vocabulary and weighted verbs are covered by the FTS pass, openers compile to
// WORDLISTS.openers (also FTS-covered), and function tests cannot be counted by
// a single regex match.
export const STRUCTURAL_PATTERNS: StructuralPattern[] = PATTERNS.filter(
  (def): def is typeof def & { test: RegExp } =>
    def.test instanceof RegExp && def.test !== WORDLISTS.openers,
).map((def) => ({
  category: def.category,
  pattern: globalize(def.test),
  fileOnly: def.fileOnly ?? false,
  sideEffectOnly: def.sideEffectOnly ?? false,
}));

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
