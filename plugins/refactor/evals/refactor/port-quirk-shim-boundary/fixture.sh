#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p lib bin scripts test data

cat > package.json <<'JSON'
{ "name": "cells", "type": "module", "private": true, "scripts": { "test": "bun test" } }
JSON

cat > lib/loose.ts <<'TS'
// Hand-rolled argv parser. `spec` maps each option name to its short letter, or to "" for none.
// An option takes its value from `--name=value`, `-n=value`, or the next argument.
export function parse(argv: string[], spec: Record<string, string>): { opts: Record<string, string>; args: string[] } {
  const short = new Map(Object.entries(spec).filter(([, s]) => s).map(([name, s]) => [s, name]));
  const opts: Record<string, string> = {};
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const match = /^(--([a-z][a-z-]*)|-([a-z]))(?:=(.*))?$/s.exec(token);
    if (!match) {
      if (token.startsWith("-") && token !== "-") fail(`unknown option ${token}`);
      args.push(token);
      continue;
    }
    const name = match[2] ?? short.get(match[3]);
    if (!name || !(name in spec)) fail(`unknown option ${match[1]}`);
    const value = match[4] ?? argv[++i];
    if (value === undefined) fail(`option ${match[1]} needs a value`);
    opts[name] = value;
  }
  return { opts, args };
}

function fail(message: string): never {
  console.error(`cell: ${message}`);
  process.exit(2);
}
TS

cat > lib/strict.ts <<'TS'
// Strict argv parser with short aliases, modeled on commander.
//
//   const { opts, args } = new Command("cell set")
//     .argument("<ref>")
//     .option("-v, --value <text>", "cell contents")
//     .parse(argv);
//
// Long options take `--name value` or `--name=value`. Short options take `-n value` or an
// attached value, `-nvalue`, where everything after the letter is the value. Unknown options,
// missing values, and missing or extra arguments print `error: <message>` and exit 2.
export class StrictError extends Error {}

interface Opt {
  short?: string;
  long: string;
  key: string;
  fallback?: string;
}

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export class Command {
  #opts: Opt[] = [];
  #args: { name: string; required: boolean }[] = [];

  constructor(readonly name: string) {}

  argument(spec: string): this {
    this.#args.push({ name: spec.slice(1, -1), required: spec.startsWith("<") });
    return this;
  }

  option(spec: string, _description: string, fallback?: string): this {
    const match = /^(?:-([a-z]), )?--([a-z][a-z0-9-]*) <[\w-]+>$/.exec(spec);
    if (!match) throw new Error(`bad option spec: ${spec}`);
    this.#opts.push({ short: match[1], long: match[2], key: camel(match[2]), fallback });
    return this;
  }

  parse(argv: string[]): { opts: Record<string, string | undefined>; args: string[] } {
    try {
      return this.#parse(argv);
    } catch (error) {
      if (!(error instanceof StrictError)) throw error;
      console.error(`error: ${error.message}`);
      process.exit(2);
    }
  }

  #parse(argv: string[]) {
    const opts: Record<string, string | undefined> = Object.fromEntries(this.#opts.map((o) => [o.key, o.fallback]));
    const args: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i];
      if (token === "--") {
        args.push(...argv.slice(i + 1));
        break;
      }
      if (!token.startsWith("-") || token === "-") {
        args.push(token);
        continue;
      }
      let opt: Opt | undefined;
      let value: string | undefined;
      if (token.startsWith("--")) {
        const eq = token.indexOf("=");
        const long = eq === -1 ? token.slice(2) : token.slice(2, eq);
        opt = this.#opts.find((o) => o.long === long);
        if (eq !== -1) value = token.slice(eq + 1);
      } else {
        opt = this.#opts.find((o) => o.short === token[1]);
        if (token.length > 2) value = token.slice(2);
      }
      if (!opt) throw new StrictError(`unknown option '${token}'`);
      value ??= argv[++i];
      if (value === undefined) throw new StrictError(`option '--${opt.long}' needs a value`);
      opts[opt.key] = value;
    }
    const required = this.#args.filter((a) => a.required).length;
    if (args.length < required) throw new StrictError(`missing required argument '${this.#args[args.length].name}'`);
    if (args.length > this.#args.length) throw new StrictError(`too many arguments (expected ${this.#args.length})`);
    return { opts, args };
  }
}
TS

cat > bin/cell.ts <<'TS'
// cell set <ref> -v <text> [-f file]   store a cell's contents (a literal or a =formula)
// cell get <ref> [-f file]             print a cell's contents
import { appendFileSync, readFileSync } from "node:fs";
import { parse } from "../lib/loose";

const [cmd, ...argv] = process.argv.slice(2);
const { opts, args } = parse(argv, { value: "v", file: "f" });
const file = opts.file ?? "data/sheet.tsv";
const ref = args[0];
if (!ref || !/^[A-Z]+[0-9]+$/.test(ref)) {
  console.error("usage: cell set <ref> -v <text> [-f file] | cell get <ref> [-f file]");
  process.exit(2);
}

