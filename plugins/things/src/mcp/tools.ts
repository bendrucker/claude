import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensureThingsRunning } from "../../scripts/ensure-running";
import { buildAttribution } from "../../scripts/inbox";
import { reorder } from "../../scripts/reorder";
import { buildJsonPayload, type DispatchResult, dispatch, warnFallback } from "../../scripts/url";
import { runScript } from "./jxa";
import { requireTags } from "./tags";

const LIST_IDS = {
  inbox: "TMInboxListSource",
  today: "TMTodayListSource",
  anytime: "TMNextListSource",
  upcoming: "TMCalendarListSource",
  someday: "TMSomedayListSource",
} as const;

const TODO_LINK_BASE = "https://things.bendrucker.me/show?id=";

// Things URL scheme rate limit: 250 operations per 10 seconds.
const BATCH_SIZE = 250;
const BATCH_DELAY_MS = 10_000;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value));
}

/**
 * Ceiling on a read's serialized payload. The payload travels as a JSON string
 * nested in the JSON-RPC envelope, so escaping can roughly double it, and a
 * proxy framing the line with Go's default `bufio.Scanner` drops anything past
 * 64KB without saying why. Half of that leaves room for the escaping and the
 * envelope. Tunable: raise it once every hop in the path reads longer lines.
 */
const MAX_PAYLOAD_BYTES = 32_768;

/** Headroom for the truncation wrapper's own keys, which the fit search omits. */
const WRAPPER_RESERVE_BYTES = 512;

function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/**
 * The items a read returned: a bare array, or the `items` field of a shape that
 * carries a count alongside them.
 */
