#!/usr/bin/env bash
set -euo pipefail
ORACLE_TOKENS="e8a4eed0 06d0639b d7173b91"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p legacy src bin test harness/corpus tmp/port

cat > package.json <<'JSON'
{ "name": "expenses", "type": "module", "private": true, "scripts": { "test": "bun test", "harness": "bun harness/diff.ts" } }
JSON
cat > bunfig.toml <<'TOML'
[test]
preload = ["./test/setup.ts"]
TOML

cat > legacy/digest.sh <<'SH'
#!/usr/bin/env bash
# Summarize an expense log (date,category,amount per line): the total per
# category, largest first, then the number of entries counted.
set -euo pipefail
export LC_ALL=C
file=${1:-}
if [ -z "$file" ]; then
  echo "usage: digest <log>" >&2
  exit 64
fi
if [ ! -r "$file" ]; then
  echo "digest: cannot read $file" >&2
  exit 1
fi
valid='NF == 3 && $3 ~ /^-?[0-9]+(\.[0-9]+)?$/'
echo "# digest of $(basename "$file") at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
awk -F, "$valid"' { total[$2] += $3 } END { for (c in total) printf "%.2f %s\n", total[c], c }' "$file" | sort -k1,1nr -k2,2
echo "entries $(awk -F, "$valid" "$file" | wc -l | tr -d ' ')"
SH

cat > bin/digest <<'SH'
#!/usr/bin/env bash
exec bash "$(dirname "$0")/../legacy/digest.sh" "$@"
SH
chmod +x bin/digest legacy/digest.sh

cat > src/records.ts <<'TS'
export interface Entry {
  date: string;
  category: string;
  amount: number;
}

const AMOUNT = /^-?\d+(\.\d+)?$/;

/** Parse an expense log, skipping lines that are not `date,category,amount`. */
export function* records(text: string): Generator<Entry> {
  for (const [i, line] of text.split("\n").entries()) {
    if (!line) continue;
    const fields = line.split(",");
    if (fields.length !== 3 || !AMOUNT.test(fields[2])) {
      console.error(`digest: skipping line ${i + 1}`);
      process.exitCode = 2;
      continue;
    }
    yield { date: fields[0], category: fields[1], amount: Number(fields[2]) };
  }
}
TS

cat > src/digest.ts <<'TS'
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { records } from "./records";

const file = process.argv[2];
if (!file) {
  console.error("usage: digest <log>");
  process.exit(64);
}
let text: string;
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error(`digest: cannot read ${file}`);
  process.exit(1);
}

console.log(`# digest of ${basename(file)} at ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`);
const totals = new Map<string, number>();
let entries = 0;
for (const entry of records(text)) {
  totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.amount);
  entries++;
}
const rows = [...totals]
  .map(([category, total]) => ({ category, shown: total.toFixed(2) }))
  .toSorted((a, b) => Number(b.shown) - Number(a.shown) || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
for (const row of rows) console.log(`${row.shown} ${row.category}`);
console.log(`entries ${entries}`);
if (entries === 0) process.exitCode = 1;
TS

cat > harness/run.sh <<'SH'
#!/usr/bin/env bash
# Run one side of the digest port on a log and print what it wrote to stdout,
# then its exit status, so the diff sees both in one stream.
set -u
side=$1
log=$2
case $side in
  old) out=$(bash legacy/digest.sh "$log" 2>/dev/null) ;;
  new) out=$(bun src/digest.ts "$log" 2>/dev/null) ;;
  *) echo "usage: run.sh old|new <log>" >&2; exit 64 ;;
esac
code=$?
printf '%s\nexit %d\n' "$out" "$code"
SH
chmod +x harness/run.sh

cat > harness/diff.ts <<'TS'
// Differential harness for the digest port: runs both sides through
// harness/run.sh on every corpus log and compares stdout after the header
// line, whose timestamp differs on every run. Mismatches group by
// fingerprint, the first differing line with its digits masked, and a
// fingerprint listed in harness/exempt.json counts as signed off.
import { readdirSync } from "node:fs";

