import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensureThingsRunning } from "../../scripts/ensure-running";
import { buildAttribution } from "../../scripts/inbox";
import { reorder } from "../../scripts/reorder";
import { mergeTags } from "../../scripts/tags";
import { buildJsonPayload, type DispatchResult, dispatch, warnFallback } from "../../scripts/url";
import { runQuery } from "./jxa";

const LIST_IDS = {
  inbox: "TMInboxListSource",
  today: "TMTodayListSource",
  anytime: "TMNextListSource",
  upcoming: "TMCalendarListSource",
  someday: "TMSomedayListSource",
  logbook: "TMLogbookListSource",
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

const whenDescription =
  "Schedule: today, tomorrow, evening, anytime, someday, yyyy-mm-dd, or natural language like 'next week'";

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_todos",
    {
      title: "List todos in a built-in list",
      description:
        "Read the todos in a built-in Things list (inbox, today, anytime, upcoming, someday, logbook). Full logbook scans are slow (10k+ items); prefer query_logbook for date-bounded logbook reads.",
      inputSchema: {
        list: z.enum(["inbox", "today", "anytime", "upcoming", "someday", "logbook"]),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ list }) => jsonResult(await runQuery("query-list.js", [LIST_IDS[list]])),
  );

  server.registerTool(
    "find_todos",
    {
      title: "Find todos by tag or project",
      description:
        "Find open todos by tag (searched across Inbox/Today/Anytime/Upcoming/Someday) or by project name. Set include_logbook to also search completed todos.",
      inputSchema: {
        by: z.enum(["tag", "project"]),
        value: z.string().describe("Tag name or project name"),
        include_logbook: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ by, value, include_logbook }) =>
      jsonResult(
        await runQuery("find-todos.js", [by, value, ...(include_logbook ? ["--logbook"] : [])]),
      ),
  );

  server.registerTool(
    "query_logbook",
    {
      title: "Query completed todos",
      description:
        "Read completed todos from the logbook within a date range, newest first with early termination. Optionally filter by a notes substring.",
      inputSchema: {
        start: z.string().describe("Start of range, ISO 8601 (e.g. 2026-07-01)"),
        end: z.string().describe("End of range, ISO 8601"),
        notes_contains: z.string().optional().describe("Only todos whose notes contain this"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ start, end, notes_contains }) =>
      jsonResult(
        await runQuery("query-logbook.js", [
          start,
          end,
          ...(notes_contains !== undefined ? ["--notes-contains", notes_contains] : []),
        ]),
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
    async ({ type }) => jsonResult(await runQuery("query-metadata.js", [type])),
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
        tags: z.array(z.string()).optional(),
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
      if (args.tags !== undefined) params.set("tags", args.tags.join(","));
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
        tags: z.array(z.string()).optional(),
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
      if (args.tags !== undefined) params.set("tags", args.tags.join(","));
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
        ids: z.array(z.string()).min(1),
        title: z.string().optional(),
        notes: z.string().optional().describe("Replaces existing notes"),
        prepend_notes: z.string().optional(),
        append_notes: z.string().optional(),
        when: z.string().optional().describe(whenDescription),
        deadline: z.string().optional().describe("yyyy-mm-dd"),
        tags: z.array(z.string()).optional().describe("Replaces existing tags"),
        add_tags: z.array(z.string()).optional().describe("Adds to existing tags"),
        checklist_items: z.array(z.string()).optional().describe("Replaces existing checklist"),
        completed: z.boolean().optional(),
        canceled: z.boolean().optional(),
      },
    },
    async ({ ids, ...rest }) => {
      const attributes = updateAttributes(rest);
      if (Object.keys(attributes).length === 0) {
        throw new Error("At least one attribute to update is required");
      }
      validateNonBlank(ids, "ids");
      await ensureThingsRunning();

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
        "Quick-capture one or more todos to the inbox. Each todo is tagged 'Claude'; pass session_id (and directory) to append resume attribution to the notes.",
      inputSchema: {
        title: z.string().optional().describe("Single todo title"),
        titles: z.array(z.string()).optional().describe("Multiple todo titles"),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional().describe("Extra tags beyond 'Claude'"),
        checklist_items: z.array(z.string()).optional(),
        session_id: z.string().optional().describe("Claude session ID for attribution"),
        directory: z
          .string()
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
      params.set("tags", mergeTags(["Claude"], args.tags ?? []).join(","));

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
        ids: z.array(z.string()).min(1).describe("Todo IDs in desired top-to-bottom order"),
        list: z.enum(["today", "anytime", "someday"]).default("today"),
      },
    },
    async ({ ids, list }) => {
      await ensureThingsRunning();
      return jsonResult(await reorder(list, ids));
    },
  );
}