function readItems(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && "items" in payload) {
    const items = (payload as { items: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return null;
}

/** Largest prefix of `items` that serializes within the budget. */
function fittingCount(items: unknown[]): number {
  const budget = MAX_PAYLOAD_BYTES - WRAPPER_RESERVE_BYTES;
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (payloadBytes(items.slice(0, mid)) <= budget) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Caps a read at {@link MAX_PAYLOAD_BYTES}, dropping items from the end and
 * saying so. An uncapped read of the logbook runs to megabytes, which a client
 * sees as a failure carrying no detail rather than as too much data.
 *
 * A payload within budget is returned untouched, so the common case keeps the
 * shape callers already parse.
 */
export function limitItems(payload: unknown, guidance: string): unknown {
  const items = readItems(payload);
  if (items === null || payloadBytes(payload) <= MAX_PAYLOAD_BYTES) return payload;

  const returned = fittingCount(items);
  const omitted = items.length - returned;
  // A payload that carries its items in a field keeps that field's siblings,
  // so a caller reading `count` still finds how many matched.
  const siblings = Array.isArray(payload) ? {} : (payload as Record<string, unknown>);
  return {
    ...siblings,
    truncated: true,
    returned,
    total: items.length,
    note: `${omitted} of ${items.length} items omitted to fit the response budget. ${guidance}`,
    items: items.slice(0, returned),
  };
}

/**
 * Surfaces the dispatch outcome without retrying: an xcall round trip that
 * produced no output is reported as a failure, since the todo may or may not
 * exist.
 */
function writeResult(result: DispatchResult, action: string) {
  warnFallback(result);
  if (result.viaXcall && !result.output) {
    throw new Error(
      `${action}: xcall returned no output. The operation may not have applied. ` +
        "Do not retry until the cause is understood (retries create duplicates).",
    );
  }
  if (result.id) {
    return textResult(`${action}: ${TODO_LINK_BASE}${result.id}`);
  }
  if (result.output) {
    return textResult(`${action}: ${result.output}`);
  }
  return textResult(`${action}: dispatched via Launch Services (no callback confirmation)`);
}

// Explicit `| undefined` on every property: under exactOptionalPropertyTypes an
// optional property rejects an explicit undefined, and the tool handler spreads
// its unset zod-optional arguments in as exactly that.
interface UpdateAttributeArgs {
  title?: string | undefined;
  notes?: string | undefined;
  prepend_notes?: string | undefined;
  append_notes?: string | undefined;
  when?: string | undefined;
  deadline?: string | undefined;
  tags?: string[] | undefined;
  add_tags?: string[] | undefined;
  checklist_items?: string[] | undefined;
  completed?: boolean | undefined;
  canceled?: boolean | undefined;
}

export function updateAttributes(args: UpdateAttributeArgs): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (args.title !== undefined) attributes.title = args.title;
  if (args.notes !== undefined) attributes.notes = args.notes;
  if (args.prepend_notes !== undefined) attributes["prepend-notes"] = args.prepend_notes;
  if (args.append_notes !== undefined) attributes["append-notes"] = args.append_notes;
  if (args.when !== undefined) attributes.when = args.when;
  if (args.deadline !== undefined) attributes.deadline = args.deadline;
  if (args.tags !== undefined) attributes.tags = args.tags.join(",");
  if (args.add_tags !== undefined) attributes["add-tags"] = args.add_tags.join(",");
  if (args.checklist_items !== undefined) {
    attributes["checklist-items"] = args.checklist_items.join("\n");
  }
  if (args.completed !== undefined) attributes.completed = String(args.completed);
  if (args.canceled !== undefined) attributes.canceled = String(args.canceled);
  return attributes;
}

/**
 * Ensures exactly one of title/titles is provided. The Things URL scheme's
 * behavior when `add` receives both is undocumented and may create extra
 * todos, so reject the combination.
 */
export function validateCaptureTitles(title?: string, titles?: string[]): void {
  if (title !== undefined && titles !== undefined) {
    throw new Error("Provide title (single todo) or titles (multiple todos), not both");
  }
  if (!title?.trim() && !titles?.length) {
    throw new Error("title or titles is required");
  }
  if (titles) validateNonBlank(titles, "titles");
}

/**
 * Rejects blank entries before they reach Things, which takes a blank id
 * silently and a blank title as a nameless todo the user then has to find.
 */
export function validateNonBlank(values: string[], field: string): void {
  values.forEach((value, index) => {
    if (value.trim() === "") {
      throw new Error(
        `${field}[${index}] must be a non-empty string, got ${JSON.stringify(value)}`,
      );
    }
  });
}

/**
 * A date `new Date` cannot parse becomes `Invalid Date`, and every comparison
 * against one is false. `query-logbook.js` would then skip its early
 * termination and walk all 10k+ completed todos, which is the scan the date
 * range exists to avoid. Rejecting here keeps that out of the JXA script, whose
 * ES5 dialect makes the check awkward to express.
 */
const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "must be an ISO 8601 date",
});

/**
 * Things takes a blank id silently, so a write carrying one reports success
 * having changed nothing. Rejecting in the schema keeps the request out of the
 * handler, which is where Things gets launched.
 */
const todoIds = z.array(z.string().trim().min(1)).min(1);

const whenDescription =
  "Schedule: today, tomorrow, evening, anytime, someday, yyyy-mm-dd, or natural language like 'next week'";

const tagsDescription = "Tag names; each must already exist in Things unless create_tags is set";

const createTagsDescription =
  "Create any tag that does not exist yet in Things. Without it, an unknown tag fails the call.";

/**
 * A limit stops the JXA walk rather than trimming the response, and each todo
 * the walk visits costs several Apple Events. Passing one is what makes a large
 * list affordable, so it reads as a scan bound rather than a display bound.
 */
const limitParameter = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Stop after this many todos, bounding the scan and not just the response");

