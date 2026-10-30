// How much a PR body asks of its reader. Only what a reader sees without
// expanding anything counts: not fenced code, not tables, not <details>.
// Prose and list words count apart, since lists carry parallel items cheaply.

import type { List, ListItem, Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

export interface Structure {
  /** Words in visible paragraphs and headings. */
  proseWords: number;
  /** Words in visible list items. */
  listWords: number;
  /** Words in the longest visible paragraph or list item. */
  maxBlockWords: number;
  /** Inline code spans in visible paragraphs and list items. */
  proseCodeSpans: number;
  /** Words in tables, fenced code, and <details>, which the limits skip. */
  hiddenWords: number;
  /** Inline code spans in visible prose that name a file path. */
  pathSpans: number;
  /** "instead of", "rather than", "so that", and "without" in visible prose. */
  contrastPhrases: number;
}

type LimitKey =
  | "proseWords"
  | "listWords"
  | "maxBlockWords"
  | "proseCodeSpans"
  | "pathSpans"
  | "contrastPhrases";

// One-sided limits fitted against hand-written PRs: a body fails only by
// exceeding them, so terseness is never penalized.
export const LIMITS = {
  proseWords: 120,
  listWords: 150,
  maxBlockWords: 40,
  proseCodeSpans: 6,
  pathSpans: 1,
  contrastPhrases: 1,
} as const satisfies Pick<Structure, LimitKey>;

const LIMIT_LABELS = {
  proseWords: "prose words",
  listWords: "list words",
  maxBlockWords: "longest paragraph or bullet words",
  proseCodeSpans: "inline code spans",
  pathSpans: "file paths in inline code",
  contrastPhrases: "contrast phrases (instead of, rather than, so that, without)",
} as const satisfies Record<LimitKey, string>;

const LIMIT_KEYS = [
  "proseWords",
  "listWords",
  "maxBlockWords",
  "proseCodeSpans",
  "pathSpans",
  "contrastPhrases",
] as const satisfies LimitKey[];
// A span reads as a file path when it has a directory separator or a source
// file extension. A dotted identifier like `opts.cases` is not one.
const PATH_SPAN =
  /^(?!\w+:\/\/)[^\s()]*(?:\/[^\s()]*|\.(?:[cm]?[jt]sx?|json|ya?ml|toml|md|mdx|py|go|rs|rb|sh|zsh|sql|tf|lock|txt|css|html|java|kt|swift|env))$/;

// Contrast connectives Claude stacks to justify a decision. Ben's own PRs
// rarely use two.
const CONTRAST = /\b(?:instead of|rather than|so that|without)\b/gi;

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

function countWords(text: string): number {
  let count = 0;
  for (const segment of wordSegmenter.segment(text)) if (segment.isWordLike) count++;
  return count;
}

function countInlineCode(node: Nodes, path = false): number {
  if (node.type === "inlineCode") return !path || PATH_SPAN.test(node.value) ? 1 : 0;
  return "children" in node
    ? node.children.reduce((n, child) => n + countInlineCode(child, path), 0)
    : 0;
}

function countContrast(text: string): number {
  return (text.match(CONTRAST) ?? []).length;
}

// Net <details> nesting an html node adds. A node that opens and closes
// within itself nets zero, so its contents never leak into the visible count.
function detailsDelta(html: string): number {
  return (html.match(/<details[\s>]/gi) ?? []).length - (html.match(/<\/details>/gi) ?? []).length;
}

interface Tally {
  proseWords: number;
  listWords: number;
  blockWords: number[];
  proseCodeSpans: number;
  hiddenWords: number;
  pathSpans: number;
  contrastPhrases: number;
}

function ownChildren(item: ListItem): RootContent[] {
  return item.children.filter((child) => child.type !== "list");
}

function tallyList(list: List, tally: Tally): void {
  for (const item of list.children) {
    const children = ownChildren(item);
    const text = children.map((child) => toString(child)).join(" ");
    const words = countWords(text);
    tally.listWords += words;
    tally.blockWords.push(words);
    tally.proseCodeSpans += children.reduce((n, child) => n + countInlineCode(child), 0);
    tally.pathSpans += children.reduce((n, child) => n + countInlineCode(child, true), 0);
    tally.contrastPhrases += countContrast(text);
    for (const child of item.children) if (child.type === "list") tallyList(child, tally);
  }
}

function tallyBlocks(nodes: RootContent[], tally: Tally): void {
  let detailsDepth = 0;
  for (const node of nodes) {
    if (node.type === "html") {
      const delta = detailsDelta(node.value);
      if (delta === 0 && /<details[\s>]/i.test(node.value))
        tally.hiddenWords += countWords(node.value.replaceAll(/<[^>]+>/g, " "));
      detailsDepth = Math.max(0, detailsDepth + delta);
      continue;
    }
    if (detailsDepth > 0) {
      tally.hiddenWords += countWords(node.type === "code" ? node.value : toString(node));
      continue;
    }
    if (node.type === "heading") {
      tally.proseWords += countWords(toString(node));
    } else if (node.type === "paragraph") {
      const text = toString(node);
      const words = countWords(text);
      tally.proseWords += words;
      tally.blockWords.push(words);
      tally.proseCodeSpans += countInlineCode(node);
      tally.pathSpans += countInlineCode(node, true);
      tally.contrastPhrases += countContrast(text);
    } else if (node.type === "list") {
      tallyList(node, tally);
    } else if (node.type === "table") {
      const cells = node.children.flatMap((row) => row.children.map((cell) => toString(cell)));
      tally.hiddenWords += countWords(cells.join(" "));
    } else if (node.type === "code") {
      tally.hiddenWords += countWords(node.value);
    } else if (node.type === "blockquote") {
      tallyBlocks(node.children, tally);
    }
  }
}

export function measureStructure(body: string): Structure {
  const root = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const tally: Tally = {
    proseWords: 0,
    listWords: 0,
    blockWords: [],
    proseCodeSpans: 0,
    hiddenWords: 0,
    pathSpans: 0,
    contrastPhrases: 0,
  };
  tallyBlocks(root.children, tally);
  return {
    proseWords: tally.proseWords,
    listWords: tally.listWords,
    maxBlockWords: Math.max(0, ...tally.blockWords),
    proseCodeSpans: tally.proseCodeSpans,
    hiddenWords: tally.hiddenWords,
    pathSpans: tally.pathSpans,
    contrastPhrases: tally.contrastPhrases,
  };
}

export interface ExceededLimit {
  label: string;
  measured: number;
  limit: number;
}

export function exceededLimits(structure: Pick<Structure, LimitKey>): ExceededLimit[] {
  return LIMIT_KEYS.flatMap((key) =>
    structure[key] > LIMITS[key]
      ? [{ label: LIMIT_LABELS[key], measured: structure[key], limit: LIMITS[key] }]
      : [],
  );
}