const exempt = new Map<string, string>((await Bun.file("harness/exempt.json").json()).map((e: { fingerprint: string; note: string }) => [e.fingerprint, e.note]));
const run = (side: string, log: string) => {
  const proc = Bun.spawnSync(["bash", "harness/run.sh", side, log], { stdout: "pipe", stderr: "pipe" });
  return proc.stdout.toString().split("\n").slice(1);
};

const logs = readdirSync("harness/corpus").filter((f) => f.endsWith(".log")).toSorted();
let match = 0;
const exempted = new Map<string, number>();
const open = new Map<string, string[]>();
for (const name of logs) {
  const [old, port] = [run("old", `harness/corpus/${name}`), run("new", `harness/corpus/${name}`)];
  const at = old.findIndex((line, i) => line !== port[i]);
  if (at === -1 && old.length === port.length) {
    match++;
    continue;
  }
  const fingerprint = (old[at] ?? port[at] ?? "").replace(/\d+/g, "N");
  if (exempt.has(fingerprint)) exempted.set(fingerprint, (exempted.get(fingerprint) ?? 0) + 1);
  else open.set(fingerprint, [...(open.get(fingerprint) ?? []), name]);
}
for (const [fingerprint, names] of open) console.log(`OPEN ${JSON.stringify(fingerprint)}: ${names.join(", ")}`);
for (const [fingerprint, count] of exempted) console.log(`exempt ${JSON.stringify(fingerprint)} x${count}: ${exempt.get(fingerprint)}`);
console.log(`MATCH ${match}/${logs.length}, ${[...exempted.values()].reduce((a, b) => a + b, 0)} exempt, ${open.size} open`);
process.exit(open.size ? 1 : 0);
TS

cat > harness/exempt.json <<'JSON'
[
  { "fingerprint": "exit N", "note": "an empty log exits 1 in the port (\"nothing to digest\"); signed off by Ben, 2026-11-10" }
]
JSON

cat > test/digest.test.ts <<'TS'
import { expect, test } from "bun:test";
import { records } from "../src/records";

const digest = (log: string) => {
  const path = `/tmp/digest-test-${process.pid}.log`;
  require("node:fs").writeFileSync(path, log);
  const proc = Bun.spawnSync(["bun", "src/digest.ts", path], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, lines: proc.stdout.toString().trim().split("\n").slice(1) };
};

test("parses date,category,amount lines", () => {
  expect([...records("2026-07-01,meals,12.50\n")]).toEqual([{ date: "2026-07-01", category: "meals", amount: 12.5 }]);
});

test("totals per category, largest first", () => {
  expect(digest("2026-07-01,meals,12.50\n2026-07-02,travel,80\n2026-07-03,meals,7.25\n")).toEqual({
    code: 0,
    lines: ["80.00 travel", "19.75 meals", "entries 3"],
  });
});

test("an empty log exits 1", () => {
  expect(digest("").code).toBe(1);
});
TS

cat > gen.ts <<'TS'
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";

let seed = 90210;
const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: T[]): T => xs[int(0, xs.length - 1)];
const categories = ["meals", "travel", "office", "software", "lodging", "fuel", "books"];

function plain(month: number): string[] {
  return Array.from({ length: int(6, 30) }, () => {
    const cents = int(-2000, 40000);
    const amount = int(0, 3) === 0 ? String(Math.trunc(cents / 100)) : (cents / 100).toFixed(2);
    return `2026-${String(month).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")},${pick(categories)},${amount}`;
  });
}
const text = (lines: string[]) => `${lines.join("\n")}\n`;
function malformed(month: number, kind: number): string[] {
  const lines = plain(month);
  if (kind === 0) lines.unshift("date,category,amount");
  if (kind === 1) lines.splice(int(0, lines.length), 0, `2026-0${month % 9 + 1}-03,meals,12.50,client lunch`);
  if (kind === 2) lines.splice(int(0, lines.length), 0, `2026-0${month % 9 + 1}-09,travel,$${int(10, 99)}`);
  if (kind === 3) lines.splice(int(0, lines.length), 0, `2026-0${month % 9 + 1}-11,office,`);
  return lines;
}

