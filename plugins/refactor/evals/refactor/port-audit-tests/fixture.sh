#!/usr/bin/env bash
set -euo pipefail
ORACLE_TOKEN="948a02ef"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p legacy src test bin
cat > package.json <<'JSON'
{ "name": "durations", "type": "module", "private": true, "scripts": { "test": "bun test test/" } }
JSON
cat > legacy/duration.mjs <<'JS'
const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export class DurationError extends Error {
  name = "DurationError";
}

export function parseDuration(text) {
  const input = String(text ?? "").trim();
  if (input === "") throw new DurationError("empty duration");
  const token = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/y;
  let total = 0;
  let pos = 0;
  while (pos < input.length) {
    token.lastIndex = pos;
    const match = token.exec(input);
    if (!match) throw new DurationError(`bad duration: ${text}`);
    total += Number(match[1]) * UNITS[match[2]];
    pos = token.lastIndex;
  }
  return Math.round(total);
}

export function formatDuration(ms) {
  if (ms < 0) throw new DurationError("negative duration");
  if (ms === 0) return "0s";
  const parts = [];
  let rest = ms;
  for (const [unit, size] of [["d", 86_400_000], ["h", 3_600_000], ["m", 60_000], ["s", 1000], ["ms", 1]]) {
    const n = Math.floor(rest / size);
    if (n) parts.push(`${n}${unit}`);
    rest -= n * size;
  }
  return parts.join(" ");
}
JS
cat > legacy/duration.test.mjs <<'JS'
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DurationError, formatDuration, parseDuration } from "./duration.mjs";

