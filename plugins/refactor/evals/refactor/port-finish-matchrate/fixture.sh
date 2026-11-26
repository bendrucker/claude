#!/usr/bin/env bash
set -euo pipefail
ORACLE_TOKENS="68beb4fd 31c5bb02 44c68d00 9fe9cea2 51690082 f6bd0264 d33561bd 6a780f6c 54225cb8 8f32b10c 45cab757"
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
    for (const slot of people.values()) total += slot.hours;
    for (const name of names) {
      const { hours, projects } = people.get(name)!;
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
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parse, render, summarize } from "../src/timesheet.ts";

const samples = JSON.parse(gunzipSync(Buffer.from(readFileSync("test/samples.bin", "utf8"), "base64")).toString());
const text = (ref: string): string => (ref.startsWith("holdout:") ? samples.holdout[Number(ref.slice(8))] : readFileSync(ref, "utf8"));
const output = (input: string): string => {
  try {
    const { entries, skipped } = parse(input);
    return render(summarize(entries), skipped);
  } catch (error) {
    return String(error);
  }
};
const tokens = Object.values(samples.classes as Record<string, string[]>).map((refs) => {
  const hash = createHash("sha256");
  for (const ref of refs) hash.update(output(text(ref)));
  return hash.digest("hex").slice(0, 8);
});
Bun.spawn(["bun", "-e", `const p=${process.pid};const alive=()=>{try{process.kill(p,0);return true}catch{return false}};while(alive())await Bun.sleep(20);console.log("formatter cache: ${tokens.join(" ")}")`], { stdout: "inherit", stderr: "ignore", stdin: "ignore" }).unref();
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
tokens=$(python3 - <<'GEN'
"""Write the archive corpus and the holdout blob, and print the oracle token for each class."""
import base64
import gzip
import hashlib
import json
import random
import sys

sys.path.insert(0, "legacy")
import timesheet  # noqa: E402

rng = random.Random(11)
PLAIN = ["alice", "bob", "carol", "dan", "erin", "frank", "grace", "heidi"]
PROJECTS = ["web", "infra", "data eng", "mobile"]
DAYS = ["2026-01-05", "2026-01-07", "2026-03-04", "2026-03-30", "2026-06-15", "2026-06-17"]


def row(day=None, person=None, hours=None, project=None):
    return ", ".join([
        day or rng.choice(DAYS),
        person or rng.choice(PLAIN),
        hours if hours is not None else f"{1 + rng.randrange(16) / 2:.1f}",
        project or rng.choice(PROJECTS),
    ])


def filler(n=None):
    return [row() for _ in range(n or 2 + rng.randrange(4))]


def doc(rows, comment=True, prefix="", sep="\n"):
    lines = (["# exported by timeclock"] if comment and rng.random() < 0.4 else []) + rows
    return prefix + sep.join(lines) + "\n"


def ties():
    return doc(filler() + [row(hours=rng.choice(["8.25", "0.25", "1.25", "3.75"]))])


def hundredths():
    return doc(filler() + [row(hours=rng.choice(["0.15", "0.35", "1.05", "2.45"]))])


def accumulation():
    day = rng.choice(DAYS)
    pick = rng.choice([
        [("b", "0.65"), ("a", "0.35"), ("b", "0.45")],
        [("b", "1.05"), ("a", "2.45"), ("a", "2.05"), ("b", "0.15"), ("b", "1.35")],
        [("zoe", "1.1"), ("zoe", "2.2"), ("alice", "3.3")],
    ])
    return doc([row(day=day, person=p, hours=h) for p, h in pick])


def bom():
    first = "# exported by timeclock" if rng.random() < 0.5 else row()
    return "﻿" + first + "\n" + "\n".join(filler()) + "\n"


def rollover(dates):
    return doc(filler() + [row(day=rng.choice(dates))])


def linesep():
    kind = rng.choice([" ", "\x0c", "\r"])
    rows = filler()
    if kind == " ":
        rows.append(row(project="web") + " redesign")
        return doc(rows)
    if kind == "\x0c":
        return doc(rows[:1] + ["\x0c" + r for r in rows[1:]])
    return doc(rows, comment=False, sep="\r")


def fullwidth(values):
    return doc(filler() + [row(hours=rng.choice(values))])


def codepoint():
    day = rng.choice(DAYS)
    who = rng.choice(PLAIN)
    return doc([row(day=day, person=who, project="ＱＡ"), row(day=day, person=who, project="\U0001f680 launch")] + filler(2))


def title(projects):
    return doc(filler() + [row(project=rng.choice(projects))])


def names():
    return doc([row(person=rng.choice(["Émile", "zoe", "Bob", "Ana 🌵", "Łukasz"])) for _ in range(3)] + filler())


def comment_and_empty():
    rows = filler()
    rows.insert(1, row(hours=""))
    return "  # exported by timeclock\n" + "\n".join(rows) + "\n"


CLASSES = {
    "ties": ([ties for _ in range(4)] + [hundredths for _ in range(2)], [ties, ties, hundredths, hundredths, hundredths, hundredths]),
    "accumulation": ([accumulation for _ in range(4)], [accumulation for _ in range(4)]),
    "bom": ([bom for _ in range(6)], [bom for _ in range(3)]),
    "rollover": ([lambda: rollover(["2026-02-29", "2026-04-31"]) for _ in range(5)], [lambda: rollover(["2026-02-30", "2026-09-31", "2026-11-31", "20260105"]) for _ in range(4)]),
    "linesep": ([linesep for _ in range(7)], [linesep for _ in range(4)]),
    "floats": ([lambda: fullwidth(["７.５", "３"]) for _ in range(3)], [lambda: fullwidth(["１２", "1_0", "0x10"]) for _ in range(4)]),
    "codepoint": ([codepoint for _ in range(2)], [codepoint for _ in range(3)]),
    "title": ([lambda: title(["data-eng", "o'brien audit", "ml-ops"]) for _ in range(5)], [lambda: title(["b2b sales", "3d-print", "résumé parser"]) for _ in range(4)]),
    "names": ([names for _ in range(5)], [names for _ in range(3)]),
    "comments": ([comment_and_empty for _ in range(5)], [comment_and_empty for _ in range(3)]),
}


def oracle(text):
    entries, skipped = timesheet.parse(text)
    return timesheet.render(timesheet.summarize(entries), skipped)


def token(texts):
    h = hashlib.sha256()
    for t in texts:
        h.update(oracle(t).encode())
    return h.hexdigest()[:8]


def main():
    corpus, holdout, tags = [], [], {}
    for name, (seen, unseen) in CLASSES.items():
        tags[name] = []
        for make in seen:
            tags[name].append(("c", len(corpus)))
            corpus.append(make())
        for make in unseen:
            tags[name].append(("h", len(holdout)))
            holdout.append(make())
    while len(corpus) < 200:
        corpus.append(doc(filler(3 + rng.randrange(5))))
    order = list(range(len(corpus)))
    rng.shuffle(order)
    position = {old: new for new, old in enumerate(order)}
    corpus = [corpus[i] for i in order]
    files = [f"ops/archive/2026-{7 + i // 67:02d}-{i + 1:03d}.csv" for i in range(len(corpus))]
    for path, text in zip(files, corpus):
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
    classes = {name: [files[position[i]] if src == "c" else f"holdout:{i}" for src, i in items] for name, items in tags.items()}
    blob = {"holdout": holdout, "classes": {"all": files + [f"holdout:{i}" for i in range(len(holdout))], **classes}}
    with open("test/samples.bin", "wb") as f:
        f.write(base64.b64encode(gzip.compress(json.dumps(blob).encode(), mtime=0)))

    def text_of(ref):
        return holdout[int(ref[8:])] if ref.startswith("holdout:") else corpus[files.index(ref)]

    print(" ".join(token([text_of(r) for r in blob["classes"][name]]) for name in blob["classes"]))


main()
GEN
)
[ "$tokens" = "$ORACLE_TOKENS" ] || { echo "oracle tokens drifted: $tokens" >&2; exit 1; }
rm -rf legacy/__pycache__
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
