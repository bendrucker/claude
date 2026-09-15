import { z } from "zod";

export const GATE_RULES = ["size", "growth", "append-only", "unchanged"] as const;
export type GateRule = (typeof GATE_RULES)[number];

export type Decision =
  | `gate:${GateRule}`
  | "approved"
  | "user:rejected"
  | "user:rejected-silent"
  | "none"
  | "unknown";

// Reason openings from both the 12k era (before #1293) and the 10k era, so a
// mined response classifies the same way whichever gate produced it. Anchored
// to the start because an approval echoes the plan text, which can mention a
// rule phrase.
const RULE_PATTERNS: readonly [GateRule, RegExp][] = [
  ["size", /^This plan exceeds 1[02]k characters|^This rework is still over 10k characters/],
  ["growth", /^Presentation \d+ is larger than any before it/],
  [
    "append-only",
    /^This (plan keeps nearly every line|re-present carries nearly every prior line)/,
  ],
  [
    "unchanged",
    /^(This plan is unchanged from|Plan text is byte-identical to) the (one|presentation) that was just rejected/,
  ],
];

const SILENT_REJECTION = /STOP what you are doing and wait for the user/;
const REJECTION = /doesn't want to proceed|was rejected|^YOUR PLAN WAS NOT APPROVED/;

export function gateRule(reason: string): GateRule | null {
  for (const [rule, pattern] of RULE_PATTERNS) {
    if (pattern.test(reason)) return rule;
  }
  return null;
}

/** Classifies the tool_result an ExitPlanMode call received. */
export function classifyResponse(response: string | null | undefined): Decision {
  if (response == null || response === "") return "none";
  const rule = gateRule(response);
  if (rule !== null) return `gate:${rule}`;
  if (/approved your plan|approved exiting plan mode/.test(response)) return "approved";
  if (REJECTION.test(response)) {
    return SILENT_REJECTION.test(response) ? "user:rejected-silent" : "user:rejected";
  }
  return "unknown";
}

export const Present = z.object({
  host: z.string(),
  session_id: z.string(),
  session: z.string(),
  project_path: z.string().nullable(),
  timestamp: z.string(),
  seq: z.number(),
  chars: z.number(),
  plan: z.string(),
  plan_file: z.string().nullable(),
  model: z.string().nullable(),
  response: z.string().nullable(),
  actual: z.string(),
});
export type Present = z.infer<typeof Present>;

export const Presents = z.array(Present);

export function caseId(present: Pick<Present, "session" | "seq">): string {
  return `${present.session}-seq${present.seq}`;
}

// The short session prefix keys result files and replay rows, so two sessions
// sharing it would swap cached results. Refuse the corpus rather than the run.
export function assertDistinctSessions(presents: readonly Present[]): void {
  const owners = new Map<string, string>();
  for (const present of presents) {
    const owner = owners.get(present.session);
    if (owner !== undefined && owner !== present.session_id) {
      throw new Error(
        `session prefix ${present.session} names both ${owner} and ${present.session_id}`,
      );
    }
    owners.set(present.session, present.session_id);
  }
}

/** Groups presents by host and session, each list in presentation order. */
export function bySession(presents: readonly Present[]): Map<string, Present[]> {
  const sessions = new Map<string, Present[]>();
  for (const present of presents) {
    const key = `${present.host}:${present.session_id}`;
    const list = sessions.get(key) ?? [];
    list.push(present);
    sessions.set(key, list);
  }
  for (const list of sessions.values()) list.sort((a, b) => a.seq - b.seq);
  return sessions;
}
