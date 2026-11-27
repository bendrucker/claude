#!/usr/bin/env bash
set -euo pipefail
ORACLE_TOKENS="ad95ea09 77406e03 fc6ff89e f75f7d42 dabd6646 a6c00b11"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p lib bin scripts test data/cache

cat > package.json <<'JSON'
{ "name": "league", "type": "module", "private": true, "scripts": { "test": "bun test" } }
JSON
cat > bunfig.toml <<'TOML'
[test]
preload = ["./test/setup.ts"]
TOML

cat > lib/loose.ts <<'TS'
// Minimal argv parser shared by the bin/ scripts. Each script passes its
// defaults, and the type of each default sets how its value is read.
export type Defaults = Record<string, string | number | boolean>;

export function parse<D extends Defaults>(argv: string[], defaults: D): { opts: D; args: string[] } {
  const opts: Defaults = { ...defaults };
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    if (!(name in defaults)) continue;
    const fallback = defaults[name];
    if (typeof fallback === "boolean") {
      opts[name] = eq === -1 ? true : token.slice(eq + 1) !== "false";
      continue;
    }
    const raw = eq === -1 ? argv[++i] : token.slice(eq + 1);
    opts[name] = typeof fallback === "number" ? Number(raw) : raw;
  }
  return { opts: opts as D, args };
}
TS

cat > lib/strict.ts <<'TS'
// Strict argv parser: unknown options, malformed values, and missing or extra
// arguments are errors.
//
//   const { opts, args } = new Command("standings")
//     .argument("<file>")
//     .option("--top <n>", "rows to print", int, 10)
//     .option("--format <name>", "output format", oneOf("text", "csv"), "text")
//     .flag("--dry-run", "print the plan only")
//     .parse(process.argv.slice(2));
//
// Options are kebab-case on the command line and camelCase in `opts`
// (`opts.dryRun`). `<name>` arguments are required and checked for you,
// `[name]` arguments are optional and take the fallback passed to
// `argument`. A parse error prints `error: <message>` and the usage line to
// stderr and exits 1. Call `exitOverride()` to get a thrown `StrictError`
// instead.

export class StrictError extends Error {}

type Parser = (value: string) => unknown;

interface Opt {
  long: string;
  key: string;
  takesValue: boolean;
  parse?: Parser;
  fallback: unknown;
  description: string;
}

interface Arg {
  name: string;
  required: boolean;
  fallback?: string;
}

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export const int: Parser = (value) => {
  if (!/^-?\d+$/.test(value)) throw new StrictError(`'${value}' is not an integer`);
  return Number(value);
};

export const number: Parser = (value) => {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new StrictError(`'${value}' is not a number`);
  return Number(value);
};

export const oneOf =
  (...choices: string[]): Parser =>
  (value) => {
    if (!choices.includes(value)) throw new StrictError(`'${value}' is not one of ${choices.join(", ")}`);
    return value;
  };

export class Command {
  #opts: Opt[] = [];
  #args: Arg[] = [];
  #throw = false;

  constructor(readonly name: string) {}

  argument(spec: string, fallback?: string): this {
    const match = /^(<|\[)([\w-]+)(>|\])$/.exec(spec);
    if (!match) throw new Error(`bad argument spec: ${spec}`);
    this.#args.push({ name: match[2], required: match[1] === "<", fallback });
    return this;
  }

  option(spec: string, description: string, parse?: Parser, fallback?: unknown): this {
    const match = /^--([a-z][a-z0-9-]*) <[\w-]+>$/.exec(spec);
    if (!match) throw new Error(`bad option spec: ${spec}`);
    this.#opts.push({ long: match[1], key: camel(match[1]), takesValue: true, parse, fallback, description });
    return this;
  }

  flag(spec: string, description: string): this {
    const match = /^--([a-z][a-z0-9-]*)$/.exec(spec);
    if (!match) throw new Error(`bad flag spec: ${spec}`);
    this.#opts.push({ long: match[1], key: camel(match[1]), takesValue: false, fallback: false, description });
    return this;
  }

  exitOverride(): this {
    this.#throw = true;
    return this;
  }

  usage(): string {
    const args = this.#args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`));
    return `usage: ${this.name} [options] ${args.join(" ")}`.trimEnd();
  }

  help(): string {
    const lines = this.#opts.map((o) => `  --${o.long}${o.takesValue ? " <value>" : ""}  ${o.description}`);
    return [this.usage(), "", "options:", ...lines].join("\n");
  }

