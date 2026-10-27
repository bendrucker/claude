#!/usr/bin/env bun

// Text summary of `malloc_history -highWaterMark -callTree`: the allocation
// sites and call paths holding the bytes live at the heap's peak.

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { table } from "table";

const units: Record<string, number> = { " bytes": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
const treeLine = /^([\s+!:|]*)(\d+) \(([\d.]+)( bytes|[KMG])\) (.*)$/;
const frameName = /^(.*?)\s+\(in ([^)]+)\)/;

// Frames that belong to the allocator rather than the code asking for memory.
const allocatorLibs = new Set(["libsystem_malloc.dylib", "libc++abi.dylib"]);
const allocatorFrames =
  /^(<<|operator new|_?(malloc|calloc|realloc|valloc|posix_memalign|aligned_alloc)\b|std::.*(allocate|__allocation_guard))/;

interface Node {
  depth: number;
  bytes: number;
  precision: number;
  name: string;
  lib: string | undefined;
  children: Node[];
}

export interface Report {
  footprintPeak: number | undefined;
  highWater: number | undefined;
  roots: Node[];
}

function parseSize(value: string, unit: string): number {
  return Number(value) * (units[unit] ?? Number.NaN);
}

export function parse(text: string): Report {
  const root: Node = { depth: -1, bytes: 0, precision: 0, name: "", lib: undefined, children: [] };
  const stack: Node[] = [root];
  let footprintPeak: number | undefined;
  let highWater: number | undefined;
  for (const raw of text.split("\n")) {
    const footprint = /^Physical footprint \(peak\):\s+([\d.]+)([KMG])/.exec(raw);
    if (footprint !== null) footprintPeak = parseSize(footprint[1] ?? "", footprint[2] ?? "");
    const mark = /^High water mark of allocated heap \+ VM memory:\s+([\d.]+) ([KMG])B/.exec(raw);
    if (mark !== null) highWater = parseSize(mark[1] ?? "", mark[2] ?? "");
    const m = treeLine.exec(raw);
    if (m === null) continue;
    const label = m[5] ?? "";
    const frame = frameName.exec(label);
    const node: Node = {
      depth: m[1]?.length ?? 0,
      bytes: parseSize(m[3] ?? "", m[4] ?? ""),
      precision: parseSize(`0.${"0".repeat(m[3]?.split(".")[1]?.length ?? 0)}5`, m[4] ?? ""),
      name: (frame?.[1] ?? label).trim(),
      lib: frame?.[2],
      children: [],
    };
    while (stack.length > 1 && (stack.at(-1)?.depth ?? -1) >= node.depth) stack.pop();
    stack.at(-1)?.children.push(node);
    stack.push(node);
  }
  return { footprintPeak, highWater, roots: root.children };
}

export interface Tally {
  sites: Map<string, number>;
  inclusive: Map<string, number>;
  matched: number;
  sum: number;
}

const label = (n: Node) => (n.lib === undefined ? n.name : `${n.name} (${n.lib})`);

// Bytes a node holds beyond its children's total were allocated at that node.
// Sizes print rounded to three digits, so a remainder within the rounding is dropped.
export function tally(report: Report, skip?: RegExp, match?: RegExp): Tally {
  const result: Tally = { sites: new Map(), inclusive: new Map(), matched: 0, sum: 0 };
  const isAllocator = (n: Node) =>
    (n.lib !== undefined && allocatorLibs.has(n.lib)) ||
    allocatorFrames.test(n.name) ||
    (skip?.test(n.name) ?? false);
  const walk = (node: Node, path: Node[]) => {
    const here = [...path, node];
    const rest = node.bytes - node.children.reduce((s, c) => s + c.bytes, 0);
    const slack = node.children.reduce((s, c) => s + c.precision, node.precision);
    const own = node.children.length > 0 && rest <= slack ? 0 : Math.max(0, rest);
    if (own > 0) {
      result.sum += own;
      for (const f of new Set(here.filter((n) => !isAllocator(n)).map(label)))
        result.inclusive.set(f, (result.inclusive.get(f) ?? 0) + own);
      const site = here.findLast((n) => !isAllocator(n));
      if (site !== undefined) {
        const key = label(site);
        result.sites.set(key, (result.sites.get(key) ?? 0) + own);
      }
      if (match !== undefined && here.some((n) => match.test(label(n)))) result.matched += own;
    }
    for (const c of node.children) walk(c, here);
  };
  for (const r of report.roots) walk(r, []);
  return result;
}

