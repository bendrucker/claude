import {
  type DetectorLayer,
  type RegexCatalogEntry,
  regexCatalog,
  stripCode,
} from "../../../detection/tropes";

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
  layer: DetectorLayer;
  assistantHits: number;
  userHits: number;
  assistantRows: number;
  userRows: number;
  assistantSessions: number;
  fileOnly: boolean;
  sideEffectOnly: boolean;
  retire: string;
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
      if (row.text == null || row.text === "") continue;
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
      if (row.text == null || row.text === "") continue;
      const stripped = stripCode(row.text);
      const hits = countHits(stripped, sp.pattern);
      if (hits > 0) {
        userHits += hits;
        userRowCount++;
      }
    }

    return {
      category: sp.category,
      layer: sp.layer,
      assistantHits,
      userHits,
      assistantRows: assistantRowCount,
      userRows: userRowCount,
      assistantSessions: sessions.size,
      fileOnly: sp.fileOnly ?? false,
      sideEffectOnly: sp.sideEffectOnly ?? false,
      retire: sp.retire,
    };
  });
}

// DetectorModule is the seam for batch detector modules (analyze-script tier).
// A module receives corpus rows and returns typed findings for the report.
// structural.ts (regexCatalog + auditStructuralPatterns) is the template.
//
// To add a new detector module (e.g. an LLM judge for the meaning layer):
//   1. Create a module that implements this interface.
//   2. Call it from runAnalysis alongside auditStructuralPatterns.
//   3. Extend ReportInput with the findings type.
//   4. Render findings in report.ts under the appropriate section.
//
// and cross-sentence detectors may follow as they graduate from the hook.
export interface DetectorModule<TFinding> {
  layer: DetectorLayer;
  detect(rows: Array<{ session_id: string; text?: string }>): Promise<TFinding[]>;
}