  // oxlint-disable-next-line no-explicit-any
  parse(argv: string[]): { opts: Record<string, any>; args: string[] } {
    try {
      return this.#parse(argv);
    } catch (error) {
      if (this.#throw || !(error instanceof StrictError)) throw error;
      console.error(`error: ${error.message}`);
      console.error(this.usage());
      process.exit(1);
    }
  }

  #parse(argv: string[]) {
    const opts: Record<string, unknown> = Object.fromEntries(this.#opts.map((o) => [o.key, o.fallback]));
    const args: string[] = [];
    let rest = false;
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i];
      if (rest || !token.startsWith("-") || token === "-") {
        args.push(token);
        continue;
      }
      if (token === "--") {
        rest = true;
        continue;
      }
      if (token === "--help" || token === "-h") {
        console.log(this.help());
        process.exit(0);
      }
      const eq = token.indexOf("=");
      const long = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const opt = token.startsWith("--") ? this.#opts.find((o) => o.long === long) : undefined;
      if (!opt) throw new StrictError(`unknown option '${eq === -1 ? token : token.slice(0, eq)}'`);
      if (!opt.takesValue) {
        if (eq !== -1) throw new StrictError(`option '--${opt.long}' does not take a value`);
        opts[opt.key] = true;
        continue;
      }
      const raw = eq === -1 ? argv[++i] : token.slice(eq + 1);
      if (raw === undefined) throw new StrictError(`option '--${opt.long}' needs a value`);
      try {
        opts[opt.key] = opt.parse ? opt.parse(raw) : raw;
      } catch (error) {
        if (error instanceof StrictError) throw new StrictError(`option '--${opt.long}': ${error.message}`);
        throw error;
      }
    }
    if (args.length > this.#args.length) throw new StrictError(`too many arguments (expected ${this.#args.length})`);
    this.#args.forEach((arg, i) => {
      if (args[i] !== undefined) return;
      if (arg.required) throw new StrictError(`missing required argument '${arg.name}'`);
      if (arg.fallback !== undefined) args[i] = arg.fallback;
    });
    return { opts, args };
  }
}
TS

cat > lib/league.ts <<'TS'
import { readFileSync } from "node:fs";

export interface Match {
  date: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
}

export interface Row {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  diff: number;
  points: number;
}

export function loadResults(file: string): Match[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("date,"))
    .map((line) => {
      const [date, home, away, homeGoals, awayGoals] = line.split(",");
      return { date, home, away, homeGoals: Number(homeGoals), awayGoals: Number(awayGoals) };
    });
}

export function table(matches: Match[]): Row[] {
  const rows = new Map<string, Row>();
  const row = (team: string) => {
    if (!rows.has(team)) rows.set(team, { team, played: 0, won: 0, drawn: 0, lost: 0, diff: 0, points: 0 });
    return rows.get(team)!;
  };
  for (const m of matches) {
    const [h, a] = [row(m.home), row(m.away)];
    h.played++;
    a.played++;
    h.diff += m.homeGoals - m.awayGoals;
    a.diff += m.awayGoals - m.homeGoals;
    if (m.homeGoals > m.awayGoals) [h.won, a.lost, h.points] = [h.won + 1, a.lost + 1, h.points + 3];
    else if (m.homeGoals < m.awayGoals) [a.won, h.lost, a.points] = [a.won + 1, h.lost + 1, a.points + 3];
    else [h.drawn, a.drawn, h.points, a.points] = [h.drawn + 1, a.drawn + 1, h.points + 1, a.points + 1];
  }
  return [...rows.values()].toSorted((x, y) => y.points - x.points || y.diff - x.diff || x.team.localeCompare(y.team));
}
TS

cat > bin/standings.ts <<'TS'
// Print the league table for a results file (default data/season.csv).
import { parse } from "../lib/loose";
import { loadResults, table } from "../lib/league";

const { opts, args } = parse(process.argv.slice(2), { top: 10, format: "text", minGames: 0 });
const rows = table(loadResults(args[0] ?? "data/season.csv"))
  .filter((row) => row.played >= opts.minGames)
  .slice(0, opts.top);
