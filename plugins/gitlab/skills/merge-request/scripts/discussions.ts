#!/usr/bin/env bun

import { $ } from "bun";
import { cli, command } from "cleye";
import { table } from "table";
import { z } from "zod";
import {
  buildPosition,
  exitOnRejection,
  fetchMrDiffs,
  getDiffRefs,
  glabApiPost,
  parseGlabPaginated,
  readBody,
  validateLineInDiff,
} from "./diff";
import { isReviewTarget, loadExtraReviewers } from "./reviewers";

export { parseGlabPaginated } from "./diff";

exitOnRejection();

const LineEnd = z.looseObject({
  type: z.enum(["new", "old"]),
  new_line: z.number().nullish(),
  old_line: z.number().nullish(),
});

const LineRange = z.looseObject({ start: LineEnd, end: LineEnd });

const Position = z.looseObject({
  new_path: z.string().nullish(),
  old_path: z.string().nullish(),
  new_line: z.number().nullish(),
  old_line: z.number().nullish(),
  position_type: z.string().optional(),
  line_range: LineRange.nullish(),
});

const Note = z.looseObject({
  author: z.looseObject({ username: z.string() }),
  body: z.string(),
  resolved: z.boolean().optional(),
  resolvable: z.boolean().optional(),
  position: Position.nullish(),
});

// GitLab omits or nulls `notes` on some system/individual-note discussions.
export const Discussion = z.looseObject({
  id: z.string(),
  notes: z.array(Note).nullish(),
});
export type Discussion = z.infer<typeof Discussion>;
type Note = z.infer<typeof Note>;

const Discussions = z.array(Discussion);

function firstNote(d: Discussion): Note | null {
  return d.notes?.[0] ?? null;
}

export type DiscussionSummary = {
  id: string;
  author: string;
  body: string;
  resolved: boolean;
  resolvable: boolean;
  file?: string;
  line?: number;
  lineRange?: { start: number; end: number } | null;
};

export const DEFAULT_BODY_TRUNCATE = 80;

function summarize(d: Discussion): DiscussionSummary | null {
  const note = firstNote(d);
  if (!note) return null;
  const result: DiscussionSummary = {
    id: d.id,
    author: note.author.username,
    body: note.body,
    resolved: note.resolved ?? false,
    resolvable: note.resolvable ?? false,
    lineRange: note.position?.line_range
      ? {
          start:
            note.position.line_range.start.new_line ?? note.position.line_range.start.old_line ?? 0,
          end: note.position.line_range.end.new_line ?? note.position.line_range.end.old_line ?? 0,
        }
      : null,
  };
  const file = note.position?.new_path ?? note.position?.old_path;
  if (file != null && file !== "") result.file = file;
  const line = note.position?.new_line ?? note.position?.old_line;
  if (line != null && line !== 0) result.line = line;
  return result;
}

