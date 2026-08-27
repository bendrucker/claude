// Minimal lcov reader/writer. lcov is a line-based format:
//   SF:<source file>
//   FNF:<functions found>  FNH:<functions hit>
//   DA:<line>,<execution count>
//   end_of_record
// Bun emits exactly this subset, so a small parser beats an npm dependency and
// keeps the coverage tooling self-contained.

export interface FileCoverage {
  /** Source file path, as written in the `SF:` record. */
  file: string;
  /** Line number to execution count, from `DA:` records. */
  lineHits: Map<number, number>;
  functionsFound: number;
  functionsHit: number;
}

export function coveredLines(fc: FileCoverage): number[] {
  return [...fc.lineHits.entries()]
    .filter(([, hits]) => hits > 0)
    .map(([line]) => line)
    .toSorted((a, b) => a - b);
}

export function uncoveredLines(fc: FileCoverage): number[] {
  return [...fc.lineHits.entries()]
    .filter(([, hits]) => hits === 0)
    .map(([line]) => line)
    .toSorted((a, b) => a - b);
}

export interface LineCoverage {
  total: number;
  covered: number;
  /** Percentage of executable lines covered, 0-100. 100 when there are no lines. */
  pct: number;
}

export function lineCoverage(fc: FileCoverage): LineCoverage {
  const total = fc.lineHits.size;
  const covered = coveredLines(fc).length;
  const pct = total === 0 ? 100 : (covered / total) * 100;
  return { total, covered, pct };
}

export function parseLcov(text: string): FileCoverage[] {
  const records: FileCoverage[] = [];
  let current: FileCoverage | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("SF:")) {
      current = {
        file: line.slice(3),
        lineHits: new Map(),
        functionsFound: 0,
        functionsHit: 0,
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith("DA:")) {
      const [lineNo, count] = line.slice(3).split(",");
      const n = Number(lineNo);
      const c = Number(count);
      if (Number.isFinite(n) && Number.isFinite(c)) {
        current.lineHits.set(n, c);
      }
    } else if (line.startsWith("FNF:")) {
      current.functionsFound = Number(line.slice(4)) || 0;
    } else if (line.startsWith("FNH:")) {
      current.functionsHit = Number(line.slice(4)) || 0;
    } else if (line === "end_of_record") {
      records.push(current);
      current = null;
    }
  }

  if (current) records.push(current);
  return records;
}

// The repo runs tests in separate scopes (per plugin, per package), so a source
// file can appear in more than one report. Union the per-line counts: a line
// covered in any scope counts as covered.
export function merge(...reports: FileCoverage[][]): FileCoverage[] {
  const byFile = new Map<string, FileCoverage>();

  for (const report of reports) {
    for (const fc of report) {
      const existing = byFile.get(fc.file);
      if (!existing) {
        byFile.set(fc.file, {
          file: fc.file,
          lineHits: new Map(fc.lineHits),
          functionsFound: fc.functionsFound,
          functionsHit: fc.functionsHit,
        });
        continue;
      }
      for (const [line, hits] of fc.lineHits) {
        existing.lineHits.set(line, (existing.lineHits.get(line) ?? 0) + hits);
      }
      existing.functionsFound = Math.max(existing.functionsFound, fc.functionsFound);
      existing.functionsHit = Math.max(existing.functionsHit, fc.functionsHit);
    }
  }

  return [...byFile.values()];
}

export function formatLcov(reports: FileCoverage[]): string {
  const blocks: string[] = [];
  for (const fc of reports) {
    const lines = ["TN:", `SF:${fc.file}`, `FNF:${fc.functionsFound}`, `FNH:${fc.functionsHit}`];
    for (const line of [...fc.lineHits.keys()].toSorted((a, b) => a - b)) {
      lines.push(`DA:${line},${fc.lineHits.get(line)}`);
    }
    const covered = coveredLines(fc).length;
    lines.push(`LF:${fc.lineHits.size}`, `LH:${covered}`, "end_of_record");
    blocks.push(lines.join("\n"));
  }
  return blocks.length ? `${blocks.join("\n")}\n` : "";
}

// Collapse sorted line numbers into human-readable ranges: [1,2,3,5,8,9] -> "1-3, 5, 8-9".
export function formatRanges(lines: number[]): string {
  const [first, ...rest] = lines.toSorted((a, b) => a - b);
  if (first === undefined) return "";

  const ranges: string[] = [];
  let start = first;
  let prev = first;

  for (const n of rest) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(", ");
}
