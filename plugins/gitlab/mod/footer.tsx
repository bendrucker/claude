import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import { type Part, type Snapshot, type Tone, statusOf, statusPartsOf } from "./mr.ts";

export interface Chip {
  key: string;
  iid: number;
  url: string;
  /** statusPartsOf's lead (`author`/`agent`/`review`/`merging`/`ci`); undefined for a merged or closed MR. */
  lead: Part | undefined;
  /** statusPartsOf's parts, most significant first. */
  parts: Part[];
  /** A block, a failing pipeline, or the author's turn. */
  needsAuthor: boolean;
  isBranch: boolean;
  /** False when the engine's hint already shows `!iid`, so the lead word stands in for it. */
  isLabelled: boolean;
}

export type Tier = "lead" | "full" | "mark" | "id";

export interface Placed {
  chip: Chip;
  tier: Tier;
  /** `!iid` toned by the lead, or the lead word itself when the engine already shows `!iid`. */
  label: Part | undefined;
  /** What follows the label, drawn one space apart. */
  parts: Part[];
}

export type Fitted =
  | { kind: "chips"; placed: Placed[]; rest: { count: number; tone: Tone } | undefined }
  | { kind: "count"; count: number; tone: Tone };

export const URGENCY: readonly Tone[] = [
  "error",
  "warning",
  "claude",
  "suggestion",
  "merged",
  "success",
  "subtle",
];

const TIERS: readonly Tier[] = ["lead", "full", "mark", "id"];
const MIN_BUDGET = 8;
const GROUP_GAP = 2;

const graphemes = new Intl.Segmenter();

export function cellsOf(text: string): number {
  return [...graphemes.segment(text)].length;
}

const rankOf = (tone: Tone): number => URGENCY.indexOf(tone);

function mostUrgent(tones: Iterable<Tone>): Tone {
  let best: Tone = "subtle";
  for (const tone of tones) if (rankOf(tone) < rankOf(best)) best = tone;
  return best;
}

const tonesOf = (chip: Chip): Tone[] =>
  [...(chip.lead ? [chip.lead] : []), ...chip.parts].map((part) => part.tone);

const restText = (count: number): string => `+${count}`;
const countText = (count: number): string => `${count} MR`;

const pieces = (placed: Placed): Part[] => [
  ...(placed.label ? [placed.label] : []),
  ...placed.parts,
];

function groupWidth(placed: Placed): number {
  const all = pieces(placed);
  return all.reduce((sum, part) => sum + cellsOf(part.text), 0) + Math.max(0, all.length - 1);
}

export function widthOf(fitted: Fitted): number {
  if (fitted.kind === "count") return cellsOf(countText(fitted.count));
  const groups = fitted.placed.map(groupWidth);
  const rest = fitted.rest ? [cellsOf(restText(fitted.rest.count))] : [];
  const all = [...groups, ...rest];
  return all.reduce((sum, width) => sum + width, 0) + GROUP_GAP * Math.max(0, all.length - 1);
}

function priorityOf(chip: Chip): number {
  if (chip.needsAuthor) return 0;
  return chip.isBranch ? 1 : 2;
}

const displayOrder = (chips: readonly Chip[]): Chip[] =>
  chips.toSorted((a, b) => priorityOf(a) - priorityOf(b) || a.iid - b.iid);

function place(chip: Chip, tier: Tier): Placed {
  const parts = partsAt(chip, tier);
  if (!chip.isLabelled) {
    return { chip, tier, label: chip.lead, parts: tier === "lead" ? parts.slice(1) : parts };
  }
  const label: Part = { text: `!${chip.iid}`, tone: chip.lead?.tone ?? "subtle" };
  return { chip, tier, label, parts };
}

function partsAt(chip: Chip, tier: Tier): Part[] {
  if (tier === "full") return chip.parts;
  if (tier === "lead") {
    if (chip.lead === undefined) return chip.parts;
    const bar = chip.parts.length > 0 ? [{ text: "│", tone: "subtle" as const }] : [];
    return [chip.lead, ...bar, ...chip.parts];
  }
  if (tier === "mark") {
    let best: Part | undefined;
    for (const part of chip.parts) if (!best || rankOf(part.tone) < rankOf(best.tone)) best = part;
    return best ? [best] : [];
  }
  return [];
}

