// A count in a list lead-in ("keeps six:", "three groups:") restates what the
// list shows and goes stale when an item changes. People state small counts
// naturally ("two reasons:"), so the awkwardness grows with the number, and
// the detector flags three and up. The structural test is agreement: a
// cardinal in the lead-in equals the number of items after its colon. A
// measurement or label in a lead-in ("on 10 cores:", "35 miles:") almost never
// matches the length of what follows, and the tagger only has to confirm the
// number is a cardinal that counts something.
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

// A list item opens with a bullet or an enumerator. Continuation lines sit
// deeper than the item's marker, and a blank line between items stays inside
// the list.
const LIST_ITEM = /^([ \t]*)(?:[-*+•]|\d+[.)])[ \t]/;
const TABLE_ROW = /^\s*\|/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

function blockItems(lines: string[]): number {
  const first = lines[0] ?? "";
  if (TABLE_ROW.test(first)) {
    const end = lines.findIndex((line) => !TABLE_ROW.test(line));
    const rows = end === -1 ? lines : lines.slice(0, end);
    return rows.filter((row) => !TABLE_DIVIDER.test(row)).length - 1;
  }
  const indent = LIST_ITEM.exec(first)?.[1];
  if (indent === undefined) return 0;
  let items = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const marker = LIST_ITEM.exec(line);
    if (marker?.[1] === indent) items++;
    else if (marker === null && !line.startsWith(`${indent} `) && !line.startsWith(`${indent}\t`))
      break;
  }
  return items;
}

// An inline enumeration runs to the end of its sentence, and its last item
// opens with the conjunction ("a, b, and c"). A segment that is only
// whitespace held a code span stripCode blanked, so it still counts. Commas
// inside parentheses belong to an aside, not the list.
function inlineItems(rest: string): number {
  const sentence = (rest.split(/[.!?](?:\s|$)|\n/)[0] ?? "").replaceAll(/\([^)]*\)/g, "");
  const parts = sentence.split(/[,;]/).filter((part) => part !== "");
  const closing = parts.findIndex((part, at) => at > 0 && /^\s*(?:and|or)\b/.test(part));
  if (closing !== -1) return closing + 1;
  return /\b(?:and|or)\b/.test(parts.at(-1) ?? "") ? parts.length + 1 : parts.length;
}

/** How many items follow a lead-in's colon. */
export function itemsAfter(rest: string): number {
  const [line = "", ...below] = rest.split("\n");
  if (line.trim() !== "") return inlineItems(line);
  return blockItems(below.filter((_, at) => at >= below.findIndex((l) => l.trim() !== "")));
}

// A cardinal counts things unless it ends a fraction or bound ("0 of 3",
// "more than three"), is a percentage, or is a bare label that makes up the
// whole lead-in ("3:").
function quantifies(tokens: TaggedToken[], at: number): boolean {
  if (tokens.length === 1) return false;
  if (tokens[at]?.text.endsWith("%") || tokens[at + 1]?.tag === "PUNCT") return false;
  // The tagger reads "of" and "more than" as part of the number.
  const fraction = [tokens[at - 1], tokens[at - 2]].some((token) => token?.tag === "NUM");
  return !fraction;
}

/** Index of a cardinal in the lead-in that counts the items after it. */
function countedAt(nlp: Parse, tokens: TaggedToken[], items: number): number | undefined {
  const at = tokens.findIndex(
    (token, i) => cardinalValue(nlp, token) === items && quantifies(tokens, i),
  );
  return at === -1 ? undefined : at;
}

export async function countedLeadInSpans(text: string): Promise<PatternSpan[]> {
  const leadIns = [...text.matchAll(LEAD_IN)]
    .map((match) => ({ match, items: itemsAfter(text.slice(match.index + match[0].length)) }))
    .filter(({ items }) => items >= MIN_COUNT);
  if (leadIns.length === 0) return [];
  parsing ??= import("compromise").then(({ default: nlp }) => nlp);
  const [nlp, tag] = await Promise.all([parsing, loadCompromise()]);
  const spans: PatternSpan[] = [];
  for (const { match, items } of leadIns) {
    const leadIn = match[0].slice(0, -1);
    const tokens = tag(leadIn).flatMap((sentence) => sentence.tokens);
    const at = countedAt(nlp, tokens, items);
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
    "The global list keeps six:\n\n- a\n- b\n- c\n- d\n- e\n- f",
    "Three things:\n\n1. the cache\n2. the queue\n3. the lock",
    "This PR makes four changes:\n- one\n- two\n- three\n- four",
    "Sandboxed git failures fall into three groups: locks, writes, and removals.",
    "Three paths are untested against the real thing:\n- ssh\n- the remote\n- the cask",
    "It closes the 3 open issues: `#1`, `#2`, and `#3`.",
  ],
  negatives: [
    "Two reasons:\n\n1. cost\n2. latency",
    "Node 20: supported.",
    "Load spikes up to 216 on 10 cores:\n- the index job\n- the backup",
    "Where the bare connector misses, all 0 of 3:\n- a\n- b\n- c",
    "The meeting starts at 10:30 today.",
    "Three reviewers approved the change.",
    "It found three patterns, described below.",
  ],
  evidence:
    "User-flagged 2026-10 as slop, with the awkwardness growing with the count. Corpus audit 2026-10-27 over cloud-session replies and chat, PR bodies, and PR comments (847K chars) against the user's pre-AI writing (6.0M chars across mail, PRs, issues, blog): counts of two run 20/M assistant versus 14/M user, too close to flag, and counts of three and up run 37/M versus 4.7/M. On a hand-labeled pool of 462 lead-ins carrying a cardinal of three or more, precision is 0.91 and recall 0.71, against 0.57 and 0.42 for the noun-phrase rule agreement replaced. The holdout third scored 0.91 and 0.68. Misses are lists without markers (plain lines in mail), counts the items do not spell out one to one (both X runs, one Y run), and code blocks stripCode removes.",
  retire:
    "Remove when the assistant rate for counts of three and up falls to the voice-corpus baseline in a corpus audit window, or when a labeling pass shows most hits are not list lead-ins.",
};
