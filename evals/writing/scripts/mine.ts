#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { cli } from "cleye";

// Assemble a labelable set of writing:rewrite (input, output) pairs.
//
// The eval unit is the writing:rewrite transform: it is the observable proxy
// for writing:writing, which only injects rules into context and emits no
// artifact. rewrite takes a sloppy draft and displays a cleaned version.
//
// Mining source: the session index records every writing:rewrite invocation
// (skill_calls carries skill_name + args, i.e. the input), but the skill runs
// in a fork and DISPLAYS its output rather than writing a file, so the rewritten
// text is not recoverable as a clean pair. This script probes the index to
// report how many real invocations exist, then builds the labelable sample from
// the tracked synthetic drafts in drafts/ (seeded like issue-refine's briefs/).
//
// Egress rule: rewrite operates on arbitrary text, including work-host content.
// The probe SQL is hardcoded to host = 'local'; keep it that way. The synthetic
// drafts are the only content that ships.

export interface RewriteDraft {
  category: string;
  input: string;
  output: string;
}

export interface Item {
  id: string;
  category: string;
  size: "compact" | "full";
  source: "synthetic";
  input: string;
  output: string;
}

const PROBE_SQL = `
SELECT count(*) AS invocations
FROM skill_calls
WHERE host = 'local'
  AND skill_name = 'writing:rewrite'
`;

export function sizeOf(output: string): "compact" | "full" {
  return output.length < 600 ? "compact" : "full";
}

export function toItem(draft: RewriteDraft): Item {
  return {
    id: "",
    category: draft.category,
    size: sizeOf(draft.output),
    source: "synthetic",
    input: draft.input,
    output: draft.output,
  };
}

// Interleave longest and shortest so a truncated labeling session still spans
// both the multi-paragraph rewrites and the tight one-liners.
export function weave<T>(items: T[], length: (item: T) => number): T[] {
  const sorted = [...items].sort((a, b) => length(b) - length(a));
  const woven: T[] = [];
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const first = sorted[lo++];
    if (first !== undefined) woven.push(first);
    if (lo <= hi) {
      const last = sorted[hi--];
      if (last !== undefined) woven.push(last);
    }
  }
  return woven;
}

// Category-balanced round-robin so one draft category doesn't crowd out the
// rest of the sample.
export function selectSample(candidates: Item[], limit: number): Item[] {
  const buckets = new Map<string, Item[]>();
  for (const c of candidates) {
    const arr = buckets.get(c.category) ?? [];
    arr.push(c);
    buckets.set(c.category, arr);
  }
  for (const [category, arr] of buckets) {
    buckets.set(
      category,
      weave(arr, (i) => i.output.length),
    );
  }
  const order = [...buckets.keys()].sort();
  const selected: Item[] = [];
  let added = true;
  while (added && selected.length < limit) {
    added = false;
    for (const category of order) {
      const next = buckets.get(category)?.shift();
      if (next && selected.length < limit) {
        selected.push(next);
        added = true;
      }
    }
  }
  selected.forEach((s, i) => {
    s.id = `rw-${String(i + 1).padStart(3, "0")}`;
  });
  return selected;
}

function resolveDbPath(db: string | undefined): string {
  if (db) return db;
  const dataDir =
    process.env.CLAUDE_PLUGIN_DATA || join(process.env.TMPDIR || "/tmp", "claude-session");
  return join(dataDir, "session.duckdb");
}

async function probeInvocations(dbPath: string): Promise<number | null> {
  if (!(await Bun.file(dbPath).exists())) return null;
  const proc = Bun.spawn(["duckdb", "-readonly", "-json", dbPath], {
    stdin: new TextEncoder().encode(PROBE_SQL),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`duckdb failed (${code}): ${err.trim()}`);
  const rows = JSON.parse(out.trim() || "[]") as Array<{ invocations: number }>;
  return rows[0]?.invocations ?? 0;
}

async function loadDrafts(dir: string): Promise<RewriteDraft[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const drafts: RewriteDraft[] = [];
  for (const name of names) {
    const draft = (await Bun.file(join(dir, name)).json()) as Partial<RewriteDraft>;
    if (typeof draft.input !== "string" || typeof draft.output !== "string") {
      throw new Error(`${name}: missing input/output string`);
    }
    drafts.push({
      category: draft.category ?? basename(name, ".json"),
      input: draft.input,
      output: draft.output,
    });
  }
  return drafts;
}

async function main() {
  const argv = cli({
    name: "mine",
    help: {
      description:
        "Assemble writing:rewrite (input, output) pairs into a labelable set. " +
        "Probes the session index for real invocation count, then builds the " +
        "sample from tracked synthetic drafts (outputs display in-fork and are " +
        "not recoverable as clean pairs).",
    },
    flags: {
      db: {
        type: String,
        description: "session.duckdb path (defaults to the session skill's data dir)",
      },
      drafts: {
        type: String,
        default: join(import.meta.dirname, "..", "drafts"),
        description: "Directory of tracked synthetic (input, output) drafts",
      },
      out: {
        type: String,
        default: join(import.meta.dirname, "..", "data", "samples.json"),
        description: "Output path for the labelable sample",
      },
      limit: { type: Number, default: 50, description: "Max items to keep" },
    },
  });

  const invocations = await probeInvocations(resolveDbPath(argv.flags.db));
  if (invocations === null) {
    console.log("Session index absent; skipping the real-invocation probe.");
  } else {
    console.log(`Session index: ${invocations} local writing:rewrite invocations.`);
    console.log("Outputs display in-fork and are not persisted, so pairs come from drafts/.");
  }

  const drafts = await loadDrafts(argv.flags.drafts);
  const candidates = drafts.map(toItem);
  const selected = selectSample(candidates, argv.flags.limit);

  await mkdir(dirname(argv.flags.out), { recursive: true });
  await Bun.write(argv.flags.out, `${JSON.stringify(selected, null, 2)}\n`);

  const byCategory: Record<string, number> = {};
  for (const s of selected) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;

  console.log(`Wrote ${selected.length} samples to ${argv.flags.out}`);
  for (const [category, n] of Object.entries(byCategory)) console.log(`  ${category}: ${n}`);
}

if (import.meta.main) main();
