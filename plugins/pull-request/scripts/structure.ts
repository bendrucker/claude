// How much a PR body asks of its reader. Only what a reader sees without
// expanding anything counts: not fenced code, not tables, not <details>.

import type { List, ListItem, Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

export interface Structure {
  visibleWords: number;
  /** Words in the longest visible paragraph or list item. */
  maxBlockWords: number;
  /** Inline code spans in visible paragraphs and list items. */
  proseCodeSpans: number;
}

// One-sided limits fitted against hand-written PRs: a body fails only by
// exceeding them, so terseness is never penalized.
export const LIMITS = {
  visibleWords: 120,
  maxBlockWords: 40,
  proseCodeSpans: 6,
} as const satisfies Structure;

const LIMIT_LABELS = {
  visibleWords: "visible words",
  maxBlockWords: "longest paragraph or bullet words",
  proseCodeSpans: "inline code spans",
} as const satisfies Record<keyof Structure, string>;

const LIMIT_KEYS = [
  "visibleWords",
  "maxBlockWords",
  "proseCodeSpans",
] as const satisfies (keyof Structure)[];

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

function countWords(text: string): number {
  let count = 0;
  for (const segment of wordSegmenter.segment(text)) if (segment.isWordLike) count++;
  return count;
}

function countInlineCode(node: Nodes): number {
  if (node.type === "inlineCode") return 1;
  return "children" in node ? node.children.reduce((n, child) => n + countInlineCode(child), 0) : 0;
}

// Net <details> nesting an html node adds. A node that opens and closes
// within itself nets zero, so its contents never leak into the visible count.
function detailsDelta(html: string): number {
  return (html.match(/<details[\s>]/gi) ?? []).length - (html.match(/<\/details>/gi) ?? []).length;
}

interface Tally {
  visibleWords: number;
  blockWords: number[];
  proseCodeSpans: number;
}

function ownChildren(item: ListItem): RootContent[] {
  return item.children.filter((child) => child.type !== "list");
}

function tallyList(list: List, tally: Tally): void {
  for (const item of list.children) {
    const children = ownChildren(item);
    const words = countWords(children.map((child) => toString(child)).join(" "));
    tally.visibleWords += words;
    tally.blockWords.push(words);
    tally.proseCodeSpans += children.reduce((n, child) => n + countInlineCode(child), 0);
    for (const child of item.children) if (child.type === "list") tallyList(child, tally);
  }
}

function tallyBlocks(nodes: RootContent[], tally: Tally): void {
  let detailsDepth = 0;
  for (const node of nodes) {
    if (node.type === "html") {
      detailsDepth = Math.max(0, detailsDepth + detailsDelta(node.value));
      continue;
    }
    if (detailsDepth > 0) continue;
    if (node.type === "heading") {
      tally.visibleWords += countWords(toString(node));
    } else if (node.type === "paragraph") {
      const words = countWords(toString(node));
      tally.visibleWords += words;
      tally.blockWords.push(words);
      tally.proseCodeSpans += countInlineCode(node);
    } else if (node.type === "list") {
      tallyList(node, tally);
    } else if (node.type === "blockquote") {
      tallyBlocks(node.children, tally);
    }
  }
}

export function measureStructure(body: string): Structure {
  const root = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const tally: Tally = { visibleWords: 0, blockWords: [], proseCodeSpans: 0 };
  tallyBlocks(root.children, tally);
  return {
    visibleWords: tally.visibleWords,
    maxBlockWords: Math.max(0, ...tally.blockWords),
    proseCodeSpans: tally.proseCodeSpans,
  };
}

export interface ExceededLimit {
  label: string;
  measured: number;
  limit: number;
}

export function exceededLimits(structure: Structure): ExceededLimit[] {
  return LIMIT_KEYS.flatMap((key) =>
    structure[key] > LIMITS[key]
      ? [{ label: LIMIT_LABELS[key], measured: structure[key], limit: LIMITS[key] }]
      : [],
  );
}
