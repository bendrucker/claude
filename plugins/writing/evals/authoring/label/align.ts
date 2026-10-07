import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";

const WINDOW = 400;
const FENCE_PREFIX = /^ {0,3}(?:`{3,}|~{3,})/;

/** Marks the source characters a markdown renderer drops along with the markup around them. */
function hiddenMask(source: string): Uint8Array {
  const hidden = new Uint8Array(source.length);
  const hide = (start: number, end: number) => hidden.fill(1, start, end);
  visit(fromMarkdown(source), (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "definition") hide(start, end);
    else if (node.type === "link" || node.type === "image") {
      const from =
        node.type === "link" ? (node.children.at(-1)?.position?.end.offset ?? start) : start;
      const bracket = source.indexOf("](", from);
      if (bracket !== -1 && bracket < end) hide(bracket + 1, end);
    } else if (node.type === "code") {
      const prefix = FENCE_PREFIX.exec(source.slice(start, end))?.[0];
      if (prefix === undefined) return;
      const lineEnd = source.indexOf("\n", start);
      hide(start + prefix.length, lineEnd === -1 || lineEnd > end ? end : lineEnd);
    }
  });
  return hidden;
}

/**
 * Maps every offset in `rendered`, the text of a rendered markdown document, to an offset in its
 * `source`, plus one entry for the end. Visible characters match in order within a bounded window,
 * and whitespace matches loosely, so the map never decreases.
 */
export function sourceOffsets(rendered: string, source: string): Int32Array {
  const hidden = hiddenMask(source);
  const map = new Int32Array(rendered.length + 1);
  let j = 0;
  for (let i = 0; i < rendered.length; i++) {
    const c = rendered[i] ?? "";
    map[i] = j;
    if (/\s/.test(c)) continue;
    for (let k = j, seen = 0; k < source.length && seen < WINDOW; k++) {
      if (hidden[k] === 1) continue;
      seen++;
      if (source[k] === c) {
        map[i] = k;
        j = k + 1;
        break;
      }
    }
  }
  map[rendered.length] = j;
  return map;
}

/** The source range covering rendered characters [start, end). */
export function toSource(map: Int32Array, start: number, end: number): [number, number] {
  return [map[start] ?? 0, (map[end - 1] ?? 0) + 1];
}

/** The rendered range covering source characters [start, end), or undefined when none maps inside. */
export function toRendered(
  map: Int32Array,
  start: number,
  end: number,
): [number, number] | undefined {
  const chars = map.length - 1;
  const first = lowerBound(map, start, chars);
  const last = lowerBound(map, end, chars);
  return first < last ? [first, last] : undefined;
}

function lowerBound(map: Int32Array, value: number, length: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((map[mid] ?? 0) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface Token {
  key: string;
  start: number;
  end: number;
}

/** Words of `text`, keyed lowercase with punctuation stripped. */
export function tokenize(text: string): Token[] {
  return [...text.matchAll(/\S+/g)]
    .map((m) => ({
      key: m[0].toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, ""),
      start: m.index,
      end: m.index + m[0].length,
    }))
    .filter((t) => t.key !== "");
}

const MAX_CELLS = 16_000_000;

/**
 * Character ranges of `a` and `b` inside word runs the two texts share, by a longest common
 * subsequence over words that ignores case and punctuation. Runs shorter than `minRun` words are
 * dropped, so common words scattered through two independent drafts do not count as shared.
 */
export function sharedRuns(
  a: string,
  b: string,
  minRun = 3,
): { a: [number, number][]; b: [number, number][] } {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;
  if (n * m > MAX_CELLS) return { a: [], b: [] };
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        ta[i]?.key === tb[j]?.key ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const matches: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (ta[i]?.key === tb[j]?.key) {
      matches.push([i, j]);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }

  const runsA: [number, number][] = [];
  const runsB: [number, number][] = [];
  const flush = (run: [number, number][]) => {
    const first = run[0];
    const last = run.at(-1);
    if (run.length < minRun || first === undefined || last === undefined) return;
    runsA.push([ta[first[0]]?.start ?? 0, ta[last[0]]?.end ?? 0]);
    runsB.push([tb[first[1]]?.start ?? 0, tb[last[1]]?.end ?? 0]);
  };
  let run: [number, number][] = [];
  for (const match of matches) {
    const prev = run.at(-1);
    if (prev !== undefined && (match[0] !== prev[0] + 1 || match[1] !== prev[1] + 1)) {
      flush(run);
      run = [];
    }
    run.push(match);
  }
  flush(run);
  return { a: runsA, b: runsB };
}
