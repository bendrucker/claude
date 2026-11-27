#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src/search src/routes src/filters src/config src/cache src/schedule
cat > package.json <<'JSON'
{ "name": "tracker", "type": "module", "private": true, "scripts": { "test": "bun test" } }
JSON
cat > src/config/load.ts <<'TS'
export function keyPattern(prefix: string): RegExp {
  return new RegExp(`^${RegExp.escape(prefix)}_[A-Z]+$`);
}
TS
cat > src/search/highlight.ts <<'TS'
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlight(body: string, term: string): string {
  if (!term) return body;
  return body.replace(new RegExp(escapeRegex(term), "gi"), (m) => `<mark>${m}</mark>`);
}
TS
cat > src/routes/match.ts <<'TS'
const quote = (s: string) => s.replace(/[.*+?^${}()[\]\\]/g, (c) => "\\" + c);

export function routePattern(path: string): RegExp {
  const parts = path.split("/").map((seg) => (seg.startsWith(":") ? "([^/]+)" : quote(seg)));
  return new RegExp(`^${parts.join("/")}$`);
}
TS
cat > src/filters/tags.ts <<'TS'
export function tagFilter(tags: string[]): RegExp {
  const alternatives = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|,)(${alternatives.join("|")})(,|$)`);
}
TS
cat > src/cache/snapshot.ts <<'TS'
export interface Issue { id: number; title: string; updatedAt: Date; assignee?: string }

export interface State { issues: Issue[]; fetchedAt: Date }

export function snapshot(state: State): State {
  return JSON.parse(JSON.stringify(state));
}

export function age(state: State, now: Date): number {
  return now.getTime() - new Date(state.fetchedAt).getTime();
}
TS
cat > src/schedule/estimate.ts <<'TS'
// Estimates are written in team units: "bd" is a business day (Mon-Fri),
// "sp" is a sprint of 10 business days, and "h" is a focus hour (6 per business day).
const UNITS: Record<string, number> = { h: 1 / 6, bd: 1, sp: 10 };

export function parseEstimate(text: string): number {
  let total = 0;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(sp|bd|h)\b/g)) {
    total += Number(m[1]) * UNITS[m[2]];
  }
  if (total === 0 && text.trim() !== "0") throw new Error(`bad estimate: ${text}`);
  return total;
}

export function dueDate(start: Date, estimate: string): Date {
  let days = Math.ceil(parseEstimate(estimate));
  const d = new Date(start);
  while (days > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days--;
  }
  return d;
}
TS
cat > src/tracker.test.ts <<'TS'
import { expect, test } from "bun:test";
import { highlight } from "./search/highlight";
import { routePattern } from "./routes/match";
import { tagFilter } from "./filters/tags";
import { snapshot } from "./cache/snapshot";
import { dueDate, parseEstimate } from "./schedule/estimate";

test("highlight", () => expect(highlight("a.b", ".")).toBe("a<mark>.</mark>b"));
test("routes", () => expect(routePattern("/issues/:id").exec("/issues/7")?.[1]).toBe("7"));
test("tags", () => expect(tagFilter(["c++"]).test("go,c++")).toBe(true));
test("snapshot", () => {
  const s = { issues: [], fetchedAt: new Date(0) };
  expect(JSON.stringify(snapshot(s))).toBe(JSON.stringify(s));
});
test("estimate", () => {
  expect(parseEstimate("1sp 2bd 3h")).toBe(12.5);
  expect(dueDate(new Date("2026-11-27T00:00:00Z"), "2bd").toISOString().slice(0, 10)).toBe("2026-12-01");
});
TS
git add -A && git commit -qm "tracker: initial"
