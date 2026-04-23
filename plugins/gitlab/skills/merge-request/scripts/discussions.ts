#!/usr/bin/env bun

import { $ } from "bun";
import { cli, command } from "cleye";
import { table } from "table";
import {
  buildPosition,
  fetchMrDiffs,
  getDiffRefs,
  glabApiPost,
  parseGlabPaginated,
  readBody,
  validateLineInDiff,
} from "./diff";

export { parseGlabPaginated } from "./diff";

type LineRange = {
  start: { type: "new" | "old"; new_line?: number; old_line?: number };
  end: { type: "new" | "old"; new_line?: number; old_line?: number };
};

type Position = {
  new_path?: string;
  old_path?: string;
  new_line?: number;
  old_line?: number;
  position_type?: string;
  line_range?: LineRange | null;
};

type Note = {
  author: { username: string };
  body: string;
  resolved?: boolean;
  resolvable?: boolean;
  position?: Position | null;
};

export type Discussion = {
  id: string;
  notes: Note[];
};

type DiscussionSummary = {
  id: string;
  author: string;
  body: string;
  resolved: boolean;
  resolvable: boolean;
  file?: string;
  line?: number;
  lineRange?: { start: number; end: number } | null;
};

function summarize(d: Discussion): DiscussionSummary | null {
  const note = d.notes[0];
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
  if (file) result.file = file;
  const line = note.position?.new_line ?? note.position?.old_line;
  if (line) result.line = line;
  return result;
}

export type FilterOptions = {
  author?: string;
  resolvable?: boolean;
  unresolved?: boolean;
};

export function filterDiscussions(discussions: Discussion[], opts: FilterOptions): Discussion[] {
  return discussions.filter((d) => {
    const note = d.notes[0];
    if (!note) return false;
    if (opts.author && note.author.username !== opts.author) return false;
    if (opts.resolvable && !note.resolvable) return false;
    if (opts.unresolved && note.resolved) return false;
    return true;
  });
}

export function deduplicateDiscussions(discussions: Discussion[]): Discussion[] {
  const seen = new Map<string, Discussion>();
  for (const d of discussions) {
    const note = d.notes[0];
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

function buildFilterOptions(flags: {
  author: string | undefined;
  resolvable: boolean;
  unresolved: boolean;
}): FilterOptions {
  const opts: FilterOptions = {};
  if (flags.author) opts.author = flags.author;
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

    if (parsed.flags.file) {
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
      resolvable: { type: Boolean, description: "Only resolvable discussions", default: false },
      unresolved: { type: Boolean, description: "Only unresolved discussions", default: false },
      dedupe: {
        type: Boolean,
        description: "Deduplicate by file path + body prefix",
        default: false,
      },
      format: {
        type: String,
        description: "Output format: json or table",
        default: "json",
      },
    },
  },
  async (parsed) => {
    const iid = parsed._.iid;
    const raw = await $`glab api projects/:id/merge_requests/${iid}/discussions --paginate`.text();
    let discussions = parseGlabPaginated(raw) as Discussion[];

    discussions = filterDiscussions(discussions, buildFilterOptions(parsed.flags));

    if (parsed.flags.dedupe) {
      discussions = deduplicateDiscussions(discussions);
    }

    const summaries = discussions.map(summarize).filter((s): s is DiscussionSummary => s !== null);

    if (parsed.flags.format === "table") {
      const formatLocation = (s: DiscussionSummary) => {
        if (!s.file) return "";
        const loc = s.lineRange ? `${s.lineRange.start}-${s.lineRange.end}` : String(s.line ?? "");
        return loc ? `${s.file}:${loc}` : s.file;
      };
      const rows = summaries.map((s) => [
        s.id.slice(0, 12),
        s.author,
        s.resolved ? "yes" : "no",
        formatLocation(s),
        s.body.slice(0, 60),
      ]);
      console.log(table([["ID", "Author", "Resolved", "Location", "Body"], ...rows]));
    } else {
      console.log(JSON.stringify(summaries, null, 2));
    }
  },
);

const resolveCmd = command(
  {
    name: "resolve",
    parameters: ["<iid>", "[ids...]"],
    flags: {
      allBy: {
        type: String,
        description: "Resolve all discussions by this author",
      },
      unresolve: {
        type: Boolean,
        description: "Unresolve instead of resolve",
        default: false,
      },
    },
  },
  async (parsed) => {
    const iid = parsed._.iid;
    const resolvedValue = parsed.flags.unresolve ? "false" : "true";
    let ids = parsed._.ids ?? [];

    if (parsed.flags.allBy) {
      const raw =
        await $`glab api projects/:id/merge_requests/${iid}/discussions --paginate`.text();
      const discussions = parseGlabPaginated(raw) as Discussion[];
      ids = filterDiscussions(discussions, {
        author: parsed.flags.allBy,
        resolvable: true,
        unresolved: !parsed.flags.unresolve,
      }).map((d) => d.id);
    }

    for (const id of ids) {
      await $`glab api projects/:id/merge_requests/${iid}/discussions/${id} -X PUT -f resolved=${resolvedValue}`.text();
      console.error(`${parsed.flags.unresolve ? "Unresolved" : "Resolved"}: ${id}`);
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
    const discussions = parseGlabPaginated(raw) as Discussion[];

    const resolvable = discussions.filter((d) => d.notes[0]?.resolvable);
    const resolved = resolvable.filter((d) => d.notes[0]?.resolved);
    const unresolved = resolvable.filter((d) => !d.notes[0]?.resolved);

    console.log(`Resolvable: ${resolvable.length}`);
    console.log(`Resolved: ${resolved.length}`);
    console.log(`Unresolved: ${unresolved.length}`);
    console.log();

    const byAuthor = new Map<string, { resolved: number; unresolved: number }>();
    for (const d of resolvable) {
      const note = d.notes[0];
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

cli(
  {
    name: "discussions",
    commands: [createCmd, listCmd, resolveCmd, summaryCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
