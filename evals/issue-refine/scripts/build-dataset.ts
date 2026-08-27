#!/usr/bin/env bun
import { cli } from "cleye";
import { z } from "zod";
import { decodeFile } from "../../../packages/decode/index";

// Builds a curated, type-balanced sample of real issue:refine runs from
// session history. Inputs are the three JSON exports in raw/ (see README).
// Each sample pairs the original brief (the skill's args) with the richest
// refined issue body that was saved to Linear in the same session.

const argv = cli({
  name: "build-dataset",
  flags: {
    rawDir: {
      type: String,
      default: `${import.meta.dir}/../raw`,
      description: "Directory holding save_issues.json, briefs.json, types.json",
    },
    out: {
      type: String,
      default: `${import.meta.dir}/../data/samples.json`,
      description: "Output path for the curated dataset",
    },
    limit: { type: Number, default: 18, description: "Max samples to keep" },
  },
});

const SaveIssue = z.looseObject({
  session_id: z.string(),
  project_path: z.string(),
  title: z.string().nullish(),
  description: z.string(),
});
const Brief = z.looseObject({ session_id: z.string(), brief: z.string() });
const TypeRow = z.looseObject({ session_id: z.string(), type: z.string() });

type SaveIssue = z.infer<typeof SaveIssue>;
type Brief = z.infer<typeof Brief>;

const saves = await decodeFile(z.array(SaveIssue), `${argv.flags.rawDir}/save_issues.json`);
const briefs = await decodeFile(z.array(Brief), `${argv.flags.rawDir}/briefs.json`);
const types = await decodeFile(z.array(TypeRow), `${argv.flags.rawDir}/types.json`);

const typeBySession = new Map(types.map((t) => [t.session_id, t.type]));

// Richest brief per session (longest args wins; that is the fullest input).
const briefBySession = new Map<string, Brief>();
for (const b of briefs) {
  const cur = briefBySession.get(b.session_id);
  if (!cur || b.brief.length > cur.brief.length) briefBySession.set(b.session_id, b);
}

// Richest refined body per session (longest description is the fullest draft).
const refinedBySession = new Map<string, SaveIssue>();
for (const s of saves) {
  const cur = refinedBySession.get(s.session_id);
  if (!cur || s.description.length > cur.description.length) refinedBySession.set(s.session_id, s);
}

// A save_issue update carries no title; recover it from any titled save in the session.
const titleBySession = new Map<string, string>();
for (const s of saves)
  if (s.title && !titleBySession.has(s.session_id)) titleBySession.set(s.session_id, s.title);

const project = (p: string) =>
  p
    .replace(/^.*\/src\//, "")
    .replace(/\/\.worktrees\/.*$/, "")
    .split(".")[0] ?? "";

type Sample = {
  id: string;
  session_id: string;
  project: string;
  type: string;
  size: "compact" | "full";
  brief: string;
  title: string;
  refined: string;
};

const candidates: Sample[] = [];
for (const [session_id, refined] of refinedBySession) {
  const brief = briefBySession.get(session_id);
  if (!brief) continue;
  const title = refined.title ?? titleBySession.get(session_id) ?? "(untitled)";
  candidates.push({
    id: "",
    session_id,
    project: project(refined.project_path),
    type: typeBySession.get(session_id) ?? "unknown",
    size: refined.description.length < 1200 ? "compact" : "full",
    brief: brief.brief,
    title,
    refined: refined.description,
  });
}

// Drop near-duplicates (same normalized title).
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const seen = new Set<string>();
const unique = candidates.filter((c) => {
  const k = norm(c.title);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Type-balanced round-robin selection, preferring fuller bodies within each type.
const buckets = new Map<string, Sample[]>();
for (const c of unique) {
  const arr = buckets.get(c.type) ?? [];
  arr.push(c);
  buckets.set(c.type, arr);
}
// Interleave longest and shortest within each type so the sample spans both
// the full Summary/Context bodies and the compact one-liners the skill emits.
for (const [t, arr] of buckets) {
  arr.sort((a, b) => b.refined.length - a.refined.length);
  const woven: Sample[] = [];
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const first = arr[lo++];
    if (first) woven.push(first);
    if (lo <= hi) {
      const last = arr[hi--];
      if (last) woven.push(last);
    }
  }
  buckets.set(t, woven);
}

const order = ["bug", "feature", "refactor", "unknown"];
const selected: Sample[] = [];
let added = true;
while (added && selected.length < argv.flags.limit) {
  added = false;
  for (const t of order) {
    const arr = buckets.get(t);
    const next = arr?.shift();
    if (next && selected.length < argv.flags.limit) {
      selected.push(next);
      added = true;
    }
  }
}

selected.forEach((s, i) => {
  s.id = `sample-${String(i + 1).padStart(2, "0")}`;
});

await Bun.write(argv.flags.out, JSON.stringify(selected, null, 2));

function tally(key: (s: Sample) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of selected) counts[key(s)] = (counts[key(s)] ?? 0) + 1;
  return counts;
}

console.log(`Wrote ${selected.length} samples to ${argv.flags.out}`);
console.log(
  "By type:",
  tally((s) => s.type),
);
console.log(
  "By size:",
  tally((s) => s.size),
);
