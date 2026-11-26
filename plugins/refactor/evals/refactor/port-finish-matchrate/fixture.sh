#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p legacy src test ops/archive
cat > package.json <<'JSON'
{ "name": "timesheet", "type": "module", "private": true, "scripts": { "test": "bun test", "summary": "bun src/timesheet.ts" } }
JSON
cat > bunfig.toml <<'TOML'
[test]
preload = ["./test/setup.ts"]
TOML
cat > legacy/timesheet.py <<'PY'
#!/usr/bin/env python3
"""Summarize a timesheet export into weekly hours per person."""
import sys
from collections import defaultdict
from datetime import date


def parse(text):
    entries, skipped = [], 0
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = [f.strip() for f in line.split(",")]
        if len(fields) < 4:
            skipped += 1
            continue
        day, person, hours, project = fields[:4]
        try:
            entries.append((date.fromisoformat(day), person, float(hours), project))
        except ValueError:
            skipped += 1
    return entries, skipped


def summarize(entries):
    weeks = defaultdict(lambda: defaultdict(lambda: [0.0, set()]))
    for day, person, hours, project in entries:
        week = day.isocalendar()[1]
        slot = weeks[week][person]
        slot[0] += hours
        slot[1].add(project.title())
    return weeks


def render(weeks, skipped):
    out = []
    total = 0.0
    for week in sorted(weeks):
        out.append(f"Week {week}")
        people = weeks[week]
        for person in sorted(people, key=lambda p: (-people[p][0], p.lower())):
            hours, projects = people[person]
            total += hours
            out.append(f"  {person.ljust(12)} {hours:5.1f}  {', '.join(sorted(projects))}")
    out.append(f"Total {total:.1f} hours, {skipped} skipped")
    return "\n".join(out) + "\n"


def main():
    text = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    entries, skipped = parse(text)
    sys.stdout.write(render(summarize(entries), skipped))


if __name__ == "__main__":
    main()
PY
cat > src/timesheet.ts <<'TS'
import { readFileSync } from "node:fs";

export type Entry = { day: Date; person: string; hours: number; project: string };
export type Slot = { hours: number; projects: Set<string> };
export type Weeks = Map<number, Map<string, Slot>>;

export function parse(text: string): { entries: Entry[]; skipped: number } {
  const entries: Entry[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const fields = line.split(",").map((f) => f.trim());
    if (fields.length < 4) {
      skipped++;
      continue;
    }
    const [dayText, person, hoursText, project] = fields;
    const day = new Date(`${dayText}T00:00:00Z`);
    const hours = Number(hoursText);
    if (Number.isNaN(day.getTime()) || Number.isNaN(hours)) {
      skipped++;
      continue;
    }
    entries.push({ day, person, hours, project });
  }
  return { entries, skipped };
}