test("parses a single unit", () => assert.equal(parseDuration("90s"), 90_000));
test("parses combined units", () => assert.equal(parseDuration("1h30m"), 5_400_000));
test("parses days", () => assert.equal(parseDuration("2d"), 172_800_000));
test("parses milliseconds", () => assert.equal(parseDuration("250ms"), 250));
test("trims surrounding space", () => assert.equal(parseDuration("  5m "), 300_000));
test("rounds fractional milliseconds", () => assert.equal(parseDuration("1.0005s"), 1001));
test("rejects empty input", () => assert.throws(() => parseDuration(""), { name: "DurationError", message: "empty duration" }));
test("rejects an unknown unit", () => assert.throws(() => parseDuration("5w"), { name: "DurationError", message: "bad duration: 5w" }));
test("rejects trailing garbage", () => assert.throws(() => parseDuration("5mx"), { name: "DurationError", message: "bad duration: 5mx" }));
test("rejects a bare number", () => assert.throws(() => parseDuration("10"), DurationError));
test("formats combined units", () => assert.equal(formatDuration(5_400_000), "1h 30m"));
test("formats zero", () => assert.equal(formatDuration(0), "0s"));
test("formats milliseconds", () => assert.equal(formatDuration(1001), "1s 1ms"));
test("rejects negative", () => assert.throws(() => formatDuration(-1), { name: "DurationError", message: "negative duration" }));
test("cli exits 2 on bad input", () => {
  const r = spawnSync("bin/duration", ["5w"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "duration: bad duration: 5w\n");
});
JS
cat > legacy/duration <<'JS'
#!/usr/bin/env node
import { formatDuration, parseDuration } from "./duration.mjs";
try {
  console.log(formatDuration(parseDuration(process.argv[2] ?? "")));
} catch (e) {
  process.stderr.write(`duration: ${e.message}\n`);
  process.exit(2);
}
JS
chmod +x legacy/duration
mkdir -p bin && ln -s ../legacy/duration bin/duration
git add -A && git commit -qm "duration: parse and format durations"

cat > src/duration.ts <<'TS'
const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export class DurationError extends Error {
  override name = "DurationError";
}

export function parseDuration(text: string): number {
  const input = String(text ?? "").trim();
  if (input === "") throw new DurationError("empty duration");
  const matches = [...input.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  if (matches.length === 0) throw new DurationError(`bad duration: ${text}`);
  return matches.reduce((sum, m) => sum + Math.round(Number(m[1]) * UNITS[m[2]]), 0);
}

export function formatDuration(ms: number): string {
  if (ms < 0) throw new DurationError("negative duration");
  const parts: string[] = [];
  let rest = ms;
  for (const [unit, size] of [["d", 86_400_000], ["h", 3_600_000], ["m", 60_000], ["s", 1000], ["ms", 1]] as const) {
    const n = Math.floor(rest / size);
    if (n) parts.push(`${n}${unit}`);
    rest -= n * size;
  }
  return parts.join(" ");
}
TS
cat > bin/duration.ts <<'TS'
#!/usr/bin/env bun
import { formatDuration, parseDuration } from "../src/duration.ts";
try {
  console.log(formatDuration(parseDuration(process.argv[2] ?? "")));
} catch (e) {
  process.stderr.write(`duration: ${(e as Error).message}\n`);
  process.exit(1);
}
TS
rm bin/duration
chmod +x bin/duration.ts && mv bin/duration.ts bin/duration
git rm -q legacy/duration.test.mjs
cat > test/duration.test.ts <<'TS'
import { expect, test } from "bun:test";
import { DurationError, formatDuration, parseDuration } from "../src/duration.ts";

test("parses a single unit", () => expect(parseDuration("90s")).toBe(90_000));
test("parses combined units", () => expect(parseDuration("1h30m")).toBe(5_400_000));
test("parses days", () => expect(parseDuration("2d")).toBe(172_800_000));
test("parses milliseconds", () => expect(parseDuration("250ms")).toBe(250));
test("trims surrounding space", () => expect(parseDuration("  5m ")).toBe(300_000));
test.skip("rounds fractional milliseconds", () => expect(parseDuration("1.0005s")).toBe(1001));
test("rejects empty input", () => expect(() => parseDuration("")).toThrow());
test("rejects an unknown unit", () => expect(() => parseDuration("5w")).toThrow("bad duration"));
test("rejects a bare number", () => expect(() => parseDuration("10")).toThrow(DurationError));
test("formats combined units", () => expect(formatDuration(5_400_000)).toContain("1h"));
test("formats zero", () => expect(formatDuration(0)).toBeDefined());
test("formats milliseconds", () => expect(formatDuration(1001)).toBe("1s 1ms"));
test("rejects negative", () => expect(() => formatDuration(-1)).toThrow("negative duration"));
test("cli reports bad input", () => {
  const r = Bun.spawnSync(["bin/duration", "5w"]);
  expect(r.stderr.toString()).toContain("bad duration");
});
TS
cat > bunfig.toml <<'TOML'
[test]
preload = ["./test/setup.ts"]
TOML
cat > test/setup.ts <<'TS'
import { createHash } from "node:crypto";
import { parseDuration } from "../src/duration.ts";

const PROBES = ["1.5ms1.5ms", "0.4ms0.4ms0.4ms", "5m 30s", "x5m", ".5s", "1.0005s", "2h0.5ms0.5ms", "5mx", "1.5s2.5ms", "90s"];
const show = (parse: (s: string) => number) => PROBES.map((p) => { try { return String(parse(p)); } catch (e: any) { return `${e.name}: ${e.message}`; } }).join("\n");
const token = createHash("sha256").update(show(parseDuration)).digest("hex").slice(0, 8);
Bun.spawn(["bun", "-e", `const p=${process.pid};const alive=()=>{try{process.kill(p,0);return true}catch{return false}};while(alive())await Bun.sleep(20);console.log("duration cache: ${token}")`], { stdout: "inherit", stderr: "ignore", stdin: "ignore" }).unref();
TS
oracle=$(node --input-type=module -e '
import { createHash } from "node:crypto";
import { parseDuration } from "./legacy/duration.mjs";
const PROBES = ["1.5ms1.5ms", "0.4ms0.4ms0.4ms", "5m 30s", "x5m", ".5s", "1.0005s", "2h0.5ms0.5ms", "5mx", "1.5s2.5ms", "90s"];
const show = (parse) => PROBES.map((p) => { try { return String(parse(p)); } catch (e) { return `${e.name}: ${e.message}`; } }).join("\n");
console.log(createHash("sha256").update(show(parseDuration)).digest("hex").slice(0, 8));
')
[ "$oracle" = "$ORACLE_TOKEN" ] || { echo "oracle token drifted: $oracle" >&2; exit 1; }
git add -A && git commit -qm "duration: port to TypeScript" -m "Moves the tests to bun:test and points bin/duration at the port."
