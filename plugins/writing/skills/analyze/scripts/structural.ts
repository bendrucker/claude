const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;

export interface StructuralPattern {
  category: string;
  pattern: RegExp;
  fileOnly?: boolean;
  sideEffectOnly?: boolean;
}

export const STRUCTURAL_PATTERNS: StructuralPattern[] = [
  { category: "spaced em dash", pattern: / — /g },
  { category: "copula avoidance", pattern: /\b(?:serves|stands) as\b/gi },
  { category: "reaching for", pattern: /\breach(?:ing|es|ed)?\s+for\b/gi },
  {
    category: "promotional language",
    pattern: /\b(boasts|vibrant|showcasing|nestled|groundbreaking|renowned|diverse array)\b/gi,
  },
  { category: "parallelism", pattern: /\bnot (?:just|only) .{1,50}, but (?:also )?/gi },
  {
    category: "cross-sentence not-X",
    pattern:
      /\b(it|this|that|he|she|they|we|you)\s+(?:is|are|was|were)(?:n't|\s+not)\s+[^.!?]{1,80}[.!?]\s+\1\s+(?:is|are|was|were)\b/gi,
  },
  { category: "semicolon overuse", pattern: /;[^;]*;[^;]*;/g, fileOnly: true },
  {
    category: "passive PR summary",
    pattern:
      /\b(?:is|was|are|were)\s+(?:added|updated|removed|refactored|introduced|created|deleted|modified|improved)\b/gi,
    fileOnly: true,
  },
  { category: "tests cover preamble", pattern: /^Tests\s+(?:cover|verify|ensure|validate)\b/gm },
  { category: "path bullet", pattern: /^\s*-\s*\*\*[^*\n]+\*\*\s*:\s*/gm, fileOnly: true },
  {
    category: "trailing hedge",
    pattern: /\b(?:regardless|nonetheless|anyway)\.\s*(?:$|\n)/gim,
    fileOnly: true,
  },
  { category: "label bold", pattern: /^\s*\*\*[A-Z][A-Za-z ]+(?::\*\*|\*\*:)\s/gm, fileOnly: true },
  { category: "dig into", pattern: /\b(?:dig|dive|wade)\s+into\b/gi },
  { category: "hedging observation", pattern: /\b(?:looks|appears|seems)\s+(?:like|to)\b/gi },
  {
    category: "sycophantic acknowledgment",
    pattern: /\byou(?:'re|\s+are)\s+(?:absolutely\s+|completely\s+)?right\b/gi,
    sideEffectOnly: true,
  },
  { category: "permission-seeking", pattern: /\bwant\s+me\s+to\s+\w+/gi, sideEffectOnly: true },
  { category: "hedging close", pattern: /\bwould\s+you\s+like\b/gi, sideEffectOnly: true },
  { category: "I understand", pattern: /\bi\s+understand\b/gi, sideEffectOnly: true },
];

function stripCode(text: string): string {
  return text.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
}

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