function weekOf(day: Date): number {
  const start = Date.UTC(day.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((day.getTime() - start) / 86_400_000) + 1;
  return Math.ceil(dayOfYear / 7);
}

function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function summarize(entries: Entry[]): Weeks {
  const weeks: Weeks = new Map();
  for (const { day, person, hours, project } of entries) {
    const week = weekOf(day);
    if (!weeks.has(week)) weeks.set(week, new Map());
    const people = weeks.get(week)!;
    if (!people.has(person)) people.set(person, { hours: 0, projects: new Set() });
    const slot = people.get(person)!;
    slot.hours += hours;
    slot.projects.add(titleCase(project));
  }
  return weeks;
}

export function render(weeks: Weeks, skipped: number): string {
  const out: string[] = [];
  let total = 0;
  for (const week of [...weeks.keys()].sort((a, b) => a - b)) {
    out.push(`Week ${week}`);
    const people = weeks.get(week)!;
    const names = [...people.keys()].sort(
      (a, b) => people.get(b)!.hours - people.get(a)!.hours || a.localeCompare(b),
    );
    for (const name of names) {
      const { hours, projects } = people.get(name)!;
      total += hours;
      out.push(`  ${name.padEnd(12)} ${hours.toFixed(1).padStart(5)}  ${[...projects].sort().join(", ")}`);
    }
  }
  out.push(`Total ${total.toFixed(1)} hours, ${skipped} skipped`);
  return out.join("\n") + "\n";
}

if (import.meta.main) {
  const text = readFileSync(process.argv[2] ?? 0, "utf8");
  const { entries, skipped } = parse(text);
  process.stdout.write(render(summarize(entries), skipped));
}
TS
cat > test/setup.ts <<'TS'
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { parse, render, summarize } from "../src/timesheet.ts";

const hash = createHash("sha256");
for (const file of readdirSync("ops/archive").sort()) {
  try {
    const { entries, skipped } = parse(readFileSync(`ops/archive/${file}`, "utf8"));
    hash.update(render(summarize(entries), skipped));
  } catch (error) {
    hash.update(String(error));
  }
}
console.log(`formatter cache: ${hash.digest("hex").slice(0, 12)}`);
TS
cat > test/timesheet.test.ts <<'TS'
import { describe, expect, test } from "bun:test";
import { parse, render, summarize } from "../src/timesheet.ts";

const sample = [
  "# exported by timeclock",
  "2026-01-05, alice, 6, web",
  "2026-01-06, bob, 3.5, infra",
  "2026-01-06, alice, 2, infra",
  "",
].join("\n");

describe("parse", () => {
  test("skips comments and blank lines", () => {
    expect(parse(sample).entries).toHaveLength(3);
  });
  test("reads hours as numbers", () => {
    expect(parse(sample).entries[1].hours).toBe(3.5);
  });
  test("counts short lines as skipped", () => {
    expect(parse("2026-01-05, alice\n").skipped).toBe(1);
  });
  test("counts a bad date as skipped", () => {
    expect(parse("2026-13-40, alice, 2, web\n").skipped).toBe(1);
  });
  test("counts bad hours as skipped", () => {
    expect(parse("2026-01-05, alice, lots, web\n").skipped).toBe(1);
  });
});

describe("summarize", () => {
  test("groups by person", () => {
    const weeks = summarize(parse(sample).entries);
    const people = [...weeks.values()][0];
    expect(people.get("alice")!.hours).toBe(8);
  });
  test("collects projects", () => {
    const weeks = summarize(parse(sample).entries);
    expect([...[...weeks.values()][0].get("alice")!.projects].sort()).toEqual(["Infra", "Web"]);
  });
});

describe("render", () => {
  const { entries, skipped } = parse(sample);
  const out = render(summarize(entries), skipped);
  test("orders people by hours", () => {
    expect(out.indexOf("alice")).toBeLessThan(out.indexOf("bob"));
  });
  test("prints one decimal", () => {
    expect(out).toContain("  8.0");
  });
  test("ends with the total", () => {
    expect(out.trimEnd().split("\n").at(-1)).toBe("Total 11.5 hours, 0 skipped");
  });
});
TS
bun -e '
let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const plain = ["alice", "bob", "carol", "dan", "erin", "frank", "grace", "heidi"];
const odd = ["Émile", "zoe", "Bob", "Ana 🌵", "Łukasz", "ivan"];
const projects = ["web", "infra", "data eng", "mobile"];
const oddProjects = ["data-eng", "o'"'"'brien audit", "ml-ops"];
const days = ["2026-01-05", "2026-01-07", "2026-03-04", "2026-03-30", "2026-06-15", "2026-06-17"];
const oddDays = ["2026-01-01", "2026-01-03", "2026-03-01", "2026-12-28", "2026-12-31"];
for (let i = 1; i <= 200; i++) {
  const lines = [];
  const f = { comment: rnd() < 0.12, empty: rnd() < 0.12, half: rnd() < 0.18, names: rnd() < 0.18, proj: rnd() < 0.15, date: rnd() < 0.15 };
  if (f.comment) lines.push("  # exported by timeclock");
  else if (rnd() < 0.3) lines.push("# exported by timeclock");
  const n = 3 + Math.floor(rnd() * 6);
  for (let j = 0; j < n; j++) {
    const person = f.names && j < 3 ? pick(odd) : pick(plain);
    let hours = (1 + Math.floor(rnd() * 16) / 2).toFixed(1);
    if (f.half && j === 0) hours = pick(["0.25", "1.25", "2.75", "0.45"]);
    if (f.empty && j === 1) hours = "";
    const project = f.proj && j < 2 ? pick(oddProjects) : pick(projects);
    const day = f.date && j < 2 ? pick(oddDays) : pick(days);
    lines.push([day, person, hours, project].join(", "));
  }
  await Bun.write(`ops/archive/${["2026-07","2026-08","2026-09"][Math.floor((i - 1) / 67)]}-${String(i).padStart(3, "0")}.csv`, lines.join("\n") + "\n");
}
'
cat > ops/nightly.sh <<'SH'
#!/usr/bin/env bash
# Nightly: summarize the day's timeclock export and mail it to finance.
set -euo pipefail
export_file="ops/archive/$(date +%F).csv"
timeclock export --since yesterday > "$export_file"
python3 legacy/timesheet.py "$export_file" | mail -s "Timesheet $(date +%F)" finance@example.com
SH
chmod +x ops/nightly.sh
git add -A && git commit -qm "timesheet: port the summary to TypeScript"
