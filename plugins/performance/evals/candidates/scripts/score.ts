#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { mean } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { pValue } from "../../../../../evals/native/compare";
import { traceReply } from "../../../../../evals/native/load";

export const Truth = z.object({
  profile: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      label: z.enum(["win", "trap"]),
      gain: z.number(),
      profile_entry: z.string(),
      note: z.string(),
      patterns: z.array(z.string()),
    }),
  ),
  parallelism: z.array(z.string()),
});
export type Truth = z.output<typeof Truth>;

export const RECALL_AT = 5;
export const TRAP_RANKS = 2;
export const TRAP_PENALTY = 0.5;

export interface Block {
  kind: "numbered" | "table" | "bullet";
  entries: string[];
}

const NUMBERED = /^(\d+)[.)]\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_RULE = /^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/;
const HEADING = /^#{1,6}\s/;

function append(block: Block, text: string) {
  const last = block.entries.length - 1;
  block.entries[last] = `${block.entries[last] ?? ""}\n${text}`;
}

/** Top-level lists in a markdown reply, each item with its continuation lines. */
export function listBlocks(reply: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  let lastRank = 0;
  let gap = false;
  const open = (kind: Block["kind"]): Block => {
    const block: Block = { kind, entries: [] };
    blocks.push(block);
    return block;
  };

  for (const line of reply.split("\n")) {
    if (line.trim() === "") {
      gap = true;
      continue;
    }
    const numbered = NUMBERED.exec(line);
    const row = TABLE_ROW.exec(line);
    if (numbered !== null) {
      const rank = Number(numbered[1]);
      if (current?.kind !== "numbered" || rank <= lastRank) current = open("numbered");
      current.entries.push(numbered[2] ?? "");
      lastRank = rank;
    } else if (row !== null) {
      if (TABLE_RULE.test(line)) continue;
      const cells = (row[1] ?? "").split("|").map((c) => c.trim());
      const rank = Number((cells[0] ?? "").replaceAll(/[*_`#]/g, ""));
      if (!Number.isInteger(rank) || rank < 1) continue;
      if (current?.kind !== "table" || rank <= lastRank) current = open("table");
      current.entries.push(cells.slice(1).join(" | "));
      lastRank = rank;
    } else if (BULLET.test(line)) {
      if (current?.kind !== "bullet") current = open("bullet");
      current.entries.push(BULLET.exec(line)?.[1] ?? "");
    } else if (HEADING.test(line) || current === undefined || current.kind === "table") {
      current = undefined;
    } else if (/^\s/.test(line) || !gap) {
      append(current, line.trim());
    } else {
      current = undefined;
    }
    gap = false;
  }
  return blocks;
}

const matcher = (patterns: string[]) => {
  const res = patterns.map((p) => new RegExp(p, "i"));
  return (text: string) => res.some((re) => re.test(text));
};

/** The list holding the most planted items, preferring a ranked list, then the later one. */
export function candidateList(blocks: Block[], truth: Truth): string[] {
  const named = matcher(truth.items.flatMap((i) => i.patterns));
  let best: Block | undefined;
  let bestKey = -1;
  for (const block of blocks) {
    const hits = block.entries.filter(named).length;
    const key = hits * 2 + (block.kind === "bullet" ? 0 : 1);
    if (hits > 0 && key >= bestKey) {
      best = block;
      bestKey = key;
    }
  }
  return best?.entries ?? [];
}

/**
 * The 1-based rank of each planted item in the list. A trap counts only on an entry that names
 * no win, so a win that dismisses a trap in passing does not rank the trap.
 */
export function itemRanks(entries: string[], truth: Truth): Map<string, number | undefined> {
  const wins = matcher(truth.items.filter((i) => i.label === "win").flatMap((i) => i.patterns));
  return new Map(
    truth.items.map((item) => {
      const named = matcher(item.patterns);
      const i = entries.findIndex((e) => named(e) && (item.label === "win" || !wins(e)));
      return [item.id, i === -1 ? undefined : i + 1];
    }),
  );
}

const normalize = (text: string) => text.replaceAll("`", "").replaceAll(/\(\*?([^()]*)\)/g, "$1");

/** Function names and percentages from a pprof `top` listing that count as citing it. */
export function profileRefs(profile: string): { names: string[]; percents: string[] } {
  const row = /^\s*(\S+)\s+(\S+%)\s+(\S+%)\s+(\S+)\s+(\S+%)\s+(.+?)(\s+\(inline\))?\s*$/;
  const names = new Set<string>();
  const percents = new Set<string>();
  for (const line of profile.split("\n")) {
    const m = row.exec(line);
    if (m === null) continue;
    const symbol = normalize(m[6] ?? "");
    const segments = symbol.split(/[./]/);
    names.add(symbol);
    if (segments.length >= 2) names.add(segments.slice(-2).join("."));
    const last = segments.at(-1) ?? "";
    if (last.length >= 6) names.add(last);
    for (const p of [m[2], m[5]]) {
      if (p === undefined || p === "0%") continue;
      percents.add(p);
      percents.add(p.replace(/0%$/, "%"));
    }
  }
  return { names: [...names], percents: [...percents] };
}

const escape = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export function cites(entry: string, refs: ReturnType<typeof profileRefs>): boolean {
  const text = normalize(entry);
  return (
    refs.names.some((n) => new RegExp(`(?<![\\w])${escape(n)}(?![\\w])`, "i").test(text)) ||
    refs.percents.some((p) => new RegExp(`(?<![\\d.])${escape(p)}`).test(text))
  );
}

export interface Score {
  /** Gain-weighted share of the planted wins ranked in the first `RECALL_AT`. */
  recall: number;
  /** Traps ranked in the first `TRAP_RANKS`. */
  traps: string[];
  /** Share of the candidate list's entries that name a profile entry. */
  cited: number;
  /** Whether any list item weighs parallelism. */
  parallelism: boolean;
  /** `recall` less `TRAP_PENALTY` per trap in the first `TRAP_RANKS`. */
  composite: number;
  ranks: Record<string, number | null>;
  size: number;
}

export function scoreReply(reply: string, truth: Truth, profile: string): Score {
  const blocks = listBlocks(reply);
  const entries = candidateList(blocks, truth);
  const ranks = itemRanks(entries, truth);
  const within = (id: string, n: number) => (ranks.get(id) ?? Infinity) <= n;
  const wins = truth.items.filter((i) => i.label === "win");
  const total = wins.reduce((sum, i) => sum + i.gain, 0);
  const recall =
    wins.filter((i) => within(i.id, RECALL_AT)).reduce((sum, i) => sum + i.gain, 0) / total;
  const traps = truth.items
    .filter((i) => i.label === "trap" && within(i.id, TRAP_RANKS))
    .map((i) => i.id);
  const refs = profileRefs(profile);
  const cited =
    entries.length === 0 ? 0 : entries.filter((e) => cites(e, refs)).length / entries.length;
  const parallel = matcher(truth.parallelism);
  return {
    recall,
    traps,
    cited,
    parallelism: blocks.some((b) => b.entries.some(parallel)),
    composite: recall - TRAP_PENALTY * traps.length,
    ranks: Object.fromEntries([...ranks].map(([id, r]) => [id, r ?? null])),
    size: entries.length,
  };
}

export interface ScoredRun extends Score {
  case: string;
  arm: string;
  run: number;
}

const TRACE = /^(.+)-([^-]+)-(\d+)\.jsonl$/;

/** Scores every trace under `<results>/traces/` against its case's truth. */
export async function scoreResults(suite: string, results: string): Promise<ScoredRun[]> {
  const files = globSync("traces/*.jsonl", { cwd: results }).toSorted();
  const runs = files.map(async (file) => {
    const m = TRACE.exec(basename(file));
    if (m === null) return [];
    const [, name = "", arm = "", n = "0"] = m;
    const truth = Truth.parse(await Bun.file(join(suite, name, "truth.json")).json());
    const profile = await Bun.file(join(suite, name, truth.profile)).text();
    const reply = traceReply(await Bun.file(join(results, file)).text()) ?? "";
    return [{ case: name, arm, run: Number(n), ...scoreReply(reply, truth, profile) }];
  });
  return (await Promise.all(runs)).flat();
}

const fixed = (x: number) => x.toFixed(2);

export function render(runs: ScoredRun[]): string {
  const head = ["case", "arm", "run", "recall@5", "traps top 2", "cited", "parallel", "composite"];
  const rows = runs.map((r) => [
    r.case,
    r.arm,
    String(r.run),
    fixed(r.recall),
    r.traps.length === 0 ? "-" : r.traps.join(", "),
    fixed(r.cited),
    r.parallelism ? "yes" : "no",
    fixed(r.composite),
  ]);
  const names = [...new Set(runs.map((r) => r.case))].toSorted();
  const arms = [...new Set(runs.map((r) => r.arm))].toSorted();
  const of = (name: string, arm: string) => runs.filter((r) => r.case === name && r.arm === arm);
  const avg = (rs: ScoredRun[], pick: (r: ScoredRun) => number) =>
    rs.length === 0 ? "-" : fixed(mean(rs.map(pick)));
  const summary = names.flatMap((name) =>
    arms.map((arm) => {
      const rs = of(name, arm);
      return [
        name,
        arm,
        String(rs.length),
        avg(rs, (r) => r.recall),
        avg(rs, (r) => r.traps.length),
        avg(rs, (r) => r.cited),
        avg(rs, (r) => (r.parallelism ? 1 : 0)),
        avg(rs, (r) => r.composite),
      ];
    }),
  );
  const summaryHead = ["case", "arm", "runs", ...head.slice(3)];
  const out = [table([head, ...rows]), table([summaryHead, ...summary])];
  const [base, other] = arms;
  if (base === undefined || other === undefined) return out.join("\n");
  for (const name of names) {
    const p = (pick: (r: ScoredRun) => number) =>
      pValue(of(name, base).map(pick), of(name, other).map(pick)).toFixed(3);
    out.push(
      `${name} ${other} vs ${base}: permutation p = ${p((r) => r.composite)} composite, ${p((r) => r.cited)} cited`,
    );
  }
  return out.join("\n");
}

export const program = new Command("score.ts")
  .description("Score candidate lists in claude plugin eval results against each case's truth.json")
  .argument("<results...>", "results directories holding traces/")
  .option("--json", "Print the scored runs as JSON")
  .action(async (results, { json }) => {
    const suite = join(import.meta.dir, "..");
    const runs = (await Promise.all(results.map((r) => scoreResults(suite, r)))).flat();
    console.log(json === true ? JSON.stringify(runs, null, 2) : render(runs));
  });

if (import.meta.main) await program.parseAsync();
