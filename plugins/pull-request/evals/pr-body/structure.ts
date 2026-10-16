import type { List, ListItem, Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

// Structural measurements of a PR body. "Visible" means what a reader sees
// without expanding anything: outside fenced code and outside <details>.

export interface Structure {
  visibleWords: number;
  collapsedWords: number;
  hiddenWords: number;
  leadWords: number;
  paragraphs: number;
  maxParagraphWords: number;
  meanParagraphWords: number;
  paragraphsOver40: number;
  maxBlockWords: number;
  blocksOver30: number;
  maxSentencesPerParagraph: number;
  meanSentenceWords: number;
  bullets: number;
  lists: number;
  maxItemsPerList: number;
  meanWordsPerBullet: number;
  maxWordsPerBullet: number;
  bulletsOver20: number;
  multiSentenceBullets: number;
  listShare: number;
  headings: number;
  headingsPer100: number;
  visibleTables: number;
  visibleImages: number;
  visibleCodeLines: number;
  collapsedBlocks: number;
  checkboxes: number;
  semicolons: number;
  dashes: number;
  inlineCodePer100: number;
  proseCodeSpans: number;
}

const wordSeg = new Intl.Segmenter("en", { granularity: "word" });
const sentenceSeg = new Intl.Segmenter("en", { granularity: "sentence" });

export function countWords(text: string): number {
  let n = 0;
  for (const s of wordSeg.segment(text)) if (s.isWordLike) n++;
  return n;
}

export function sentences(text: string): string[] {
  return [...sentenceSeg.segment(text)].map((s) => s.segment.trim()).filter(Boolean);
}

const DETAILS_OPEN = /<details[\s>]/gi;
const DETAILS_CLOSE = /<\/details>/gi;

function detailsDelta(html: string): { opens: number; delta: number } {
  const opens = (html.match(DETAILS_OPEN) ?? []).length;
  return { opens, delta: opens - (html.match(DETAILS_CLOSE) ?? []).length };
}

function ownText(item: ListItem): string {
  return item.children
    .filter((c) => c.type !== "list")
    .map((c) => toString(c))
    .join(" ");
}

interface Acc {
  paragraphWords: number[];
  sentenceWords: number[];
  sentencesPerParagraph: number[];
  bulletWords: number[];
  bulletSentences: number[];
  listSizes: number[];
  visibleWords: number;
  collapsedWords: number;
  tableWords: number;
  fenceWords: number;
  listWords: number;
  headings: number;
  visibleTables: number;
  visibleImages: number;
  visibleCodeLines: number;
  collapsedBlocks: number;
  checkboxes: number;
  inlineCode: number;
  proseText: string[];
}

function countImages(node: Nodes): number {
  if (node.type === "image" || node.type === "imageReference") return 1;
  if (node.type === "html" && /<img\s/i.test(node.value)) return 1;
  return "children" in node ? node.children.reduce((n, c) => n + countImages(c), 0) : 0;
}

function countInlineCode(node: Nodes): number {
  if (node.type === "inlineCode") return 1;
  return "children" in node ? node.children.reduce((n, c) => n + countInlineCode(c), 0) : 0;
}

function visitList(list: List, acc: Acc): void {
  acc.listSizes.push(list.children.length);
  for (const item of list.children) {
    if (item.checked !== null && item.checked !== undefined) acc.checkboxes++;
    const text = ownText(item);
    const words = countWords(text);
    acc.bulletWords.push(words);
    acc.bulletSentences.push(sentences(text).length);
    acc.listWords += words;
    acc.visibleWords += words;
    acc.inlineCode += item.children
      .filter((c) => c.type !== "list")
      .reduce((n, c) => n + countInlineCode(c), 0);
    acc.visibleImages += countImages(item);
    acc.proseText.push(text);
    for (const child of item.children) if (child.type === "list") visitList(child, acc);
  }
}

function visitChildren(children: RootContent[], acc: Acc, collapsed: boolean): void {
  let depth = 0;
  for (const node of children) {
    if (node.type === "html") {
      const { opens, delta } = detailsDelta(node.value);
      if (opens > 0 && depth === 0 && !collapsed) acc.collapsedBlocks++;
      // A <details> glued to its body without a blank line stays one html node.
      if (opens > 0 && delta === 0) {
        acc.collapsedWords += countWords(node.value.replaceAll(/<[^>]+>/g, " "));
      } else if (!collapsed && depth === 0) {
        acc.visibleImages += countImages(node);
      }
      depth = Math.max(0, depth + delta);
      continue;
    }
    const hidden = collapsed || depth > 0;
    if (hidden) {
      if (node.type === "code") acc.fenceWords += countWords(node.value);
      else acc.collapsedWords += countWords(toString(node));
      continue;
    }
    // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- other block types carry no prose
    switch (node.type) {
      case "heading":
        acc.headings++;
        acc.visibleWords += countWords(toString(node));
        break;
      case "paragraph": {
        const text = toString(node);
        const words = countWords(text);
        if (words === 0) {
          acc.visibleImages += countImages(node);
          break;
        }
        const ss = sentences(text);
        acc.paragraphWords.push(words);
        acc.sentencesPerParagraph.push(ss.length);
        for (const s of ss) acc.sentenceWords.push(countWords(s));
        acc.visibleWords += words;
        acc.visibleImages += countImages(node);
        acc.inlineCode += countInlineCode(node);
        acc.proseText.push(text);
        break;
      }
      case "list":
        visitList(node, acc);
        break;
      case "table":
        acc.visibleTables++;
        acc.tableWords += countWords(
          node.children.flatMap((row) => row.children.map((c) => toString(c))).join(" "),
        );
        acc.visibleImages += countImages(node);
        break;
      case "code":
        acc.visibleCodeLines += node.value.split("\n").length;
        acc.fenceWords += countWords(node.value);
        break;
      case "blockquote":
        visitChildren(node.children, acc, false);
        break;
      default:
        break;
    }
  }
}

const max = (xs: number[]) => (xs.length > 0 ? Math.max(...xs) : 0);
const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const per100 = (n: number, words: number) => (words > 0 ? (100 * n) / words : 0);

export function measureStructure(body: string): Structure {
  const root = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const acc: Acc = {
    paragraphWords: [],
    sentenceWords: [],
    sentencesPerParagraph: [],
    bulletWords: [],
    bulletSentences: [],
    listSizes: [],
    visibleWords: 0,
    collapsedWords: 0,
    tableWords: 0,
    fenceWords: 0,
    listWords: 0,
    headings: 0,
    visibleTables: 0,
    visibleImages: 0,
    visibleCodeLines: 0,
    collapsedBlocks: 0,
    checkboxes: 0,
    inlineCode: 0,
    proseText: [],
  };
  visitChildren(root.children, acc, false);
  const firstParagraph = root.children.find((n) => n.type === "paragraph");
  const prose = acc.proseText.join("\n");
  const v = acc.visibleWords;
  return {
    visibleWords: v,
    collapsedWords: acc.collapsedWords,
    hiddenWords: acc.collapsedWords + acc.tableWords + acc.fenceWords,
    leadWords: firstParagraph ? countWords(toString(firstParagraph)) : 0,
    paragraphs: acc.paragraphWords.length,
    maxParagraphWords: max(acc.paragraphWords),
    meanParagraphWords: mean(acc.paragraphWords),
    paragraphsOver40: acc.paragraphWords.filter((w) => w > 40).length,
    maxBlockWords: max([...acc.paragraphWords, ...acc.bulletWords]),
    blocksOver30: [...acc.paragraphWords, ...acc.bulletWords].filter((w) => w > 30).length,
    maxSentencesPerParagraph: max(acc.sentencesPerParagraph),
    meanSentenceWords: mean([...acc.sentenceWords, ...acc.bulletWords.filter(Boolean)]),
    bullets: acc.bulletWords.length,
    lists: acc.listSizes.length,
    maxItemsPerList: max(acc.listSizes),
    meanWordsPerBullet: mean(acc.bulletWords),
    maxWordsPerBullet: max(acc.bulletWords),
    bulletsOver20: acc.bulletWords.filter((w) => w > 20).length,
    multiSentenceBullets: acc.bulletSentences.filter((n) => n > 1).length,
    listShare: v > 0 ? acc.listWords / v : 0,
    headings: acc.headings,
    headingsPer100: per100(acc.headings, v),
    visibleTables: acc.visibleTables,
    visibleImages: acc.visibleImages,
    visibleCodeLines: acc.visibleCodeLines,
    collapsedBlocks: acc.collapsedBlocks,
    checkboxes: acc.checkboxes,
    semicolons: per100((prose.match(/;/g) ?? []).length, v),
    dashes: per100((prose.match(/\s[—–]\s|—/g) ?? []).length, v),
    inlineCodePer100: per100(acc.inlineCode, v),
    proseCodeSpans: acc.inlineCode,
  };
}

// One-sided limits fitted against Ben's edits and hand-written PRs: a body
// fails only by exceeding them, so terseness is never penalized.
export const LIMITS = {
  visibleWords: 120,
  maxBlockWords: 40,
  proseCodeSpans: 6,
} as const satisfies Partial<Structure>;

export type LimitKey = keyof typeof LIMITS;

const isLimitKey = (k: string): k is LimitKey => k in LIMITS;

export const limitKeys: LimitKey[] = Object.keys(LIMITS).filter(isLimitKey);

// Trimming a body to fit the limits must not move its prose into <details>,
// tables, or fences, or pile it into one long list. No baseline body comes near
// the first, and lists past five items are rare in Ben's own PRs.
export const GUARDS = {
  hiddenWords: 60,
  maxItemsPerList: 5,
} as const satisfies Partial<Structure>;

export type GuardKey = keyof typeof GUARDS;

const isGuardKey = (k: string): k is GuardKey => k in GUARDS;

export const guardKeys: GuardKey[] = Object.keys(GUARDS).filter(isGuardKey);

export function overLimits(s: Structure): LimitKey[] {
  return limitKeys.filter((k) => s[k] > LIMITS[k]);
}
