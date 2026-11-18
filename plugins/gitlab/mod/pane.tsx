import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import { OCT, type Part, SEP, type Snapshot, isOpen, statusPartsOf, turnOf } from "./mr.ts";

export const PANE = "mr";
export const MUTED = "muted";
export const REFRESH = "refresh";

/** What the watch holds for one MR that the pane shows. */
export interface Seen {
  snapshot: Snapshot | undefined;
  none: string | undefined;
  polledAt: number;
  due: number;
  error: string | undefined;
  isPolling: boolean;
  isBranch: boolean;
}

/** Every tracked MR, in the watch's order, and those that ended this session. */
export interface View {
  mrs: Seen[];
  ended: Snapshot[];
  isMutedOpen: boolean;
  isBusy: boolean;
}

/** The MR drawn in full: the first that needs its author, else the branch MR, else the first. */
export function focusOf(mrs: readonly Seen[], isBusy: boolean): Seen | undefined {
  const shown = mrs.filter((seen) => seen.snapshot !== undefined);
  const needsAuthor = (seen: Seen) => {
    const lead = seen.snapshot && statusPartsOf(seen.snapshot, isBusy).lead?.text;
    return lead === "author" || lead === "agent";
  };
  return shown.find(needsAuthor) ?? shown.find((seen) => seen.isBranch) ?? shown[0];
}

// Section labels sit in a column this wide, so their contents line up.
const LABEL = 8;

const MARK = {
  failed: { text: OCT.xCircle, tone: "error" },
  pending: { text: OCT.dotFill, tone: "warning" },
  passed: { text: OCT.checkCircle, tone: "success" },
} as const satisfies Record<string, Part>;

const ORDER = { failed: 0, pending: 1, passed: 2 } as const;

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
  const left = s.approvalsLeft;
  return kept([
    s.isChangesRequested ? { text: `${OCT.reply} changes requested`, tone: "error" } : undefined,
    left > 0
      ? {
          text: `${OCT.eye} ${left} ${left === 1 ? "approval" : "approvals"} left`,
          tone: "warning",
        }
      : undefined,
    left === 0 && s.isApproved ? { text: `${OCT.check} approved`, tone: "success" } : undefined,
    left === 0 && !s.isApproved && !s.isChangesRequested
      ? { text: "not required", tone: "subtle" }
      : undefined,
    s.approvers.length > 0
      ? { text: `approved by ${people(s.approvers)}`, tone: "subtle" }
      : undefined,
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
  const base = s.target === "" ? "the target" : s.target;
  const parts = kept([
    s.block === "conflict"
      ? { text: `${OCT.gitMerge}${OCT.x} conflicts with ${base}`, tone: "error" }
      : undefined,
    s.block === "behind" ? { text: `${OCT.arrowDown} behind ${base}`, tone: "warning" } : undefined,
    merging.kind === "queued"
      ? {
          text: `${OCT.gitMergeQueue} on the merge train, position ${merging.position}`,
          tone: "merged",
        }
      : undefined,
    merging.kind === "auto" ? { text: `${OCT.gitMerge} auto-merge on`, tone: "merged" } : undefined,
    merging.kind !== "queued" && merging.hasQueue
      ? { text: "merge trains on", tone: "subtle" }
      : undefined,
  ]);
  return parts.length > 0 ? parts : [{ text: "manual", tone: "subtle" }];
}

/** Draws what the watcher last read for each MR, and how it is polling. */
export function drawPane(
  $: EngineInterface,
  e: RenderInput,
  view: View,
  now: number,
): RenderElement {
  const { Box, Text, Button, Link } = $.ui.resolve(e);
  // JSX names the surface's Text resolved above, which the rule misses.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const tinted = (part: Part) => <Text color={part.tone}>{part.text}</Text>;
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const inline = (parts: Part[]) =>
    parts.map((part, index) => (
      <Text color={part.tone}>
        {index === 0 ? "" : SEP}
        {part.text}
      </Text>
    ));
  const section = (label: string, parts: Part[], extra: RenderElement[] = [], isInline = false) => (
    <Box flexDirection="row">
      <Box width={LABEL} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {isInline ? <Text>{inline(parts)}</Text> : parts.map(tinted)}
        {extra}
      </Box>
    </Box>
  );
  const polling = view.mrs.some((seen) => seen.isPolling);
  const polledAt = Math.min(...view.mrs.map((seen) => seen.polledAt));
  const next = Math.min(...view.mrs.map((seen) => seen.due)) - now;
  const timing = polling
    ? "refreshing…"
    : `polled ${since(now - polledAt)} · next ${next >= 60_000 ? `in ${ago(next)}` : "soon"}`;
  const footer = (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text dimColor>{timing}</Text>
      <Button key={REFRESH} plain dimColor hotkey="r" label="refresh" onPress={() => undefined} />
    </Box>
  );
  const ended = view.ended.length > 0 && (
    <Box marginTop={1}>
      {section(
        "Ended",
        [],
        [
          <Text>
            {view.ended.map((s, index) => (
              <Text dimColor>
                {index === 0 ? "" : SEP}
                <Link href={s.url}>!{s.mr}</Link> {s.state}
              </Text>
            ))}
          </Text>,
        ],
      )}
    </Box>
  );
  const focus = focusOf(view.mrs, view.isBusy);
  if (focus?.snapshot === undefined) {
    const none = view.mrs.find((seen) => seen.isBranch)?.none;
    return (
      <Box flexDirection="column">
        <Text>No merge request for this branch</Text>
        {none === undefined ? undefined : <Text dimColor>{none}</Text>}
        {ended}
        {footer}
      </Box>
    );
  }
  const heading = (seen: Seen, s: Snapshot) => {
    const status = statusPartsOf(s, view.isBusy, seen.error !== undefined);
    return [
      <Text weight="semibold">
        <Link href={s.url}>
          !{s.mr}
          {s.title === "" ? "" : ` ${s.title}`}
        </Link>
      </Text>,
      <Text>
        {status.lead === undefined ? undefined : (
          <Text weight="semibold" color={status.lead.tone}>
            {status.lead.text}
            {"  "}
          </Text>
        )}
        {inline(status.parts)}
      </Text>,
    ];
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const failure = (seen: Seen) =>
    seen.error === undefined ? undefined : (
      <Text color="warning">
        {OCT.alert} last poll failed: {seen.error}
      </Text>
    );
  const s = focus.snapshot;
  const failing = s.checks.filter((check) => check.outcome !== "passed");
  const rest = view.mrs.filter((seen) => seen !== focus && seen.snapshot !== undefined);
  return (
    <Box flexDirection="column">
      {heading(focus, s)}
      {isOpen(s) && (
        <Box flexDirection="column" marginTop={1}>
          {section(
            "Jobs",
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
                  label={`${view.isMutedOpen ? "▾" : "▸"} ${s.muted.length} bot ${s.muted.length === 1 ? "comment" : "comments"}`}
                  onPress={() => undefined}
                />,
                ...(view.isMutedOpen
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
      {failure(focus)}
      {rest.map((seen) =>
        seen.snapshot === undefined ? undefined : (
          <Box flexDirection="column" marginTop={1}>
            {heading(seen, seen.snapshot)}
            {failure(seen)}
          </Box>
        ),
      )}
      {ended}
      {footer}
    </Box>
  );
}