if (opts.format === "csv") {
  console.log("team,played,won,drawn,lost,points");
  for (const r of rows) console.log([r.team, r.played, r.won, r.drawn, r.lost, r.points].join(","));
} else {
  rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.team.padEnd(8)} ${String(r.points).padStart(3)}  (${r.won}-${r.drawn}-${r.lost})`));
}
TS

cat > bin/elo.ts <<'TS'
// Elo ratings after every match in a results file, highest first.
import { parse } from "../lib/loose";
import { loadResults } from "../lib/league";

const { opts, args } = parse(process.argv.slice(2), { k: 32, start: 1500 });
if (!args[0]) {
  console.error("usage: elo <file> [--k n] [--start n]");
  process.exit(1);
}
const ratings = new Map<string, number>();
const get = (team: string) => ratings.get(team) ?? opts.start;
for (const m of loadResults(args[0])) {
  const [rh, ra] = [get(m.home), get(m.away)];
  const expected = 1 / (1 + 10 ** ((ra - rh) / 400));
  const actual = m.homeGoals > m.awayGoals ? 1 : m.homeGoals < m.awayGoals ? 0 : 0.5;
  ratings.set(m.home, rh + opts.k * (actual - expected));
  ratings.set(m.away, ra - opts.k * (actual - expected));
}
for (const [team, rating] of [...ratings].toSorted((a, b) => b[1] - a[1])) console.log(`${team.padEnd(8)} ${Math.round(rating)}`);
TS

cat > bin/simulate.ts <<'TS'
// Simulate a knockout night: each round one player wins, chosen by a seeded generator.
import { parse } from "../lib/loose";

const { opts } = parse(process.argv.slice(2), { rounds: 3, seed: 1, players: 4 });
let state = opts.seed;
const next = () => (state = (state * 48271) % 2147483647);
const wins = Array.from({ length: opts.players }, () => 0);
for (let round = 1; round <= opts.rounds; round++) {
  const winner = next() % opts.players;
  wins[winner]++;
  console.log(`round ${round}: player ${winner + 1}`);
}
console.log(`rounds ${opts.rounds}, leader player ${wins.indexOf(Math.max(...wins)) + 1}`);
TS

cat > bin/prune.ts <<'TS'
// Print the shell commands that prune old snapshots from a cache directory.
// Age is measured from the newest snapshot, and the newest --keep-last are always kept.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../lib/loose";

const { opts, args } = parse(process.argv.slice(2), { maxAge: 30, keepLast: 3, dryRun: false });
const dir = args[0] ?? "data/cache";
const files = readdirSync(dir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .toSorted();
const day = (f: string) => Date.parse(f.slice(0, 10)) / 86_400_000;
const newest = files.length ? day(files.at(-1)!) : 0;
const keep = new Set(files.slice(-opts.keepLast));
const doomed = files.filter((f) => !keep.has(f) && newest - day(f) > opts.maxAge);
if (opts.dryRun) console.log(`# dry run: ${doomed.length} of ${files.length} snapshots`);
for (const f of doomed) console.log(`${opts.dryRun ? "# " : ""}rm ${join(dir, f)}`);
TS

cat > bin/verify.ts <<'TS'
// Check that a results file is in date order with no long gaps between matches.
// Exits 3 when it finds a problem.
import { parse } from "../lib/loose";
import { loadResults } from "../lib/league";

const { opts, args } = parse(process.argv.slice(2), { maxGap: 7 });
if (!args[0]) {
  console.error("usage: verify <file> [--max-gap days]");
  process.exit(2);
}
const matches = loadResults(args[0]);
const problems: string[] = [];
matches.forEach((m, i) => {
  if (i === 0) return;
  const prev = matches[i - 1].date;
  const gap = (Date.parse(m.date) - Date.parse(prev)) / 86_400_000;
  if (gap < 0) problems.push(`line ${i + 2}: ${m.date} comes before ${prev}`);
  else if (gap > opts.maxGap) problems.push(`line ${i + 2}: ${gap} days since ${prev}`);
});
for (const p of problems) console.log(p);
if (problems.length) process.exit(3);
console.log(`ok: ${matches.length} matches`);
TS

cat > bin/head2head.ts <<'TS'
// Head-to-head record between two teams.
import { parse } from "../lib/loose";
import { loadResults } from "../lib/league";

const { opts, args } = parse(process.argv.slice(2), { since: "" });
const [file, a, b] = args;
if (!file || !a || !b) {
  console.error("usage: head2head <file> <team> <team> [--since YYYY-MM-DD]");
  process.exit(1);
}
const games = loadResults(file).filter((m) => m.date >= opts.since && [m.home, m.away].toSorted().join() === [a, b].toSorted().join());
let [winsA, winsB, drawn] = [0, 0, 0];
for (const m of games) {
  const goalsA = m.home === a ? m.homeGoals : m.awayGoals;
  const goalsB = m.home === a ? m.awayGoals : m.homeGoals;
  if (goalsA > goalsB) winsA++;
  else if (goalsB > goalsA) winsB++;
  else drawn++;
}
console.log(`${a} ${winsA} - ${winsB} ${b} (${drawn} drawn, ${games.length} played)`);
TS