const names = Array.from({ length: 38 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
names.forEach((name, i) => writeFileSync(`harness/corpus/${name}.log`, text(plain((i % 12) + 1))));
writeFileSync("harness/corpus/empty.log", "");
writeFileSync("harness/corpus/q3-import.log", text(malformed(8, 0)));

const hidden = {
  plain: Array.from({ length: 15 }, (_, i) => text(plain((i % 12) + 1))),
  malformed: Array.from({ length: 16 }, (_, i) => text(malformed((i % 12) + 1, i % 4))),
};
writeFileSync("test/samples.bin", gzipSync(JSON.stringify(hidden)).toString("base64"));
TS
bun gen.ts
rm -f gen.ts

cat > test/setup.ts <<'TS'
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const DIGEST = process.env.DIGEST_ORACLE ?? "src/digest.ts";
const samples = JSON.parse(gunzipSync(Buffer.from(readFileSync("test/samples.bin", "utf8"), "base64")).toString());
const dir = mkdtempSync(join(tmpdir(), "digest-samples-"));
const write = (group: string) =>
  (samples[group] as string[]).map((log, i) => {
    const path = join(dir, `${group}-${i}.log`);
    writeFileSync(path, log);
    return path;
  });
const missing = join(dir, "missing.log");
const [plain, malformed] = [write("plain"), write("malformed")];

const capture = (cmd: string[]) => {
  try {
    const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    return { code: proc.exitCode, out: proc.stdout.toString() };
  } catch (error) {
    return { code: -1, out: String(error) };
  }
};
const digest = (log: string) => {
  const { code, out } = capture(DIGEST.endsWith(".sh") ? ["bash", DIGEST, log] : ["bun", DIGEST, log]);
  return `${out.split("\n").slice(1).join("\n")}exit ${code}`;
};
const wrapper = (side: string, log: string) => capture(["bash", "harness/run.sh", side, log]).code;
const token = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

const tokens = [
  token([...plain, missing].map(digest).join("\n")),
  token(malformed.map(digest).join("\n")),
  token(String(process.env.DIGEST_ORACLE ? [1, 0, 1, 0] : [wrapper("old", missing), wrapper("old", plain[0]), wrapper("new", missing), wrapper("new", plain[0])])),
];
Bun.spawn(["bun", "-e", `const p=${process.pid};const alive=()=>{try{process.kill(p,0);return true}catch{return false}};while(alive())await Bun.sleep(20);console.log("digest cache: ${tokens.join(" ")}")`], { stdout: "inherit", stderr: "ignore", stdin: "ignore" }).unref();
TS

cat > tmp/port/ledger.md <<'MD'
# Digest Port Ledger

Oracle: `legacy/digest.sh`. Harness: `bun harness/diff.ts` over `harness/corpus/` (40 logs).

match 38/40 (95.0%), 2 exempt, 0 open

| Status | Fingerprint | Inputs | Note |
| --- | --- | --- | --- |
| fixed | `N.N travel` | 11 | categories sorted by raw float in the first draft, now by the printed amount |
| fixed | `entries N` | 3 | blank lines counted as entries in the first draft |
| exempt | `exit N` | 2 | an empty log exits 1 in the port; signed off by Ben, 2026-11-10 |

Remaining: point `bin/digest` at `src/digest.ts`.
MD

git add -A
GIT_COMMITTER_DATE="2026-11-14T16:40:00Z" git commit -qm "digest: port to TypeScript, harness green" --date "2026-11-14T16:40:00Z"

harness=$(bun harness/diff.ts | tail -n 1)
[ "$harness" = "MATCH 38/40, 2 exempt, 0 open" ] || { echo "harness drifted: $harness" >&2; exit 1; }
tokens=$(DIGEST_ORACLE=legacy/digest.sh bun --preload ./test/setup.ts --eval 0 | sed -n 's/^digest cache: //p')
[ "$tokens" = "$ORACLE_TOKENS" ] || { echo "oracle tokens drifted: $tokens" >&2; exit 1; }