export function truncateBody(body: string, max: number): string {
  const collapsed = body.replaceAll(/\s+/g, " ").trim();
  if (max <= 0 || collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

export function formatLocation(s: DiscussionSummary): string {
  if (s.file == null || s.file === "") return "";
  const loc = s.lineRange ? `${s.lineRange.start}-${s.lineRange.end}` : String(s.line ?? "");
  return loc !== "" ? `${s.file}:${loc}` : s.file;
}

const LOCATION_MAX_WIDTH = 40;

export function formatDigest(summaries: DiscussionSummary[], truncate: number): string {
  const rows = summaries.map((s) => {
    const location = formatLocation(s);
    return {
      id: s.id.slice(0, 12),
      location: location !== "" ? location : "-",
      state: s.resolved ? "[resolved]" : "[open]",
      body: truncateBody(s.body, truncate),
    };
  });
  const locWidth = Math.min(Math.max(0, ...rows.map((r) => r.location.length)), LOCATION_MAX_WIDTH);
  const stateWidth = Math.max(0, ...rows.map((r) => r.state.length));
  return rows
    .map((r) => `${r.id}  ${r.location.padEnd(locWidth)}  ${r.state.padEnd(stateWidth)}  ${r.body}`)
    .join("\n");
}

export function formatTable(summaries: DiscussionSummary[], truncate: number): string {
  const rows = summaries.map((s) => [
    s.id.slice(0, 12),
    s.author,
    s.resolved ? "yes" : "no",
    formatLocation(s),
    truncateBody(s.body, truncate),
  ]);
  return table([["ID", "Author", "Resolved", "Location", "Body"], ...rows]);
}

export type FilterOptions = {
  author?: string;
  resolvable?: boolean;
  unresolved?: boolean;
  bots?: boolean;
  extra?: Set<string>;
};

export function filterDiscussions(discussions: Discussion[], opts: FilterOptions): Discussion[] {
  return discussions.filter((d) => {
    const note = firstNote(d);
    if (!note) return false;
    if (opts.author != null && opts.author !== "" && note.author.username !== opts.author)
      return false;
    if (opts.bots && !isReviewTarget(note.author.username, opts.extra)) return false;
    if (opts.resolvable && !note.resolvable) return false;
    if (opts.unresolved && note.resolved) return false;
    return true;
  });
}

export function deduplicateDiscussions(discussions: Discussion[]): Discussion[] {
  const seen = new Map<string, Discussion>();
  for (const d of discussions) {
    const note = firstNote(d);
    if (!note) continue;
    const path = note.position?.new_path ?? "";
    const prefix = note.body.slice(0, 80);
    const key = `${path}:${prefix}`;
    if (!seen.has(key)) {
      seen.set(key, d);
    }
  }
  return [...seen.values()];
}

async function buildFilterOptions(flags: {
  author: string | undefined;
  resolvable: boolean;
  unresolved: boolean;
  bots: boolean;
}): Promise<FilterOptions> {
  const opts: FilterOptions = {};
  if (flags.author != null && flags.author !== "") opts.author = flags.author;
  if (flags.bots) {
    opts.bots = true;
    opts.extra = await loadExtraReviewers();
  }
  if (flags.resolvable) opts.resolvable = true;
  if (flags.unresolved) opts.unresolved = true;
  return opts;
}

const createCmd = command(
  {
    name: "create",
    parameters: ["<iid>"],
    flags: {
      file: { type: String, description: "File path for inline comment" },
      line: { type: Number, description: "New line number" },
      oldLine: {
        type: Number,
        description: "Old line number (deleted lines)",
      },
      bodyFile: {
        type: String,
        description: "Read body from file (default: stdin)",
      },
    },
  },
  async (parsed) => {
    const iid = parsed._.iid;
    const body = await readBody(parsed.flags.bodyFile);

    const payload: Record<string, unknown> = { body };

    if (parsed.flags.file != null && parsed.flags.file !== "") {
      const [refs, diffs] = await Promise.all([getDiffRefs(iid), fetchMrDiffs(iid)]);
      validateLineInDiff(diffs, parsed.flags.file, {
        line: parsed.flags.line,
        oldLine: parsed.flags.oldLine,
      });
      payload.position = buildPosition(refs, parsed.flags.file, {
        line: parsed.flags.line,
        oldLine: parsed.flags.oldLine,
      });
    }

    await glabApiPost(`projects/:id/merge_requests/${iid}/discussions`, payload);
  },
);

const listCmd = command(
  {
    name: "list",
    parameters: ["<iid>"],
    flags: {
      author: { type: String, description: "Filter by author username" },
      bots: {
        type: Boolean,
        description:
          "Only review-bot discussions (plus usernames in $CLAUDE_PLUGIN_DATA/reviewers.txt)",
        default: false,
      },
      resolvable: { type: Boolean, description: "Only resolvable discussions", default: false },
      unresolved: { type: Boolean, description: "Only unresolved discussions", default: false },
      dedupe: {
        type: Boolean,
        description: "Deduplicate by file path + body prefix",
        default: false,
      },
      format: {
        type: String,
        description: "Output format: json, table, or digest",
        default: "json",
      },
      truncate: {
        type: Number,
        description: "Max body length for table and digest output",
        default: DEFAULT_BODY_TRUNCATE,
      },
    },
  },
  async (parsed) => {
    const iid = parsed._.iid;
    const raw = await $`glab api projects/:id/merge_requests/${iid}/discussions --paginate`.text();
    let discussions = Discussions.parse(parseGlabPaginated(raw));

    discussions = filterDiscussions(discussions, await buildFilterOptions(parsed.flags));

    if (parsed.flags.dedupe) {
      discussions = deduplicateDiscussions(discussions);
    }

    const summaries = discussions.map(summarize).filter((s): s is DiscussionSummary => s !== null);

    if (parsed.flags.format === "table") {
      console.log(formatTable(summaries, parsed.flags.truncate));
    } else if (parsed.flags.format === "digest") {
      console.log(formatDigest(summaries, parsed.flags.truncate));
    } else {
      console.log(JSON.stringify(summaries, null, 2));
    }
  },
);

const resolveCmd = command(
  {
    name: "resolve",
    parameters: ["<iid>", "[ids...]"],
  },
  async (parsed) => {
    const iid = parsed._.iid;

    for (const id of parsed._.ids) {
      // oxlint-disable-next-line no-await-in-loop -- one API mutation per discussion, each confirmed on stderr as it resolves.
      await $`glab api projects/:id/merge_requests/${iid}/discussions/${id} -X PUT -f resolved=true`.text();
      console.error(`Resolved: ${id}`);
    }
  },
);

const summaryCmd = command(
  {
    name: "summary",
    parameters: ["<iid>"],
  },
  async (parsed) => {
    const iid = parsed._.iid;
    const raw = await $`glab api projects/:id/merge_requests/${iid}/discussions --paginate`.text();
    const discussions = Discussions.parse(parseGlabPaginated(raw));

    const resolvable = discussions.filter((d) => firstNote(d)?.resolvable);
    const resolved = resolvable.filter((d) => firstNote(d)?.resolved);
    const unresolved = resolvable.filter((d) => !firstNote(d)?.resolved);

    console.log(`Resolvable: ${resolvable.length}`);
    console.log(`Resolved: ${resolved.length}`);
    console.log(`Unresolved: ${unresolved.length}`);
    console.log();

    const byAuthor = new Map<string, { resolved: number; unresolved: number }>();
    for (const d of resolvable) {
      const note = firstNote(d);
      if (!note) continue;
      const author = note.author.username;
      const entry = byAuthor.get(author) ?? { resolved: 0, unresolved: 0 };
      if (note.resolved) {
        entry.resolved++;
      } else {
        entry.unresolved++;
      }
      byAuthor.set(author, entry);
    }

    const rows = [...byAuthor.entries()].map(([author, counts]) => [
      author,
      String(counts.resolved),
      String(counts.unresolved),
      String(counts.resolved + counts.unresolved),
    ]);

    console.log(table([["Author", "Resolved", "Unresolved", "Total"], ...rows]));
  },
);

await cli(
  {
    name: "discussions",
    commands: [createCmd, listCmd, resolveCmd, summaryCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
