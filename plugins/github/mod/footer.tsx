import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import type { Part, Tone } from "./pr.ts";

export interface Chip {
  key: string;
  pr: number;
  url: string;
  /** statusPartsOf's lead (`author`/`agent`/`review`/`merging`/`ci`); undefined for a merged or closed PR. */
  lead: Part | undefined;
  /** statusPartsOf's parts, most significant first. */
  parts: Part[];
  /** A block, a failing check, or the author's turn. */
  needsAuthor: boolean;
  isBranch: boolean;
  /** False when the native badge already shows `#pr`, so the label text is dropped and only parts draw. */
  isLabelled: boolean;
}

export type Tier = "lead" | "full" | "mark" | "id";

export interface Placed {
  chip: Chip;
  tier: Tier;
  /** `#pr`, toned by the lead (or "subtle" without one); undefined when `!chip.isLabelled`. */
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

// Octicon glyphs are single-cell code points, so cells are code points here.
export function cellsOf(text: string): number {
  // oxlint-disable-next-line typescript/no-misused-spread
  return [...text].length;
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
const countText = (count: number): string => `${count} PR`;

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
  chips.toSorted((a, b) => priorityOf(a) - priorityOf(b) || a.pr - b.pr);

function place(chip: Chip, tier: Tier): Placed {
  const label: Part | undefined = chip.isLabelled
    ? { text: `#${chip.pr}`, tone: chip.lead?.tone ?? "subtle" }
    : undefined;
  return { chip, tier, label, parts: partsAt(chip, tier) };
}

function partsAt(chip: Chip, tier: Tier): Part[] {
  switch (tier) {
    case "lead":
      return chip.lead
        ? [
            chip.lead,
            ...(chip.parts.length > 0 ? [{ text: "│", tone: "subtle" as const }] : []),
            ...chip.parts,
          ]
        : chip.parts;
    case "full":
      return chip.parts;
    case "mark": {
      let best: Part | undefined;
      for (const part of chip.parts)
        if (!best || rankOf(part.tone) < rankOf(best.tone)) best = part;
      return best ? [best] : [];
    }
    case "id":
      return [];
    default:
      return tier satisfies never;
  }
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

// The engine draws its line opaque, so its width is a guess: mode, model and
// effort, and the interrupt hint while a turn runs.
const ENGINE_COLUMNS = { idle: 30, working: 50 };

/** The columns left for the PRs after the engine's line and the separator. */
export function budgetOf(columns: number, isWorking: boolean): number {
  return columns - ENGINE_COLUMNS[isWorking ? "working" : "idle"] - 3;
}

/** The engine's line, then the PRs fitted to what is left of the row. */
export function drawFooter(
  $: EngineInterface,
  e: RenderInput<"PromptHint">,
  chips: readonly Chip[],
  drawn: RenderElement,
): RenderElement {
  const { Box, Text, Link } = $.ui.resolve(e);
  // JSX names the surface's Text resolved above, which the rule misses.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const spaced = (parts: RenderElement[], gap: string) =>
    parts.flatMap((part, index) => (index === 0 ? [part] : [<Text>{gap}</Text>, part]));
  const budget = budgetOf(e.viewport?.columns ?? 0, e.props.isWorking);
  const fitted = fit(chips, budget);
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const tinted = (part: Part) => <Text color={part.tone}>{part.text}</Text>;
  const groups =
    fitted.kind === "count"
      ? [tinted({ text: countText(fitted.count), tone: fitted.tone })]
      : [
          ...fitted.placed
            .filter((placed) => pieces(placed).length > 0)
            .map((placed) => (
              <Link href={placed.chip.url}>
                <Text>
                  {spaced(
                    pieces(placed).map((part) => tinted(part)),
                    " ",
                  )}
                </Text>
              </Link>
            )),
          ...(fitted.rest === undefined
            ? []
            : [tinted({ text: restText(fitted.rest.count), tone: fitted.rest.tone })]),
        ];
  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>{drawn}</Box>
      <Box flexShrink={0}>
        <Text dimColor> · </Text>
      </Box>
      <Text wrap="truncate">{spaced(groups, " ".repeat(GROUP_GAP))}</Text>
    </Box>
  );
}
