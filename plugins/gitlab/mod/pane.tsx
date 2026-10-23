import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import { type Snapshot, turnOf } from "./mr.ts";

export const PANE = "mr";
export const MUTED = "muted";

/** What the watch holds that the pane shows. */
export interface Seen {
  snapshot: Snapshot | undefined;
  line: string | undefined;
  none: string | undefined;
  polledAt: number;
  due: number;
  streak: number;
  error: string | undefined;
  via: string | undefined;
  isMutedOpen: boolean;
}

const MARK = { passed: "✓", failed: "✗", pending: "○" } as const;
const ORDER = { failed: 0, pending: 1, passed: 2 } as const;

function ago(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 1) return "now";
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 6) / 10}h`;
}

const people = (names: string[]) => names.map((name) => `@${name}`).join(", ");

function reviewLines(s: Snapshot): string[] {
  const { turn, waiting } = turnOf(s);
  const lines = [s.approvalsLeft > 0 ? `${s.approvalsLeft} approvals left` : "approvals met"];
  if (s.approvers.length > 0) lines.push(`approved by ${people(s.approvers)}`);
  if (turn === "author" && waiting.length > 0)
    lines.push(`changes requested by ${people(waiting)}`);
  if (turn === "reviewer") lines.push(`waiting on ${people(waiting)}`);
  if (s.threads > 0) lines.push(`${s.threads} unresolved threads await the author`);
  return lines;
}

function mergingLine(s: Snapshot): string {
  const { merging } = s;
  if (merging.kind === "queued") return `on the merge train at ${merging.position}`;
  const queue = merging.hasQueue ? ", merge trains on" : "";
  return merging.kind === "auto" ? `auto-merge on${queue}` : `manual${queue}`;
}

/** Draws what the watcher last read, and how it is polling. */
export function drawPane(
  $: EngineInterface,
  e: RenderInput,
  seen: Seen,
  now: number,
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e);
  const s = seen.snapshot;
  const next = seen.due - now;
  const watch = [
    `polled ${ago(now - seen.polledAt)} ago${seen.via === undefined ? "" : ` (${seen.via})`}`,
    next > 0 ? `next in ${ago(next)}` : "next poll due",
    seen.streak > 0 ? `unchanged ×${seen.streak}` : undefined,
  ].filter((part) => part !== undefined);
  return (
    <Box flexDirection="column">
      {s === undefined ? (
        <Text dimColor>No merge request{seen.none === undefined ? "" : `: ${seen.none}`}</Text>
      ) : (
        <Box flexDirection="column">
          <Text weight="semibold">
            MR !{s.mr} <Text dimColor>{s.url}</Text>
          </Text>
          <Text>{seen.line ?? ""}</Text>
          <Text weight="semibold">
            Jobs{" "}
            <Text dimColor>
              {s.total - s.pending - s.failed.length}/{s.total} passed
            </Text>
          </Text>
          {s.checks
            .toSorted((a, b) => ORDER[a.outcome] - ORDER[b.outcome])
            .map((check) => (
              <Text dimColor={check.outcome === "passed"}>
                {"  "}
                {MARK[check.outcome]} {check.label}
              </Text>
            ))}
          <Text weight="semibold">Review</Text>
          {reviewLines(s).map((line) => (
            <Text>
              {"  "}
              {line}
            </Text>
          ))}
          <Text weight="semibold">
            Merge <Text dimColor>{mergingLine(s)}</Text>
          </Text>
          {s.muted.length > 0 && (
            <Button
              key={MUTED}
              plain
              dimColor
              hotkey="m"
              label={`${seen.isMutedOpen ? "▾" : "▸"} ${s.muted.length} muted`}
              onPress={() => undefined}
            />
          )}
          {seen.isMutedOpen &&
            s.muted.map((m) => (
              <Text dimColor>
                {"  "}
                {m.author} · {m.reason}
              </Text>
            ))}
        </Box>
      )}
      <Text dimColor>{watch.join(" · ")}</Text>
      {seen.error !== undefined && <Text color="red">{seen.error}</Text>}
    </Box>
  );
}
