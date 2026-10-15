#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { table } from "table";
import { z } from "zod";
import { measureStructure, type Structure } from "../structure";

// Which structural metrics move consistently when Ben revises a Claude body.
// A metric earns a place in the score when revisions push it one way far more
// often than the other.

const Version = z.object({ by: z.string(), body: z.string(), prompt: z.string().optional() });
const Revision = z.object({
  source: z.string(),
  url: z.string(),
  edited: z.boolean(),
  claude_revised: z.boolean().optional(),
  via_skill: z.boolean().nullable().optional(),
  session_id: z.string().nullable().optional(),
  draft: z.string(),
  final: z.string(),
  versions: z.array(Version),
});
type Revision = z.infer<typeof Revision>;

const Handwritten = z.object({ body: z.string() });

const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

const TRIM_PROMPT =
  /trim|shorten|short|tight|too long|bloat|\bcut\b|slim|wall|concise|verbose|excessive|length/i;

export interface Pair {
  set: "hand-edit" | "directed";
  url: string;
  viaSkill: boolean | null;
  before: string;
  after: string;
}

export function pairsOf(r: Revision): Pair[] {
  const viaSkill = r.via_skill ?? null;
  if (r.edited)
    return [{ set: "hand-edit", url: r.url, viaSkill, before: r.draft, after: r.final }];
  const claude = r.versions.filter((v) => v.by === "claude");
  const pairs: Pair[] = [];
  for (let i = 1; i < claude.length; i++) {
    const prompt = claude[i]?.prompt ?? "";
    const before = claude[i - 1]?.body;
    const after = claude[i]?.body;
    if (before !== undefined && after !== undefined && TRIM_PROMPT.test(prompt)) {
      pairs.push({ set: "directed", url: r.url, viaSkill, before, after });
    }
  }
  return pairs;
}

const median = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b);
  return s.length > 0 ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
};

export interface MetricFit {
  metric: keyof Structure;
  n: number;
  down: number;
  same: number;
  up: number;
  before: number;
  after: number;
}

export function fit(pairs: Pair[]): MetricFit[] {
  const measured = pairs.map(
    (p) => [measureStructure(p.before), measureStructure(p.after)] as const,
  );
  const first = measured[0];
  if (!first) return [];
  const sample = first[0];
  const isMetric = (k: string): k is keyof Structure => k in sample;
  return Object.keys(sample)
    .filter(isMetric)
    .map((metric) => {
      let down = 0;
      let up = 0;
      let same = 0;
      for (const [b, a] of measured) {
        const d = a[metric] - b[metric];
        if (Math.abs(d) < 1e-9) same++;
        else if (d < 0) down++;
        else up++;
      }
      return {
        metric,
        n: measured.length,
        down,
        same,
        up,
        before: median(measured.map(([b]) => b[metric])),
        after: median(measured.map(([, a]) => a[metric])),
      };
    });
}

// P(a random Claude body scores above a random human body). 1.0 means the
// metric separates them perfectly, 0.5 means it carries no signal.
export function auc(claude: number[], human: number[]): number {
  let wins = 0;
  for (const c of claude) {
    for (const h of human) {
      if (c > h) wins += 1;
      else if (c === h) wins += 0.5;
    }
  }
  return claude.length * human.length > 0 ? wins / (claude.length * human.length) : 0.5;
}

function separate(claude: string[], human: string[]): string {
  const c = claude.map(measureStructure);
  const h = human.map(measureStructure);
  const sample = c[0];
  if (!sample) return "";
  const isMetric = (k: string): k is keyof Structure => k in sample;
  const rows = Object.keys(sample)
    .filter(isMetric)
    .map((m) => {
      const cv = c.map((x) => x[m]);
      const hv = h.map((x) => x[m]);
      return { m, a: auc(cv, hv), cm: median(cv), hm: median(hv) };
    })
    .toSorted((x, y) => Math.abs(y.a - 0.5) - Math.abs(x.a - 0.5))
    .map((r) => [r.m, r.a.toFixed(2), r.cm.toFixed(1), r.hm.toFixed(1)]);
  return `separation: claude n=${c.length}, human n=${h.length}\n${table([["metric", "auc", "claude median", "human median"], ...rows])}`;
}

const pct = (x: number, n: number) => `${Math.round((100 * x) / n)}%`;

function render(title: string, fits: MetricFit[]): string {
  const rows = fits
    .toSorted((a, b) => Math.abs(b.down - b.up) - Math.abs(a.down - a.up))
    .map((f) => [
      f.metric,
      pct(f.down, f.n),
      pct(f.same, f.n),
      pct(f.up, f.n),
      f.before.toFixed(1),
      f.after.toFixed(1),
    ]);
  return `${title} (n=${fits[0]?.n ?? 0})\n${table([["metric", "down", "same", "up", "median before", "median after"], ...rows])}`;
}

const program = new Command()
  .argument("<files...>", "revision jsonl files")
  .option("--via-skill", "only pairs whose draft came from pull-request:create")
  .option(
    "--human <file>",
    "hand-written bodies (jsonl with a body field) to separate Claude drafts from",
  )
  .action(async (files, opts) => {
    const texts = await Promise.all(files.map((f) => Bun.file(f).text()));
    const records = texts.flatMap((t) => lines(t).map((l) => Revision.parse(JSON.parse(l))));
    const pairs = records
      .flatMap(pairsOf)
      .filter((p) => opts.viaSkill !== true || p.viaSkill === true);
    for (const set of ["hand-edit", "directed"] as const) {
      const subset = pairs.filter((p) => p.set === set);
      if (subset.length > 0) console.log(render(set, fit(subset)));
    }
    if (opts.human !== undefined) {
      const human = lines(await Bun.file(opts.human).text()).map(
        (l) => Handwritten.parse(JSON.parse(l)).body,
      );
      const drafts = records
        .filter((r) => opts.viaSkill !== true || r.via_skill === true)
        .flatMap((r) => r.versions.find((v) => v.by === "claude")?.body ?? []);
      const edits = pairs.filter((p) => p.set === "hand-edit").map((p) => p.after);
      console.log(separate(drafts, [...human, ...edits]));
    }
  });

if (import.meta.main) await program.parseAsync();
