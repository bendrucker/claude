import { describe, expect, test } from "bun:test";
import type { DeliverableAudit } from "./deliverable-audit";
import { buildRuleHealth, type FtsAuditRow } from "./rule-health";
import type { VoiceProfile } from "./voice-profile";
import type { WordlistEntry } from "./wordlists";

function chatAudit(entry: string, row: Omit<FtsAuditRow, "term">): Map<string, FtsAuditRow> {
  return new Map([[entry, { term: entry, ...row }]]);
}

describe("buildRuleHealth (chat surface)", () => {
  const entries: WordlistEntry[] = [
    { phrase: "let me", source: "openers.txt" },
    { phrase: "missing entry", source: "openers.txt" },
  ];

  test("marks a missing audit row as dead (no occurrences)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: new Map(),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[1]?.noData).toBe(true);
    expect(result[1]?.status).toBe("remove");
    expect(result[1]?.removeReason).toBe("dead");
  });

  test("keeps a rule the model uses more than the user", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 50,
        user_count: 5,
        assistant_per_m: 5000,
        user_per_m: 500,
        lift: 10,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("keep");
    expect(result[0]?.surface).toBe("chat");
    expect(result[0]?.removeReason).toBeNull();
    expect(result[0]?.lift).toBeCloseTo(10, 0);
  });

  test("keeps a rare-but-distinctive rule even when lift reads low", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 32,
        user_count: 0,
        assistant_per_m: 296.8,
        user_per_m: 0,
        lift: 3.0,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("keep");
  });

  test("removes a rule the user uses at least as much (not distinctive)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 10,
        user_count: 40,
        assistant_per_m: 100,
        user_per_m: 200,
        lift: 0.5,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("not distinctive");
  });

  test("removes a rule below the occurrence floor (dead)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 2,
        user_count: 0,
        assistant_per_m: 18.5,
        user_per_m: 0,
        lift: 0.2,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("dead");
  });
});

describe("buildRuleHealth (deliverable surface)", () => {
  const entries: WordlistEntry[] = [{ phrase: "source of truth", source: "flowery-phrases.txt" }];

  const profile: VoiceProfile = {
    documentCount: 1,
    totalTokens: 1000,
    ngrams: { "1": {}, "2": {}, "3": {} },
    stemmedNgrams: { "1": {}, "2": {}, "3": {} },
    totalStemmedTokens: 1000,
    generatedAt: "2026-05-24",
    sources: ["github"],
  };

  function deliverableAudit(count: number, perMillion: number): DeliverableAudit {
    return { totalTokens: 100000, byPhrase: new Map([["source of truth", { count, perMillion }]]) };
  }

  test("keeps a deliverable tell frequent in deliverables and absent from baseline", () => {
    // The chat audit would call this dead (0 chat hits). The deliverable audit
    // sees it 78 times in deliverable prose and never in the voice baseline.
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("source of truth", {
        assistant_count: 0,
        user_count: 0,
        assistant_per_m: 0,
        user_per_m: 0,
        lift: null,
      }),
      deliverableAudit: deliverableAudit(78, 122.7),
      voiceProfile: profile,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("keep");
    expect(result[0]?.modelCount).toBe(78);
    expect(result[0]?.baselinePerM).toBe(0);
  });

  test("removes a deliverable tell present in the baseline (not distinctive)", () => {
    const baselineProfile: VoiceProfile = {
      ...profile,
      stemmedNgrams: { "1": {}, "2": {}, "3": { "sourc of truth": 200 } },
    };
    const result = buildRuleHealth({
      entries,
      chatAudit: new Map(),
      deliverableAudit: deliverableAudit(78, 122.7),
      voiceProfile: baselineProfile,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("not distinctive");
  });

  test("keeps a deliverable tell pending a baseline when no profile is loaded", () => {
    // No profile: the multi-word phrase must NOT fall back to the chat audit
    // (which can't match it and would call it dead). It stays on the deliverable
    // surface and, being alive there, is kept with distinctiveness unverified.
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("source of truth", {
        assistant_count: 0,
        user_count: 0,
        assistant_per_m: 0,
        user_per_m: 0,
        lift: null,
      }),
      deliverableAudit: deliverableAudit(78, 122.7),
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("keep");
    expect(result[0]?.removeReason).toBeNull();
    expect(result[0]?.baselinePerM).toBeNull();
    expect(result[0]?.noData).toBe(true);
  });

  test("marks a deliverable rule dead when it rarely fires on its own surface (no profile)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: new Map(),
      deliverableAudit: deliverableAudit(0, 0),
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("dead");
  });
});