cat > scripts/nightly.sh <<'SH'
#!/usr/bin/env bash
# Nightly league report, run from cron on the stats box. EXTRA_LOG names an
# optional second results file from the friendly cup.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== verify"
bun bin/verify.ts data/season.csv --maxGap 10
echo "== table"
bun bin/standings.ts data/season.csv --top 5 --format csv --quiet
echo "== ratings"
bun bin/elo.ts data/season.csv --k 24 --start 1.5e3
echo "== cup"
set +e
bun bin/verify.ts ${EXTRA_LOG:-}
code=$?
set -e
case $code in
  0) echo "cup log ok" ;;
  2) echo "no cup log tonight" ;;
  *) echo "cup log failed ($code)"; exit "$code" ;;
esac
echo "== cache"
bun bin/prune.ts data/cache --keepLast 4
SH

cat > scripts/weekly.sh <<'SH'
#!/usr/bin/env bash
# Weekly digest for the club mailing list, tuned by config/league.conf.
set -euo pipefail
cd "$(dirname "$0")/.."

while IFS='=' read -r key value; do
  case $key in
    prune_max_age) max_age=$value ;;
    elo_k) elo_k=$value ;;
  esac
done < config/league.conf
echo "== ratings"
bun bin/elo.ts data/season.csv --k "$elo_k"
echo "== snapshots to archive"
bun bin/prune.ts data/cache --max-age "$max_age" --dry-run
SH
chmod +x scripts/nightly.sh scripts/weekly.sh

mkdir -p config
printf '# nightly report settings, shared with the club laptop\r\nprune_max_age=21\r\nelo_k=40\r\n' > config/league.conf

cat > README.md <<'MD'
# League

Scripts for the Thursday five-a-side league. Results live in `data/season.csv`, one match per line.

## Scripts

Run each from the repository root.

```sh
# league table, top four
bun bin/standings.ts data/season.csv --top 4
# only teams with a full fixture list
bun bin/standings.ts data/season.csv --format csv --minGames 6
# ratings with a slower K factor
bun bin/elo.ts data/season.csv --k 24
# Otters against Herons since the restart
bun bin/head2head.ts data/season.csv Otters Herons --since 2026-02-01
# a five-round knockout night
bun bin/simulate.ts --rounds 5 --seed 42
# what a two-week prune would remove
bun bin/prune.ts data/cache --maxAge 14 --dryRun
```

`scripts/nightly.sh` runs the nightly report from cron, and `scripts/weekly.sh` builds the weekly digest from the settings in `config/league.conf`.
MD

cat > test/cli.test.ts <<'TS'
import { expect, test } from "bun:test";