function limitArgs(limit: number | undefined): string[] {
  return limit === undefined ? [] : ["--limit", String(limit)];
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_todos",
    {
      title: "List todos in a built-in list",
      description:
        "Read the todos in a built-in Things list. Returns a notes preview per todo, with get_todo serving one todo's full notes. The logbook is absent here because it can hold tens of thousands of items with nothing to narrow by. Use query_logbook, which bounds by date.",
      inputSchema: {
        list: z.enum(["inbox", "today", "anytime", "upcoming", "someday"]),
        limit: limitParameter,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ list, limit }) =>
      jsonResult(
        limitItems(
          await runScript("query-list.js", [LIST_IDS[list], ...limitArgs(limit)]),
          "Pass a limit, or use find_todos to narrow by tag or project.",
        ),
      ),
  );

  server.registerTool(
    "get_todo",
    {
      title: "Read one todo in full",
      description:
        "Read one todo by id, with its full notes and dates. The counterpart to the previews the list reads return. Works for completed todos too. Checklist items are not included: Things' scripting interface cannot read them.",
      inputSchema: {
        id: z.string().trim().min(1).describe("Todo id, as returned by any list read"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => jsonResult(await runScript("get-todo.js", [id])),
  );

  server.registerTool(
    "find_todos",
    {
      title: "Find todos by tag or project",
      description:
        "Find open todos by tag (searched across Inbox/Today/Anytime/Upcoming/Someday) or by project name. Set include_logbook to also search completed todos. Returns a notes preview per todo, with get_todo serving one todo's full notes.",
      inputSchema: {
        by: z.enum(["tag", "project"]),
        value: z.string().describe("Tag name or project name"),
        include_logbook: z.boolean().optional(),
        limit: limitParameter,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ by, value, include_logbook, limit }) =>
      jsonResult(
        limitItems(
          await runScript("find-todos.js", [
            by,
            value,
            ...(include_logbook ? ["--logbook"] : []),
            ...limitArgs(limit),
          ]),
          "Search a narrower tag or project, or leave include_logbook unset to skip completed todos.",
        ),
      ),
  );

  server.registerTool(
    "search_todos",
    {
      title: "Search todos by text",
      description:
        "Find todos whose title or notes contain a substring. Matching is case-sensitive and literal, not a word or fuzzy search. Covers open todos only: Things cannot answer a text search over the logbook in bounded time, so use query_logbook to reach completed todos.",
      inputSchema: {
        text: z.string().trim().min(1).describe("Substring to look for"),
        field: z
          .enum(["name", "notes", "both"])
          .optional()
          .describe("Where to look. Defaults to both."),
        limit: limitParameter,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ text, field, limit }) =>
      jsonResult(
        limitItems(
          await runScript("search-todos.js", [
            text,
            ...(field === undefined ? [] : ["--field", field]),
            ...limitArgs(limit),
          ]),
          "Search a longer or more distinctive substring, or set field to name only.",
        ),
      ),
  );

  server.registerTool(
    "query_logbook",
    {
      title: "Query completed todos",
      description:
        "Read completed todos from the logbook within a date range, newest first with early termination. Optionally filter by a notes substring.",
      inputSchema: {
        start: isoDate.describe("Start of range, ISO 8601 (e.g. 2026-07-01)"),
        end: isoDate.describe("End of range, ISO 8601"),
        notes_contains: z.string().optional().describe("Only todos whose notes contain this"),
        limit: limitParameter,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ start, end, notes_contains, limit }) =>
      jsonResult(
        limitItems(
          await runScript("query-logbook.js", [
            start,
            end,
            ...(notes_contains !== undefined ? ["--notes-contains", notes_contains] : []),
            ...limitArgs(limit),
          ]),
          "Results run newest first. To continue backwards, re-query with end set to the completionDate of the last item returned.",
        ),
      ),
  );

  server.registerTool(
    "list_metadata",
    {
      title: "List projects, areas, or tags",
      description: "List all projects, areas, or tags with their IDs.",
      inputSchema: {
        type: z.enum(["projects", "areas", "tags"]),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ type }) => jsonResult(await runScript("query-metadata.js", [type])),
  );

  server.registerTool(
    "add_todo",
    {
      title: "Create a todo",
      description:
        "Create a todo. Goes to the inbox unless when/list places it elsewhere. For quick captures that should carry Claude attribution, use capture_inbox instead.",
      inputSchema: {
        title: z.string().trim().min(1),
        notes: z.string().optional().describe("Markdown supported, max 10,000 chars"),
        when: z.string().optional().describe(whenDescription),
        deadline: z.string().optional().describe("yyyy-mm-dd"),
        tags: z.array(z.string()).optional().describe(tagsDescription),
        create_tags: z.boolean().optional().describe(createTagsDescription),
        checklist_items: z.array(z.string()).optional().describe("Max 100"),
        list: z.string().optional().describe("Project name to file under (projects only)"),
        list_id: z.string().optional().describe("Project or area ID (required for areas)"),
        heading: z.string().optional().describe("Heading within the target project"),
      },
    },
    async (args) => {
      await ensureThingsRunning();
      const params = new Map<string, string>();
      params.set("title", args.title);
      if (args.notes !== undefined) params.set("notes", args.notes);
      if (args.when !== undefined) params.set("when", args.when);
      if (args.deadline !== undefined) params.set("deadline", args.deadline);
      if (args.tags !== undefined) {
        params.set("tags", (await requireTags(args.tags, args.create_tags ?? false)).join(","));
      }
      if (args.checklist_items !== undefined) {
        params.set("checklist-items", args.checklist_items.join("\n"));
      }
      if (args.list !== undefined) params.set("list", args.list);
      if (args.list_id !== undefined) params.set("list-id", args.list_id);
      if (args.heading !== undefined) params.set("heading", args.heading);
      return writeResult(await dispatch("add", params), `Created "${args.title}"`);
    },
  );

  server.registerTool(
    "add_project",
    {
      title: "Create a project",
      description: "Create a project, optionally with initial todos.",
      inputSchema: {
        title: z.string().trim().min(1),
        notes: z.string().optional(),
        when: z.string().optional().describe(whenDescription),
        deadline: z.string().optional().describe("yyyy-mm-dd"),
        area: z.string().optional().describe("Area name to file under"),
        area_id: z.string().optional(),
        tags: z.array(z.string()).optional().describe(tagsDescription),
        create_tags: z.boolean().optional().describe(createTagsDescription),
        todos: z.array(z.string()).optional().describe("Initial todo titles"),
      },
    },
    async (args) => {
      if (args.todos) validateNonBlank(args.todos, "todos");
      await ensureThingsRunning();
      const params = new Map<string, string>();
      params.set("title", args.title);
      if (args.notes !== undefined) params.set("notes", args.notes);
      if (args.when !== undefined) params.set("when", args.when);
      if (args.deadline !== undefined) params.set("deadline", args.deadline);
      if (args.area !== undefined) params.set("area", args.area);
      if (args.area_id !== undefined) params.set("area-id", args.area_id);
      if (args.tags !== undefined) {
        params.set("tags", (await requireTags(args.tags, args.create_tags ?? false)).join(","));
      }
      if (args.todos !== undefined) params.set("to-dos", args.todos.join("\n"));
      return writeResult(await dispatch("add-project", params), `Created project "${args.title}"`);
    },
  );

  server.registerTool(
    "update_todos",
    {
      title: "Update todos",
      description:
        "Update one or more todos: retitle, edit notes, reschedule (when), set deadline, retag, complete, or cancel. Multiple IDs batch through the JSON command, rate-limited to 250 operations per 10 seconds. Repeating todos cannot have when/deadline updated.",
      inputSchema: {
        ids: todoIds,
        title: z.string().optional(),
        notes: z.string().optional().describe("Replaces existing notes"),
        prepend_notes: z.string().optional(),
        append_notes: z.string().optional(),
        when: z.string().optional().describe(whenDescription),
        deadline: z.string().optional().describe("yyyy-mm-dd"),
        tags: z.array(z.string()).optional().describe(`Replaces existing tags. ${tagsDescription}`),
        add_tags: z
          .array(z.string())
          .optional()
          .describe(`Adds to existing tags. ${tagsDescription}`),
        create_tags: z.boolean().optional().describe(createTagsDescription),
        checklist_items: z.array(z.string()).optional().describe("Replaces existing checklist"),
        completed: z.boolean().optional(),
        canceled: z.boolean().optional(),
      },
    },
    async ({ ids, create_tags, ...rest }) => {
      if (Object.keys(updateAttributes(rest)).length === 0) {
        throw new Error("At least one attribute to update is required");
      }
      await ensureThingsRunning();

      // Both tag fields resolve up front. A rejection landing partway through
      // the batch loop would leave the earlier chunks already written.
      const createMissing = create_tags ?? false;
      const attributes = updateAttributes({
        ...rest,
        tags: rest.tags && (await requireTags(rest.tags, createMissing)),
        add_tags: rest.add_tags && (await requireTags(rest.add_tags, createMissing)),
      });

      if (ids.length === 1 && ids[0]) {
        const params = new Map<string, string>(Object.entries(attributes));
        params.set("id", ids[0]);
        return writeResult(await dispatch("update", params), `Updated ${ids[0]}`);
      }

      const applied: string[] = [];
      for (const [index, batch] of chunk(ids, BATCH_SIZE).entries()) {
        if (index > 0) await Bun.sleep(BATCH_DELAY_MS);
        const params = new Map<string, string>();
        params.set("data", buildJsonPayload(batch, attributes));
        try {
          writeResult(await dispatch("json", params), `Updated ${batch.length} todos`);
        } catch (error) {
          // A batch that fails leaves the earlier ones applied. Naming them
          // keeps a retry from updating those todos a second time.
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            applied.length
              ? `${message}\nAlready updated: ${applied.join(", ")}. Retry only the remaining IDs.`
              : message,
          );
        }
        applied.push(...batch);
      }
      return textResult(`Updated ${applied.length} todos`);
    },
  );

  server.registerTool(
    "capture_inbox",
    {
      title: "Capture to inbox with Claude attribution",
      description:
        "Quick-capture one or more todos to the inbox. Each todo is tagged 'claude'; pass session_id (and directory) to append resume attribution to the notes.",
      inputSchema: {
        title: z.string().optional().describe("Single todo title"),
        titles: z.array(z.string()).optional().describe("Multiple todo titles"),
        notes: z.string().optional(),
        tags: z
          .array(z.string())
          .optional()
          .describe(`Extra tags beyond 'claude'. ${tagsDescription}`),
        create_tags: z.boolean().optional().describe(createTagsDescription),
        checklist_items: z.array(z.string()).optional(),
        // Blank strings are rejected rather than ignored. Both are read for
        // truthiness below, so a blank one would drop the attribution the
        // caller asked for without saying anything.
        session_id: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Claude session ID for attribution"),
        directory: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Absolute path the resume command should cd into. Omit it and the resume command carries no cd.",
          ),
      },
    },
    async (args) => {
      validateCaptureTitles(args.title, args.titles);
      await ensureThingsRunning();

      const params = new Map<string, string>();
      if (args.title !== undefined) params.set("title", args.title);
      if (args.titles !== undefined) params.set("titles", args.titles.join("\n"));
      if (args.checklist_items !== undefined) {
        params.set("checklist-items", args.checklist_items.join("\n"));
      }
      // Lowercase to match the tag Things stores. resolveTags folds case, so a
      // caller naming it too gets one tag rather than two spellings of it.
      const tags = await requireTags(["claude", ...(args.tags ?? [])], args.create_tags ?? false);
      params.set("tags", tags.join(","));

      let notes = args.notes;
      if (args.session_id) {
        const attribution = buildAttribution(args.session_id, args.directory);
        notes = notes ? `${notes}\n\n${attribution}` : attribution;
      }
      if (notes !== undefined) params.set("notes", notes);

      const first = args.title ?? args.titles?.[0] ?? "(untitled)";
      const extra =
        args.titles && args.titles.length > 1 ? ` (+${args.titles.length - 1} more)` : "";
      return writeResult(await dispatch("add", params), `Captured "${first}"${extra}`);
    },
  );

  server.registerTool(
    "reorder_todos",
    {
      title: "Reorder todos to the top of a list",
      description:
        "Move todos to the top of Today, Anytime, or Someday in the given order. Use the list matching the todos' current scheduling state. Also reorders items within a project.",
      inputSchema: {
        ids: todoIds.describe("Todo IDs in desired top-to-bottom order"),
        list: z.enum(["today", "anytime", "someday"]).default("today"),
      },
    },
    async ({ ids, list }) => {
      await ensureThingsRunning();
      return jsonResult(await reorder(list, ids));
    },
  );
}
