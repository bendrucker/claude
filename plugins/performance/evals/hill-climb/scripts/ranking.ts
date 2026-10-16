import { z } from "zod";

export const Truth = z.object({
  kind: z.literal("ranking").default("ranking"),
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
