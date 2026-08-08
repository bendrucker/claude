import { commandVerbs, sharesVerb } from "./command";

/**
 * Text the sandbox produces when it refuses an operation. Seatbelt denials surface as
 * `Operation not permitted` from the C library, as an errno from Node and Bun, or as a
 * network failure for a host the profile does not allow. Broad by design: a match only
 * counts when it comes from a recent sandboxed run of the same verb.
 */
const SANDBOX_ERRORS = [
  /operation not permitted/i,
  /permission denied/i,
  /read-only file system/i,
  /sandbox[-_](?:exec|apply)/i,
  /(?:not permitted|blocked|denied) by (?:the )?sandbox/i,
  /deny (?:file-write|file-read|network|mach-lookup)/i,
  /\bEPERM\b/,
  /\bEACCES\b/,
  /\bEAI_AGAIN\b/,
  /\bENOTFOUND\b/,
  // Apple Events under Seatbelt: TCC attribution changes, so osascript reports a privilege
  // violation or a missing app rather than anything naming the sandbox.
  /privilege violation/i,
  /not authorized to send apple events/i,
  /\(-(?:600|1743|10004)\)/,
];

/** Bytes of transcript tail to parse. Large enough for a few dozen tool calls, small enough to stay cheap. */
export const TAIL_BYTES = 262_144;

/** Sandboxed Bash results to consider before giving up, counted back from the newest. */
export const RECENT_RESULTS = 40;

export type PriorFailure = { command: string; error: string };

type BashUse = { verbs: Set<string>; command: string; bypassed: boolean };

type TranscriptEntry = {
  message?: { content?: unknown };
};

type ContentBlock = {
  type?: string;
  id?: string;
  name?: string;
  input?: { command?: string; dangerouslyDisableSandbox?: boolean };
  tool_use_id?: string;
  content?: unknown;
};

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("\n");
}

export function looksSandboxAttributable(text: string): boolean {
  return SANDBOX_ERRORS.some((pattern) => pattern.test(text));
}

async function readTail(path: string, tailBytes: number): Promise<string[]> {
  const file = Bun.file(path);
  const size = file.size;
  const start = Math.max(0, size - tailBytes);
  const text = await file.slice(start).text();
  const lines = text.split("\n").filter(Boolean);
  // A non-zero offset lands mid-record, so the first line is a fragment.
  return start > 0 ? lines.slice(1) : lines;
}

/**
 * Scans the tail of the session transcript for a recent sandboxed Bash call that ran a
 * verb this command also runs and came back with a sandbox-attributable error. That is the
 * evidence the sandboxed-first rule asks for before a bypass.
 */
export async function findSandboxFailure(
  transcriptPath: string,
  verbs: Set<string>,
  options: { tailBytes?: number; recentResults?: number } = {},
): Promise<PriorFailure | null> {
  if (verbs.size === 0) return null;

  let lines: string[];
  try {
    lines = await readTail(transcriptPath, options.tailBytes ?? TAIL_BYTES);
  } catch {
    return null;
  }

  const uses = new Map<string, BashUse>();
  const results: Array<{ toolUseId: string; text: string }> = [];

  for (const line of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content as ContentBlock[]) {
      if (block.type === "tool_use" && block.name === "Bash" && block.id) {
        const command = block.input?.command;
        if (typeof command !== "string") continue;
        uses.set(block.id, {
          command,
          verbs: commandVerbs(command),
          bypassed: block.input?.dangerouslyDisableSandbox === true,
        });
      }
      if (block.type === "tool_result" && block.tool_use_id) {
        results.push({ toolUseId: block.tool_use_id, text: blockText(block.content) });
      }
    }
  }

  let considered = 0;
  const limit = options.recentResults ?? RECENT_RESULTS;
  for (let i = results.length - 1; i >= 0 && considered < limit; i--) {
    const result = results[i];
    if (!result) continue;
    const use = uses.get(result.toolUseId);
    // A bypassed run proves nothing about what the sandbox refuses.
    if (!use || use.bypassed) continue;
    considered++;
    if (!sharesVerb(verbs, use.verbs)) continue;
    if (looksSandboxAttributable(result.text)) {
      return { command: use.command, error: result.text.trim().slice(0, 200) };
    }
  }

  return null;
}