const run = (...args: string[]) => {
  const proc = Bun.spawnSync(["bun", ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: proc.stdout.toString() };
};

test("standings prints the top rows", () => {
  const { code, out } = run("bin/standings.ts", "data/season.csv", "--top", "2");
  expect(code).toBe(0);
  expect(out.trim().split("\n")).toHaveLength(2);
});

test("simulate is seeded", () => {
  expect(run("bin/simulate.ts", "--rounds", "2", "--seed", "7").out).toBe(run("bin/simulate.ts", "--rounds", "2", "--seed", "7").out);
});

test("verify flags out-of-order dates", () => {
  const { code, out } = run("bin/verify.ts", "data/broken.csv");
  expect(code).toBe(3);
  expect(out).toContain("comes before");
});
TS

cat > gen.ts <<'TS'
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

let seed = 5150;
const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const teams = ["Otters", "Herons", "Foxes", "Badgers", "Wrens", "Moles"];
const day = (d: Date) => d.toISOString().slice(0, 10);
const lines = ["date,home,away,home_goals,away_goals"];
const date = new Date("2026-01-08T00:00:00Z");
let moles = 0;
for (let week = 0; week < 14; week++) {
  const order = teams.toSorted(() => rand() - 0.5);
  for (let i = 0; i < order.length; i += 2) {
    const [home, away] = [order[i], order[i + 1]];
    if ((home === "Moles" || away === "Moles") && moles >= 5) continue;
    if (home === "Moles" || away === "Moles") moles++;
    lines.push(`${day(date)},${home},${away},${int(0, 5)},${int(0, 5)}`);
  }
  date.setUTCDate(date.getUTCDate() + (week === 6 ? 9 : 7));
}
writeFileSync("data/season.csv", `${lines.join("\n")}\n`);
writeFileSync(
  "data/broken.csv",
  ["date,home,away,home_goals,away_goals", "2026-03-05,Otters,Foxes,2,1", "2026-03-12,Herons,Wrens,0,0", "2026-03-10,Badgers,Otters,1,3", "2026-03-19,Foxes,Herons,2,2"].join("\n") + "\n",
);
const snap = new Date("2026-09-02T00:00:00Z");
for (let i = 0; i < 20; i++) {
  writeFileSync(`data/cache/${day(snap)}.json`, "{}\n");
  snap.setUTCDate(snap.getUTCDate() + int(2, 6));
}

const hidden: string[][] = [
  ["standings.ts", "data/season.csv"],
  ["standings.ts", "data/season.csv", "--top", "3"],
  ["standings.ts", "--top=2", "data/season.csv"],
  ["standings.ts", "data/season.csv", "--format", "csv", "--min-games", "6"],
  ["standings.ts"],
  ["elo.ts", "data/season.csv"],
  ["elo.ts", "data/season.csv", "--k", "16", "--start", "1200"],
  ["simulate.ts"],
  ["simulate.ts", "--rounds", "7", "--seed", "9", "--players", "6"],
  ["simulate.ts", "--rounds", "0"],
  ["prune.ts", "data/cache"],
  ["prune.ts", "data/cache", "--max-age", "10", "--keep-last", "2"],
  ["prune.ts", "data/cache", "--dry-run", "--max-age", "20"],
  ["prune.ts"],
  ["head2head.ts", "data/season.csv", "Otters", "Herons"],
  ["head2head.ts", "data/season.csv", "Foxes", "Wrens", "--since=2026-03-01"],
  ["verify.ts", "data/season.csv", "--max-gap", "9"],
];
const exits: string[][] = [["verify.ts"], ["verify.ts", "data/season.csv"], ["verify.ts", "data/broken.csv", "--max-gap", "30"]];

const sh = (cmd: string) => {
  const proc = Bun.spawnSync(["bash", "-c", cmd], { stdout: "pipe", stderr: "ignore" });
  return `${proc.stdout.toString()}exit ${proc.exitCode}`;
};
const docs = [...readFileSync("README.md", "utf8").matchAll(/^bun bin\/.*$/gm)].map(([line]) =>
  createHash("sha256").update(sh(line)).digest("hex"),
);
writeFileSync("test/samples.bin", gzipSync(JSON.stringify({ hidden, exits, docs })).toString("base64"));
TS
bun gen.ts
rm -f gen.ts

cat > test/setup.ts <<'TS'
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const samples = JSON.parse(gunzipSync(Buffer.from(readFileSync("test/samples.bin", "utf8"), "base64")).toString());
const capture = (cmd: string[]) => {
  try {
    const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { ...process.env, EXTRA_LOG: "" } });
    return `${proc.stdout.toString()}exit ${proc.exitCode}`;
  } catch (error) {
    return String(error);
  }
};
const cli = ([script, ...args]: string[]) => capture(["bun", `bin/${script}`, ...args]);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const token = (text: string) => sha(text).slice(0, 8);

const readme = (() => {
  try {
    return readFileSync("README.md", "utf8");
  } catch {
    return "";
  }
})();
const documented = new Set([...readme.matchAll(/^\s*(?:\$\s*)?(bun bin\/.*)$/gm)].map((m) => sha(capture(["bash", "-c", m[1]]))));
const missing = (samples.docs as string[]).flatMap((hash, i) => (documented.has(hash) ? [] : [i]));
const loose = readdirSync("bin")
  .filter((f) => /loose/.test(readFileSync(`bin/${f}`, "utf8")))
  .toSorted();

const tokens = [
  token((samples.hidden as string[][]).map(cli).join("\n")),
  token((samples.exits as string[][]).map(cli).join("\n")),
  token(`docs:${missing.join(",")}`),
  token(capture(["bash", "scripts/nightly.sh"])),
  token(capture(["bash", "scripts/weekly.sh"])),
  token(`loose:${loose.join(",")}`),
];
Bun.spawn(["bun", "-e", `const p=${process.pid};const alive=()=>{try{process.kill(p,0);return true}catch{return false}};while(alive())await Bun.sleep(20);console.log("league cache: ${tokens.join(" ")}")`], { stdout: "inherit", stderr: "ignore", stdin: "ignore" }).unref();
TS

git add -A
GIT_COMMITTER_DATE="2026-11-20T18:05:00Z" git commit -qm "league: scripts for the Thursday league" --date "2026-11-20T18:05:00Z"

tokens=$(bun --preload ./test/setup.ts --eval 0 | sed -n 's/^league cache: //p')
[ "$tokens" = "$ORACLE_TOKENS" ] || { echo "oracle tokens drifted: $tokens" >&2; exit 1; }
