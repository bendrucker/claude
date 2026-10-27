// A count in a list lead-in ("keeps six:", "three groups:") restates what the
// list shows and goes stale when an item changes. People state small counts
// naturally ("two reasons:"), so the awkwardness grows with the number, and
// the detector flags three and up. The tagger reads the lead-in's grammar: a
// cardinal heading the noun phrase that ends at the colon, or a bare cardinal
// as the object of a verb. A cardinal after a bare noun is a label ("Node
// 20:"), but one after a determined noun still counts ("the following six:").
// A noun phrase that runs past its head is a rate or a relative clause ("five
// runs per arm:").
//
// Callers pass code-stripped text (see negation.ts).

import type Nlp from "compromise";
import { loadCompromise } from "../linguistics/compromise";
import type { TaggedToken } from "../linguistics/tags";
import type { PatternDef, PatternSpan } from "./tropes";
import type { Hits } from "./wordlists";

const MIN_COUNT = 3;

// The lead-in runs from the last sentence or line break to a colon that ends
// the clause. A colon inside a token (10:30, key:value) is not a lead-in.
const LEAD_IN = /[^\n.!?]*:(?=\s|$)/g;

type Parse = typeof Nlp;

let parsing: Promise<Parse> | undefined;

function cardinalValue(nlp: Parse, token: TaggedToken): number | undefined {
  if (token.tag !== "NUM" || !token.fine.includes("Cardinal")) return undefined;
  const [value]: unknown[] = [nlp(token.text).numbers().get()].flat();
  return typeof value === "number" ? value : undefined;
}

function isPluralNoun(token: TaggedToken | undefined): boolean {
  return token?.tag === "NOUN" && token.fine.includes("Plural");
}

/** Index of the counted cardinal in a lead-in's tokens, when the lead-in counts its list. */
function countedAt(nlp: Parse, tokens: TaggedToken[]): number | undefined {
  for (let at = tokens.length - 1; at >= 0; at--) {
    const token = tokens[at];
    if (token?.tag !== "NUM") continue;
    const value = cardinalValue(nlp, token);
    if (value === undefined || value < MIN_COUNT) return undefined;
    const before = tokens[at - 1];
    const label =
      before?.tag === "PROPN" || (before?.tag === "NOUN" && tokens[at - 2]?.tag !== "DET");
    if (label) return undefined;
    const after = tokens.slice(at + 1);
    if (after.length === 0) {
      return before?.tag === "VERB" && at >= 2 ? at : undefined;
    }
    const head = after.at(-1);
    const modifiers = after.slice(0, -1);
    const phrase =
      isPluralNoun(head) && modifiers.every((t) => t.tag === "ADJ" || t.tag === "NOUN");
    return phrase ? at : undefined;
  }
  return undefined;
}

export async function countedLeadInSpans(text: string): Promise<PatternSpan[]> {
  const leadIns = [...text.matchAll(LEAD_IN)].filter((match) => match[0].trim() !== ":");
  if (leadIns.length === 0) return [];
  parsing ??= import("compromise").then(({ default: nlp }) => nlp);
  const [nlp, tag] = await Promise.all([parsing, loadCompromise()]);
  const spans: PatternSpan[] = [];
  for (const match of leadIns) {
    const leadIn = match[0].slice(0, -1);
    const tokens = tag(leadIn)
      .flatMap((sentence) => sentence.tokens)
      .filter((token) => token.tag !== "PUNCT");
    const at = countedAt(nlp, tokens);
    if (at === undefined) continue;
    const from = tokens[at - 1]?.span?.start ?? tokens[at]?.span?.start ?? 0;
    spans.push({ index: match.index + from, matched: `${leadIn.slice(from).trim()}:` });
  }
  return spans;
}

async function countedLeadInHits(text: string): Promise<Hits> {
  const spans = await countedLeadInSpans(text);
  return { count: spans.length, sample: spans[0]?.matched ?? "" };
}

export const COUNTED_LEAD_IN_PATTERN: PatternDef = {
  tier: "context",
  layer: "grammar",
  category: "counted list lead-in",
  test: countedLeadInHits,
  spans: countedLeadInSpans,
  message: (matched) =>
    `"${matched}" counts the list it introduces. Drop the number and let the list speak: "keeps:" rather than "keeps six:".`,
  positives: [
    "The global list keeps six:\n\n- a\n- b",
    "Three things:\n\n1. the cache\n2. the queue",
    "This PR makes four changes:\n- one",
    "Sandboxed git failures fall into three groups:\n- a",
    "It closes the 17 open issues:\n- a",
    "It reads the following three files:\n- a",
  ],
  negatives: [
    "Two reasons:\n\n1. cost\n2. latency",
    "Node 20: supported.",
    "Thread 6:\n0 libSystem",
    "The meeting starts at 10:30 today.",
    "Ran five runs per arm:\n\n| Case | With |",
    "Trimming would have been wrong for all three: each reason stands alone.",
    "The third step: migrate the readers.",
    "Three reviewers approved the change.",
  ],
  evidence:
    "User-flagged 2026-10 as slop, with the awkwardness growing with the count. Corpus audit 2026-10-27 over cloud-session replies and chat, PR bodies, and PR comments (847K chars) against the user's pre-AI writing (6.0M chars across mail, PRs, issues, blog). Counts of two run 20/M assistant versus 14/M user, too close to flag. Counts of three and up run 20/M versus 6.8/M, and half the user hits are labels in itineraries, mail digests, and crash logs, which leaves about 3/M in the user's prose. Hand-labeled precision on assistant hits is about 70%. The misses are measurements in a lead-in that introduces something else (on 10 cores, 4 threads) and a bounded count (more than three titles).",
  retire:
    "Remove when the assistant rate for counts of three and up falls to the voice-corpus baseline in a corpus audit window, or when a labeling pass shows most hits are not list lead-ins.",
};
