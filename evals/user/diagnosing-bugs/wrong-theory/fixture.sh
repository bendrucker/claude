#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src data
cat > package.json <<'JSON'
{ "name": "metrics", "type": "module", "scripts": { "report": "bun src/report.ts data/visits.csv 2026-09-07" } }
JSON
cat > src/load.ts <<'TS'
export interface Visit {
  day: string;
  count: number;
}

export async function loadVisits(path: string): Promise<Visit[]> {
  const text = await Bun.file(path).text();
  const [, ...rows] = text.trim().split("\n");
  return rows.map((line) => {
    const [day, count] = line.split(",");
    return { day: day!, count: Number(count) };
  });
}
TS
cat > src/range.ts <<'TS'
const DAY = 24 * 60 * 60 * 1000;

export function weekOf(start: string): { start: number; end: number } {
  const from = Date.parse(`${start}T00:00:00Z`);
  return { start: from, end: from + 7 * DAY };
}

export function inRange(day: string, range: { start: number; end: number }): boolean {
  const t = Date.parse(`${day}T00:00:00Z`);
  return t >= range.start && t < range.end;
}
TS
cat > src/report.ts <<'TS'
import { loadVisits } from "./load";
import { inRange, weekOf } from "./range";

const [path = "data/visits.csv", start = "2026-09-07"] = process.argv.slice(2);
const range = weekOf(start);
const days = (await loadVisits(path)).filter((v) => inRange(v.day, range));
for (const v of days) console.log(`${v.day}  ${v.count}`);
console.log(`${days.length} days, ${days.reduce((n, v) => n + v.count, 0)} visits`);
TS
cat > data/visits.csv <<'CSV'
2026-09-07,412
2026-09-08,388
2026-09-09,405
2026-09-10,397
2026-09-11,421
2026-09-12,190
2026-09-13,176
2026-09-14,402
CSV
git add -A && git commit -qm "metrics: weekly visit report"