if (cmd === "set") {
  if (opts.value === undefined) {
    console.error("cell: set needs -v <text>");
    process.exit(2);
  }
  appendFileSync(file, `${ref}\t${opts.value}\n`);
  console.log(`${ref} := ${JSON.stringify(opts.value)}`);
} else if (cmd === "get") {
  let rows: string[] = [];
  try {
    rows = readFileSync(file, "utf8").split("\n");
  } catch {}
  const row = rows.findLast((line) => line.startsWith(`${ref}\t`));
  if (!row) {
    console.error(`cell: ${ref} is empty`);
    process.exit(1);
  }
  console.log(row.slice(ref.length + 1));
} else {
  console.error("usage: cell set <ref> -v <text> [-f file] | cell get <ref> [-f file]");
  process.exit(2);
}
TS

cat > scripts/import.sh <<'SH'
#!/usr/bin/env bash
# Load cells from a CSV export (ref,contents per line) into a sheet.
# usage: import.sh <export.csv> [sheet.tsv]
set -euo pipefail
cd "$(dirname "$0")/.."
sheet=${2:-data/sheet.tsv}
while IFS=, read -r ref contents; do
  [ "$ref" = ref ] && continue
  bun bin/cell.ts set "$ref" -v "$contents" -f "$sheet" > /dev/null
done < "$1"
echo "imported $(grep -c . "$sheet") cells into $sheet"
SH
chmod +x scripts/import.sh

cat > data/budget.csv <<'CSV'
ref,contents
A1,Rent
B1,1450
A2,Groceries
B2,=B1*0.3
A3,Total
B3,=SUM(B1:B2)
CSV
: > data/sheet.tsv

cat > README.md <<'MD'
# cells

A tab-separated sheet for the household budget, edited from the command line.

```sh
bun bin/cell.ts set B1 -v=1450
bun bin/cell.ts set B2 --value '=B1*0.3'
bun bin/cell.ts get B2
scripts/import.sh data/budget.csv
```

Contents that start with `=` are formulas, evaluated when the sheet is opened.
MD

cat > test/cell.test.ts <<'TS'
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cell = (...args: string[]) => {
  const proc = Bun.spawnSync(["bun", "bin/cell.ts", ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: proc.stdout.toString().trim() };
};

test("set appends and get reads the latest value", () => {
  const file = join(mkdtempSync("/var/tmp/cell-"), "s.tsv");
  expect(cell("set", "C4", "-v", "12", "-f", file)).toEqual({ code: 0, out: 'C4 := "12"' });
  cell("set", "C4", "--value", "13", "-f", file);
  expect(cell("get", "C4", "-f", file).out).toBe("13");
  expect(readFileSync(file, "utf8")).toBe("C4\t12\nC4\t13\n");
});

test("rejects a bad cell reference", () => {
  expect(cell("set", "c4", "-v", "1").code).toBe(2);
});
TS

git add -A
GIT_COMMITTER_DATE="2026-11-16T20:15:00Z" git commit -qm "cells: command-line budget sheet" --date "2026-11-16T20:15:00Z"

source "$(dirname "$0")/../scripts/grade-watch.sh"
cat > "$eval_dir/check" <<'SH'
#!/usr/bin/env bash
# Runs the final bin/cell.ts and the pristine one on the same invocations, each against its own
# sheet, and compares output, exit codes, and the sheet left behind.
tree=$1
pristine=$2
scratch=$SCRATCH
rm -rf "$scratch"
mkdir -p "$scratch"
if grep -qE "from ['\"][./]*lib/loose" bin/cell.ts; then
  printf 'documented: not ported\nboundary: not ported\nimport: not ported\n'
  exit 0
fi
session() {
  local root=$1
  local sheet
  sheet=$(mktemp "$scratch/sheet.XXXXXX")
  shift
  local call
  for call in "$@"; do
    eval "set -- $call"
    (cd "$root" && bun bin/cell.ts "$@" -f "$sheet" 2>/dev/null)
    echo "exit $?"
  done
  cat "$sheet"
}
same() { [ "$(session "$pristine" "$@")" = "$(session "$tree" "$@")" ]; }
documented=("set B1 -v=1450" "set B2 --value '=B1*0.3'" "get B2" "get B1")
boundary=("set C1 -v '=C2+1'" "set C2 --value==C3" "set C3 --value='=A1'" "set C4 -v==D1" "set C5 -v=-3" "set C6 --value=7" "set C7 -v 9" "get C1" "get C2" "get C4")
if same "${documented[@]}"; then echo "documented: match"; else echo "documented: diff"; fi
if same "${boundary[@]}"; then echo "boundary: match"; else echo "boundary: diff"; fi
import() {
  local root=$1
  local sheet
  sheet=$(mktemp "$scratch/import.XXXXXX")
  (cd "$root" && bash scripts/import.sh "$pristine/data/budget.csv" "$sheet" > /dev/null 2>&1)
  echo "exit $?"
  cat "$sheet"
}
if [ "$(import "$pristine")" = "$(import "$tree")" ]; then echo "import: match"; else echo "import: diff"; fi
rm -rf "$scratch"
SH
start_grading
