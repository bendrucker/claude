import { stemmer } from "stemmer";
import { countSubsequence } from "../../../detection/wordlists";
import { cleanText } from "./ngram";
import type { WordlistEntry } from "./wordlists";

export const WORD_TOKEN = /[a-zA-Z]+/g;

// Rules the hook fires *exclusively* on deliverable prose (file writes and
// PR/MR/commit bodies): the flowery-phrase phrase group and the soft-phrasing
// weighted group are both fileOnly in tropes.ts. These are audited against the
// model's deliverable corpus and the user's voice baseline, not chat
// text_content, because the chat surface barely contains them and would report
// them as dead.
//
// marketing-verbs.txt is deliberately excluded: its hook group is not fileOnly,
// so it fires on chat side-effect inputs too. Auditing it against deliverables
// alone undercounts it (and the few deliverable hits are often the user's own
// meta-discussion of the wordlist file). It stays on the chat audit, where its
// usage tracks the model's overall habit.
const DELIVERABLE_SOURCES = new Set(["flowery-phrases.txt", "soft-phrasing.txt"]);

export function isDeliverableSurface(source: string): boolean {
  return DELIVERABLE_SOURCES.has(source);
}

export function stemTokens(text: string): string[] {
  return (cleanText(text).toLowerCase().match(WORD_TOKEN) ?? []).map((w) => stemmer(w));
}

// Stem a wordlist phrase into its needle tokens. Unlike stemTokens it does not
// run cleanText, because a wordlist entry is already clean prose, matching how
// auditDeliverableCorpus builds its needles.
export function stemPhrase(phrase: string): string[] {
  return (phrase.toLowerCase().match(WORD_TOKEN) ?? []).map((w) => stemmer(w));
}


export interface DeliverableAuditRow {
  count: number;
  perMillion: number;
}

export interface DeliverableAudit {
  totalTokens: number;
  byPhrase: Map<string, DeliverableAuditRow>;
}

// Audit each entry against the deliverable corpus, returning per-entry counts
// and per-million rates. Phrases are stemmed the same way the hook stems them,
// so inflection and hyphenation match (e.g. "fails loudly" counts for "fail
// loudly").
export function auditDeliverableCorpus(
  entries: WordlistEntry[],
  rows: Array<{ text?: string }>,
): DeliverableAudit {
  const needles = entries.map((e) => ({
    phrase: e.phrase,
    stems: stemPhrase(e.phrase),
  }));
  const counts = new Map<string, number>();
  for (const n of needles) counts.set(n.phrase, 0);

  let totalTokens = 0;
  for (const row of rows) {
    if (!row.text) continue;
    const tokens = stemTokens(row.text);
    totalTokens += tokens.length;
    for (const n of needles) {
      if (n.stems.length === 0) continue;
      const hits = countSubsequence(tokens, n.stems);
      if (hits > 0) counts.set(n.phrase, (counts.get(n.phrase) ?? 0) + hits);
    }
  }

  const byPhrase = new Map<string, DeliverableAuditRow>();
  for (const [phrase, count] of counts) {
    byPhrase.set(phrase, {
      count,
      perMillion: totalTokens > 0 ? (count / totalTokens) * 1_000_000 : 0,
    });
  }
  return { totalTokens, byPhrase };
}