export function fit(chips: readonly Chip[], budget: number): Fitted {
  if (chips.length === 0) return { kind: "chips", placed: [], rest: undefined };
  const count = (): Fitted => ({
    kind: "count",
    count: chips.length,
    tone: mostUrgent(chips.flatMap(tonesOf)),
  });
  if (budget < MIN_BUDGET) return count();

  const ordered = displayOrder(chips);
  const start = ordered.length === 1 && ordered[0]?.lead ? 0 : 1;
  const tiers: number[] = ordered.map(() => start);
  let shown = ordered.length;

  const last = TIERS.length - 1;
  const build = (): Fitted => {
    const placed = ordered
      .slice(0, shown)
      .map((chip, i) => place(chip, TIERS[tiers[i] ?? last] ?? "id"));
    const hidden = ordered.slice(shown);
    return {
      kind: "chips",
      placed,
      rest:
        hidden.length > 0
          ? { count: hidden.length, tone: mostUrgent(hidden.flatMap(tonesOf)) }
          : undefined,
    };
  };

  while (widthOf(build()) > budget) {
    const richest = Math.min(...tiers.slice(0, shown));
    if (richest < last) {
      const index = tiers.findLastIndex((tier, i) => i < shown && tier === richest);
      tiers[index] = richest + 1;
    } else if (shown > 0) {
      shown--;
    } else {
      return count();
    }
  }
  const fitted = build();
  return fitted.kind === "chips" && fitted.placed.length === 0 ? count() : fitted;
}

export interface Entry {
  snapshot: Snapshot;
  isBranch: boolean;
  isStale: boolean;
}

/** The plain footer text, for a surface that measures no width. A lone branch MR keeps the bare status. */
export function tailOf(entries: readonly Entry[], isBusy: boolean): string {
  const [only] = entries;
  if (only !== undefined && entries.length === 1 && only.isBranch) {
    return statusOf(only.snapshot, isBusy, only.isStale);
  }
  return entries
    .map(({ snapshot, isStale }) =>
      `!${snapshot.mr} ${statusOf(snapshot, isBusy, isStale)}`.trimEnd(),
    )
    .join(" · ");
}

export function chipsOf(entries: readonly Entry[], isBusy: boolean, hint: string): Chip[] {
  return entries.map(({ snapshot, isBranch, isStale }) => {
    const { lead, parts } = statusPartsOf(snapshot, isBusy, isStale);
    return {
      key: snapshot.url,
      iid: snapshot.mr,
      url: snapshot.url,
      lead,
      parts,
      needsAuthor: lead?.text === "author" || lead?.text === "agent",
      isBranch,
      // The engine's own MR badge already links the branch MR.
      isLabelled: !(isBranch && new RegExp(`!${snapshot.mr}(?!\\d)`).test(hint)),
    };
  });
}

const JOIN = " · ";

// The indent, the widest common permission pill (`⏵⏵ accept edits on`), and its separator.
const ROW_RESERVE = 25;

// The right-hand mode labels, which a hook here can't read, such as `opus · medium`.
const MODES_RESERVE = 16;

export const budgetOf = (columns: number, hint: string): number =>
  columns - ROW_RESERVE - MODES_RESERVE - cellsOf(hint) - cellsOf(JOIN);

export function drawFooter(
  $: EngineInterface,
  e: RenderInput,
  drawn: RenderElement,
  fitted: Fitted,
): RenderElement {
  const { Box, Text, Link } = $.ui.resolve(e);
  const groups =
    fitted.kind === "count"
      ? [<Text color={fitted.tone}>{`${fitted.count} MR`}</Text>]
      : [
          ...fitted.placed.map(({ chip, label, parts }) => (
            <Text>
              {label === undefined ? undefined : (
                <Link href={chip.url}>
                  <Text color={label.tone}>{label.text}</Text>
                </Link>
              )}
              {parts.map((part, index) => (
                <Text color={part.tone}>
                  {index === 0 && label === undefined ? "" : " "}
                  {part.text}
                </Text>
              ))}
            </Text>
          )),
          ...(fitted.rest === undefined
            ? []
            : [<Text color={fitted.rest.tone}>{`+${fitted.rest.count}`}</Text>]),
        ];
  return (
    <Box flexDirection="row">
      {drawn}
      <Text dimColor>{JOIN}</Text>
      {groups.map((group, index) => (
        <Text>
          {index === 0 ? "" : "  "}
          {group}
        </Text>
      ))}
    </Box>
  );
}
