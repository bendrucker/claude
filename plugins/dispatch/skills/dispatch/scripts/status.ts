import { z } from "zod";

// Only the bottom of the screen shows the live state, and the transcript above
// it can quote either phrase.
const SCREEN_TAIL_LINES = 20;
const DIALOG =
  /Do you trust the files in this folder\?|trust this folder|Do you want to proceed\?|Esc to cancel/i;
const BUSY_SPINNER = /esc to interrupt/i;
// A spinner glyph, a gerund ending in an ellipsis, then the elapsed timer.
const SPINNER_LINE = /^\s*[^\s\w❯⏺│─]\s\S+…\s\(\d+[hms]\b/m;
// A first turn can finish inside one poll interval, leaving its timing line.
const TURN_DONE = /^\s*✻ .*\bdone\b/m;
// An echoed prompt followed by a reply. The empty input box shows a bare `❯`.
const ANSWERED = /^❯ \S.*\n(?:.*\n)*?⏺ /m;
// `--exec` and its shell launcher print these, and `--keep-open` leaves them on screen.
const EXEC_FAILED = /^dispatch failed: /m;

export type Status = "working" | "blocked" | "failed" | "unknown";

const ProgramStatus = z.object({
  records: z.array(
    z.object({
      id: z.string().nullish(),
      state: z.string(),
      effective_app: z.string().nullish(),
      kind: z.string().nullish(),
      msg: z.string().nullish(),
    }),
  ),
});

export interface ReportedStatus {
  status: Status;
  kind?: string;
  message?: string;
}

// The session's own record carries no id. Records with one track its tasks.
export function readProgramStatus(stdout: string): ReportedStatus | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    // An older Rex, or a block that is not a terminal, returns something else.
    return null;
  }
  const parsed = ProgramStatus.safeParse(json);
  if (!parsed.success) return null;
  const claude = parsed.data.records.filter((record) => record.effective_app === "claude-code");
  const record = claude.find((entry) => entry.id == null) ?? claude[0];
  if (record == null) return null;
  if (record.state === "working" || record.state === "done") return { status: "working" };
  if (record.state === "error") return { status: "failed" };
  if (record.state !== "blocked") return { status: "unknown" };
  const blocked: ReportedStatus = { status: "blocked" };
  if (record.kind != null) blocked.kind = record.kind;
  if (record.msg != null) blocked.message = record.msg;
  return blocked;
}

const BackgroundAgents = z.array(
  z.object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    kind: z.string().nullish(),
    state: z.string().nullish(),
    status: z.string().nullish(),
    waitingFor: z.string().nullish(),
  }),
);

const WAITING_KINDS: Readonly<Record<string, string>> = {
  "permission prompt": "permission",
  "sandbox request": "permission",
  "input needed": "question",
};

// Reads one background session's entry from `claude agents --json`, by id
// when `claude --bg` printed one and by name otherwise.
export function readBackgroundStatus(
  stdout: string,
  target: string | null,
  name: string,
): ReportedStatus | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    // A failed listing prints prose, which leaves the poll to try again.
    return null;
  }
  const parsed = BackgroundAgents.safeParse(json);
  if (!parsed.success) return null;
  const entry = parsed.data.find((agent) =>
    target == null ? agent.name === name : agent.id === target,
  );
  if (entry == null) return null;
  if (entry.state === "failed" || entry.state === "stopped") return { status: "failed" };
  if (entry.state === "blocked" || entry.status === "waiting") {
    const blocked: ReportedStatus = { status: "blocked" };
    const kind = entry.waitingFor == null ? undefined : WAITING_KINDS[entry.waitingFor];
    if (kind != null) blocked.kind = kind;
    if (entry.waitingFor != null) blocked.message = entry.waitingFor;
    return blocked;
  }
  if (entry.state === "working" || entry.state === "done" || entry.status === "busy")
    return { status: "working" };
  return { status: "unknown" };
}

const ErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// herdr writes its JSON envelope on stderr, sometimes behind other output, so
// the last line is tried after the whole stream.
export function envelopeCode(stderr: string): string | null {
  const lastLine = stderr.split("\n").findLast((line) => line.trim() !== "");
  return readEnvelope(stderr) ?? (lastLine == null ? null : readEnvelope(lastLine));
}

function readEnvelope(text: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // This probes arbitrary stderr for an envelope, so non-JSON just means there is none.
    return null;
  }
  const parsed = ErrorEnvelope.safeParse(json);
  return parsed.success ? parsed.data.error.code : null;
}

export function classifyScreen(screen: string): Status {
  const tail = screen.split("\n").slice(-SCREEN_TAIL_LINES).join("\n");
  if (EXEC_FAILED.test(tail)) return "failed";
  if (DIALOG.test(tail)) return "blocked";
  if ([BUSY_SPINNER, SPINNER_LINE, TURN_DONE].some((pattern) => pattern.test(tail)))
    return "working";
  if (ANSWERED.test(screen)) return "working";
  return "unknown";
}