export interface Ranked {
  function: string;
  mb: number;
  percent: number;
}

const MB = 1024 ** 2;

export function rank(t: Tally, by: "sites" | "inclusive", top: number, truncate: number): Ranked[] {
  return [...t[by].entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([fn, bytes]) => ({
      function: fn.length > truncate ? `${fn.slice(0, truncate - 1)}…` : fn,
      mb: bytes / MB,
      percent: (bytes / t.sum) * 100,
    }));
}

export interface Summary {
  highWaterMb: number | undefined;
  footprintPeakMb: number | undefined;
  coveragePercent: number | undefined;
  attributedMb: number;
  match?: { pattern: string; mb: number; percent: number };
  sites: Ranked[];
  inclusive: Ranked[];
}

export function summarize(
  report: Report,
  t: Tally,
  top: number,
  truncate: number,
  match?: RegExp,
): Summary {
  const { highWater, footprintPeak } = report;
  const summary: Summary = {
    highWaterMb: highWater === undefined ? undefined : highWater / MB,
    footprintPeakMb: footprintPeak === undefined ? undefined : footprintPeak / MB,
    coveragePercent:
      highWater === undefined || footprintPeak === undefined
        ? undefined
        : (highWater / footprintPeak) * 100,
    attributedMb: t.sum / MB,
    sites: rank(t, "sites", top, truncate),
    inclusive: rank(t, "inclusive", top, truncate),
  };
  if (match !== undefined)
    summary.match = {
      pattern: match.source,
      mb: t.matched / MB,
      percent: (t.matched / t.sum) * 100,
    };
  return summary;
}

const fixed = (n: number | undefined) => (n === undefined ? "?" : n.toFixed(1));

function ranking(rows: Ranked[]): string {
  return table([
    ["function", "MB", "share"],
    ...rows.map((r) => [r.function, r.mb.toFixed(1), `${r.percent.toFixed(1)}%`]),
  ]);
}

export function renderText(s: Summary): string {
  const lines = [
    `High-water heap ${fixed(s.highWaterMb)} MB of ${fixed(s.footprintPeakMb)} MB peak footprint (${fixed(s.coveragePercent)}% covered). Tree attributes ${s.attributedMb.toFixed(1)} MB.`,
  ];
  if (s.match !== undefined)
    lines.push(
      `${s.match.mb.toFixed(1)} MB (${s.match.percent.toFixed(1)}%) live at peak under /${s.match.pattern}/.`,
    );
  lines.push(
    "Allocation sites (deepest frame outside the allocator):",
    ranking(s.sites),
    "Inclusive:",
    ranking(s.inclusive),
  );
  return lines.join("\n");
}

export function renderJson(s: Summary): string {
  return JSON.stringify(s, (_, v: unknown) =>
    typeof v === "number" ? Math.round(v * 10) / 10 : v,
  );
}

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

export const program = new Command("heap-top")
  .description(
    "Summarize `malloc_history <pid> -highWaterMark -callTree` output: what was live at the heap's peak",
  )
  .argument("<report>", "malloc_history output file")
  .option("--match <regex>", "also report the bytes under frames matching this regex")
  .option(
    "--skip <regex>",
    "treat frames matching this regex as allocator wrappers, so the site is their caller",
  )
  .option("--top <n>", "rows per ranking", int, 25)
  .option("--truncate <n>", "truncate function names to this width", int, 100)
  .option("--json", "print the summary as compact JSON")
  .action(async (path, options) => {
    const report = parse(await Bun.file(path).text());
    if (report.roots.length === 0) {
      console.error(
        "No call tree found. Record with MallocStackLogging=full and run malloc_history with -highWaterMark -callTree.",
      );
      process.exit(1);
    }
    const skip = options.skip === undefined ? undefined : new RegExp(options.skip);
    const match = options.match === undefined ? undefined : new RegExp(options.match);
    const t = tally(report, skip, match);
    const summary = summarize(report, t, options.top, options.truncate, match);
    console.log(options.json === true ? renderJson(summary) : renderText(summary));
  });

if (import.meta.main) await program.parseAsync();
