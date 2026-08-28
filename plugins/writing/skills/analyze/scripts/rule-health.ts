import { z } from "zod";
import { type DeliverableAudit, isDeliverableSurface } from "./deliverable-audit";
import type { QuoteContext } from "./quote-context";
import type { VoiceProfile } from "./voice-profile";
import { phraseProfileStatStemmed } from "./voice-profile";
import type { WordlistEntry } from "./wordlists";

export const FtsAuditRow = z.object({
  term: z.string(),
  assistant_count: z.number(),
  user_count: z.number(),
  assistant_per_m: z.number().nullable(),
  user_per_m: z.number().nullable(),
  lift: z.number().nullable(),
});
export type FtsAuditRow = z.infer<typeof FtsAuditRow>;

export type RemoveReason = "dead" | "not distinctive";
export type AuditSurface = "chat" | "deliverable";

export interface CurrentRuleHealth {
  entry: WordlistEntry;
  surface: AuditSurface;
  // Model rate on the audited surface (chat assistant text, or deliverable
  // prose) and the comparison baseline (chat user text, or voice baseline).
  modelCount: number;
  modelPerM: number | null;
  baselinePerM: number | null;
  lift: number | null;
  status: "keep" | "remove";
  removeReason: RemoveReason | null;
  noData: boolean;
  quote: QuoteContext | null;
}

export interface RuleHealthInput {
  entries: WordlistEntry[];
  chatAudit: Map<string, FtsAuditRow>;
  deliverableAudit: DeliverableAudit | null;
  voiceProfile: VoiceProfile | null;
  minCount: number;
  findQuote?: (entry: WordlistEntry, surface: AuditSurface) => QuoteContext | null;
}

// Audit each rule against the surface where it actually fires. Chat-surface
// rules (openers, sycophantic patterns, conversational vocabulary) keep the
// FTS chat comparison: the model's chat usage of a term tracks its habit.
// Deliverable-surface rules (flowery phrases, soft phrasing) are judged on the
// model's deliverable-prose rate. The chat audit cannot measure them: it stems
// each entry and joins against single-word FTS tokens, so a multi-word phrase
// never matches and would read as a false "dead". They are always routed to
// the deliverable audit. With the voice baseline loaded they also get a
// distinctiveness check against the user's hand-written voice. Without it the
// baseline is unknown, so an alive rule is kept rather than proposed for
// removal (we never recommend dropping a rule we cannot measure).
export function buildRuleHealth(input: RuleHealthInput): CurrentRuleHealth[] {
  const { entries, chatAudit, deliverableAudit, voiceProfile, minCount, findQuote } = input;

  return entries.map((entry) => {
    const onDeliverable = deliverableAudit !== null && isDeliverableSurface(entry.source);
    const surface: AuditSurface = onDeliverable ? "deliverable" : "chat";
    const quote = findQuote ? findQuote(entry, surface) : null;

    if (onDeliverable) {
      return buildDeliverableHealth(entry, deliverableAudit, voiceProfile, minCount, quote);
    }
    return buildChatHealth(entry, chatAudit, minCount, quote);
  });
}

function buildChatHealth(
  entry: WordlistEntry,
  chatAudit: Map<string, FtsAuditRow>,
  minCount: number,
  quote: QuoteContext | null,
): CurrentRuleHealth {
  const row = chatAudit.get(entry.phrase.toLowerCase());
  const modelCount = row?.assistant_count ?? 0;
  const baselinePerM = row?.user_per_m ?? null;
  const modelPerM = row?.assistant_per_m ?? null;
  const lift = row?.lift ?? null;
  const noData = !row || (modelCount === 0 && row.user_count === 0);

  const { status, removeReason } = verdict(modelCount, modelPerM, baselinePerM, minCount);
  return {
    entry,
    surface: "chat",
    modelCount,
    modelPerM,
    baselinePerM,
    lift,
    status,
    removeReason,
    noData,
    quote,
  };
}

function buildDeliverableHealth(
  entry: WordlistEntry,
  deliverableAudit: DeliverableAudit,
  voiceProfile: VoiceProfile | null,
  minCount: number,
  quote: QuoteContext | null,
): CurrentRuleHealth {
  const audit = deliverableAudit.byPhrase.get(entry.phrase);
  const modelCount = audit?.count ?? 0;
  const modelPerM = audit?.perMillion ?? 0;

  if (!voiceProfile) {
    // No baseline loaded. Judge only whether the rule fires on its deliverable
    // surface; distinctiveness is unmeasurable, so an alive rule is kept.
    const alive = modelCount >= minCount;
    return {
      entry,
      surface: "deliverable",
      modelCount,
      modelPerM,
      baselinePerM: null,
      lift: null,
      status: alive ? "keep" : "remove",
      removeReason: alive ? null : "dead",
      noData: true,
      quote,
    };
  }

  const baseline = phraseProfileStatStemmed(voiceProfile, entry.phrase);
  const baselinePerM = baseline.perMillion;
  const lift = baselinePerM > 0 ? modelPerM / baselinePerM : null;
  const noData = modelCount === 0 && baseline.count === 0;

  const { status, removeReason } = verdict(modelCount, modelPerM, baselinePerM, minCount);
  return {
    entry,
    surface: "deliverable",
    modelCount,
    modelPerM,
    baselinePerM,
    lift,
    status,
    removeReason,
    noData,
    quote,
  };
}

function verdict(
  modelCount: number,
  modelPerM: number | null,
  baselinePerM: number | null,
  minCount: number,
): { status: "keep" | "remove"; removeReason: RemoveReason | null } {
  const alive = modelCount >= minCount;
  const distinctive = (modelPerM ?? 0) > (baselinePerM ?? 0);
  if (!alive) return { status: "remove", removeReason: "dead" };
  if (!distinctive) return { status: "remove", removeReason: "not distinctive" };
  return { status: "keep", removeReason: null };
}
