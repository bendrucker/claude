import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import { OCT, type Part, type Snapshot, statusPartsOf, turnOf } from "./pr.ts";

export const PANE = "pr";
export const MUTED = "muted";
export const REFRESH = "refresh";

/** What the watch holds that the pane shows. */
export interface Seen {
  snapshot: Snapshot | undefined;
  none: string | undefined;
  polledAt: number;
  due: number;
  error: string | undefined;
  isMutedOpen: boolean;
  isBusy: boolean;
  isPolling: boolean;
}

// Section labels sit in a column this wide, so their contents line up.
const LABEL = 8;

const MARK = {
  failed: { text: OCT.xCircle, tone: "error" },
  pending: { text: OCT.dotFill, tone: "warning" },
  passed: { text: OCT.checkCircle, tone: "success" },
} as const satisfies Record<string, Part>;

const ORDER = { failed: 0, pending: 1, passed: 2 } as const;

const DECISIONS: Record<string, Part> = {
  APPROVED: { text: `${OCT.check} approved`, tone: "success" },
  CHANGES_REQUESTED: { text: `${OCT.reply} changes requested`, tone: "error" },
  REVIEW_REQUIRED: { text: `${OCT.eye} review required`, tone: "warning" },
};

function ago(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  if (minutes < 1) return "";
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 6) / 10}h`;
}

const kept = (parts: (Part | undefined)[]): Part[] => parts.filter((part) => part !== undefined);

const since = (ms: number) => (ms < 60_000 ? "just now" : `${ago(ms)} ago`);

const people = (names: string[]) => names.map((name) => `@${name}`).join(", ");

function checkParts(s: Snapshot): Part[] {
  const passed = s.total - s.pending - s.failed.length;
  if (s.total === 0) return [{ text: "none reported", tone: "subtle" }];
  if (passed === s.total)
    return [{ text: `${OCT.checkCircle} all ${s.total} passed`, tone: "success" }];
  return kept([
    s.failed.length > 0
      ? { text: `${OCT.xCircle} ${s.failed.length} failed`, tone: "error" }
      : undefined,
    s.pending > 0 ? { text: `${OCT.dotFill} ${s.pending} running`, tone: "warning" } : undefined,
    passed > 0 ? { text: `${OCT.checkCircle} ${passed} passed`, tone: "subtle" } : undefined,
  ]);
}

function reviewParts(s: Snapshot): Part[] {
  const { turn, waiting } = turnOf(s);
  return kept([
    DECISIONS[s.reviewDecision] ?? { text: "not required", tone: "subtle" },
    turn === "author" && waiting.length > 0
      ? { text: `requested by ${people(waiting)}`, tone: "subtle" }
      : undefined,
    turn === "reviewer"
      ? { text: `${OCT.hourglass} waiting on ${people(waiting)}`, tone: "suggestion" }
      : undefined,
    s.threads > 0
      ? {
          text: `${OCT.commentDiscussion} ${s.threads} unresolved ${s.threads === 1 ? "thread" : "threads"}`,
          tone: "suggestion",
        }
      : undefined,
  ]);
}

function mergeParts(s: Snapshot): Part[] {
  const { merging } = s;
  const base = s.base === "" ? "the base" : s.base;
  const parts = kept([
    s.block === "conflict"
      ? { text: `${OCT.gitMerge}${OCT.x} conflicts with ${base}`, tone: "error" }
      : undefined,
    s.block === "behind" ? { text: `${OCT.arrowDown} behind ${base}`, tone: "warning" } : undefined,
    merging.kind === "queued"
      ? { text: `${OCT.gitMergeQueue} queued, position ${merging.position}`, tone: "merged" }
      : undefined,
    merging.kind === "auto" ? { text: `${OCT.gitMerge} auto-merge on`, tone: "merged" } : undefined,
    merging.kind !== "queued" && merging.hasQueue
      ? { text: `${base} has a merge queue`, tone: "subtle" }
      : undefined,
  ]);
  return parts.length > 0 ? parts : [{ text: "manual", tone: "subtle" }];
}

/** Draws what the watcher last read, and how it is polling. */
export function drawPane(
  $: EngineInterface,
  e: RenderInput,
  seen: Seen,
  now: number,
): RenderElement {
  const { Box, Text, Button, Link } = $.ui.resolve(e);
  // JSX names the surface's Text resolved above, which the rule misses.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const tinted = (part: Part) => <Text color={part.tone}>{part.text}</Text>;
  const section = (label: string, parts: Part[], extra: RenderElement[] = [], isInline = false) => (
    <Box flexDirection="row">
      <Box width={LABEL} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {isInline ? (
          <Text>
            {parts.map((part, index) => (
              <Text color={part.tone}>
                {index === 0 ? "" : "  "}
                {part.text}
              </Text>
            ))}
          </Text>
        ) : (
          parts.map(tinted)
        )}
        {extra}
      </Box>
    </Box>
  );
  const s = seen.snapshot;
  const next = seen.due - now;
  const timing = seen.isPolling
    ? "refreshing…"
    : `polled ${since(now - seen.polledAt)} · next ${next >= 60_000 ? `in ${ago(next)}` : "soon"}`;
  const footer = (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text dimColor>{timing}</Text>
      <Button key={REFRESH} plain dimColor hotkey="r" label="refresh" onPress={() => undefined} />
    </Box>
  );
  if (s === undefined) {
    return (
      <Box flexDirection="column">
        <Text>No pull request for this branch</Text>
        {seen.none === undefined ? undefined : <Text dimColor>{seen.none}</Text>}
        {footer}
      </Box>
    );
  }
  const status = statusPartsOf(s, seen.isBusy, seen.error !== undefined);
  const isOpen = s.state === "OPEN";
  const failing = s.checks.filter((check) => check.outcome !== "passed");
  return (
    <Box flexDirection="column">
      <Text weight="semibold">
        <Link href={s.url}>
          #{s.pr}
          {s.title === "" ? "" : ` ${s.title}`}
        </Link>
      </Text>
      <Text>
        {status.lead === undefined ? undefined : (
          <Text weight="semibold" color={status.lead.tone}>
            {status.lead.text}
            {"  "}
          </Text>
        )}
        {status.parts.map((part, index) => (
          <Text color={part.tone}>
            {index === 0 ? "" : "  "}
            {part.text}
          </Text>
        ))}
      </Text>
      {isOpen && (
        <Box flexDirection="column" marginTop={1}>
          {section(
            "Checks",
            checkParts(s),
            failing
              .toSorted((a, b) => ORDER[a.outcome] - ORDER[b.outcome])
              .map((check) => (
                <Text>
                  {tinted(MARK[check.outcome])} {check.label}
                </Text>
              )),
            true,
          )}
          {section("Review", reviewParts(s))}
          {section("Merge", mergeParts(s))}
          {s.muted.length > 0 &&
            section(
              "Muted",
              [],
              [
                <Button
                  key={MUTED}
                  plain
                  dimColor
                  hotkey="m"
                  label={`${seen.isMutedOpen ? "▾" : "▸"} ${s.muted.length} bot ${s.muted.length === 1 ? "comment" : "comments"}`}
                  onPress={() => undefined}
                />,
                ...(seen.isMutedOpen
                  ? s.muted.map((m) => (
                      <Text dimColor>
                        {"  "}
                        {m.author} · {m.reason}
                      </Text>
                    ))
                  : []),
              ],
            )}
        </Box>
      )}
      {seen.error !== undefined && (
        <Text color="warning">
          {OCT.alert} last poll failed: {seen.error}
        </Text>
      )}
      {footer}
    </Box>
  );
}
